import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, env, json, upsertAll } from '../_shared/common.ts'
import {
  fetchAll, mapCycles, mapRecovery, mapSleep, mapWorkouts, refreshTokens,
} from '../_shared/whoop.ts'

/**
 * Pulls new Whoop data into the dashboard's tables.
 *
 * Two callers:
 *   - the nightly cron job, authenticating with the service role key, which
 *     syncs every connected account
 *   - the "Sync now" button, authenticating with the user's JWT, which syncs
 *     only that user
 *
 * Incremental by default: it asks for everything since the last successful
 * sync, less a day of overlap, because Whoop revises a night's scores for a
 * while after it ends. Upserts make the overlap harmless.
 */

const OVERLAP_DAYS = 2
const FIRST_SYNC_DAYS = 365 * 2

interface TokenRow {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  last_sync_at: string | null
}

async function syncUser(admin: SupabaseClient, row: TokenRow): Promise<number> {
  const clientId = env('WHOOP_CLIENT_ID')
  const clientSecret = env('WHOOP_CLIENT_SECRET')

  let accessToken = row.access_token

  // Refresh a minute before expiry rather than on it, so a slow request does
  // not land after the token dies.
  if (Date.parse(row.expires_at) - Date.now() < 60_000) {
    const tokens = await refreshTokens(row.refresh_token, clientId, clientSecret)
    accessToken = tokens.access_token
    // Whoop invalidates the previous access token the moment this succeeds, so
    // the new pair is persisted before any data request uses it.
    const { error } = await admin.from('whoop_tokens').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? row.refresh_token,
      expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('user_id', row.user_id)
    if (error) throw new Error(`Could not store refreshed tokens: ${error.message}`)
  }

  const startMs = row.last_sync_at
    ? Date.parse(row.last_sync_at) - OVERLAP_DAYS * 86_400_000
    : Date.now() - FIRST_SYNC_DAYS * 86_400_000
  const start = new Date(startMs).toISOString()
  const end = new Date(Date.now() + 86_400_000).toISOString()

  const [cycleRecords, recoveryRecords, sleepRecords, workoutRecords] = await Promise.all([
    fetchAll('/v2/cycle', accessToken, start, end),
    fetchAll('/v2/recovery', accessToken, start, end),
    fetchAll('/v2/activity/sleep', accessToken, start, end),
    fetchAll('/v2/activity/workout', accessToken, start, end),
  ])

  const { rows: cycles, cycleDays } = mapCycles(cycleRecords, row.user_id)
  const recovery = mapRecovery(recoveryRecords, row.user_id, cycleDays)
  const sleep = mapSleep(sleepRecords, row.user_id)
  const workouts = mapWorkouts(workoutRecords, row.user_id)

  let written = 0
  written += await upsertAll(admin, 'cycles', cycles, 'user_id,day,source')
  written += await upsertAll(admin, 'recovery', recovery, 'user_id,day,source')
  written += await upsertAll(admin, 'sleep_sessions', sleep, 'user_id,source,external_id')
  written += await upsertAll(admin, 'workouts', workouts, 'user_id,source,external_id')

  const days = [...cycles, ...recovery, ...sleep, ...workouts]
    .map((r) => r.day as string).filter(Boolean).sort()

  await admin.from('imports').insert({
    user_id: row.user_id,
    source: 'whoop_api',
    filename: 'Automatic sync',
    status: 'complete',
    rows_imported: written,
    range_start: days[0] ?? null,
    range_end: days[days.length - 1] ?? null,
    completed_at: new Date().toISOString(),
  })

  await admin.from('whoop_tokens').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: 'ok',
    last_error: null,
    rows_last_sync: written,
  }).eq('user_id', row.user_id)

  return written
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    if (!token) return json({ error: 'Missing authorization' }, 401)

    // The service role key means this is the scheduled run: sync everyone.
    const isCron = token === env('SUPABASE_SERVICE_ROLE_KEY')

    let query = admin.from('whoop_tokens')
      .select('user_id, access_token, refresh_token, expires_at, last_sync_at')

    if (!isCron) {
      const { data: userData, error } = await admin.auth.getUser(token)
      if (error || !userData.user) return json({ error: 'Not signed in' }, 401)
      query = query.eq('user_id', userData.user.id)
    }

    const { data: rows, error } = await query
    if (error) return json({ error: error.message }, 500)
    if (!rows?.length) return json({ synced: 0, accounts: 0, message: 'No connected accounts' })

    const results: Array<{ user_id: string; rows?: number; error?: string }> = []
    for (const row of rows as TokenRow[]) {
      try {
        results.push({ user_id: row.user_id, rows: await syncUser(admin, row) })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        // One account's failure must not stop the rest of the scheduled run.
        console.error('whoop-sync failed', row.user_id, message)
        await admin.from('whoop_tokens').update({
          last_sync_status: 'error',
          last_error: message.slice(0, 500),
        }).eq('user_id', row.user_id)
        results.push({ user_id: row.user_id, error: message })
      }
    }

    const synced = results.reduce((s, r) => s + (r.rows ?? 0), 0)
    const failed = results.filter((r) => r.error)
    return json({
      accounts: results.length,
      synced,
      failed: failed.length,
      errors: isCron ? undefined : failed.map((f) => f.error),
    }, failed.length && results.length === failed.length ? 502 : 200)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
