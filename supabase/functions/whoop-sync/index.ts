import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, env, json, upsertAll } from '../_shared/common.ts'
import {
  fetchAll, mapCycles, mapRecovery, mapSleep, mapWorkouts, refreshTokens,
} from '../_shared/whoop.ts'

/**
 * Pulls new Whoop data into the dashboard's tables.
 *
 * Two callers:
 *   - the scheduled job, authenticating with the secret the database generated
 *     for it, which syncs every connected account
 *   - the "Sync now" button, authenticating with the user's JWT, which syncs
 *     only that user
 *
 * Incremental by default: it asks for everything since the last successful
 * sync, less two days of overlap, because Whoop revises a night's scores for a
 * while after it ends. Upserts make the overlap harmless, and keep each
 * quarter-hourly run down to four small requests.
 */

const OVERLAP_DAYS = 2
const FIRST_SYNC_DAYS = 365 * 2

interface TokenRow {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  last_sync_at: string | null
  last_day: string | null
}

async function syncUser(
  admin: SupabaseClient, row: TokenRow, logImport: boolean,
): Promise<number> {
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
  const newestDay = days[days.length - 1] ?? null

  // At four runs an hour, logging every one would bury the import history
  // under rows saying nothing happened. A scheduled run is recorded only when
  // it brings a day this account has not seen before; pressing "Sync now" is
  // always recorded, because someone is waiting to see that it did something.
  const broughtANewDay = !!newestDay && (!row.last_day || newestDay > row.last_day)

  if (logImport || broughtANewDay) {
    await admin.from('imports').insert({
      user_id: row.user_id,
      source: 'whoop_api',
      filename: logImport ? 'Manual sync' : 'Automatic sync',
      status: 'complete',
      rows_imported: written,
      range_start: days[0] ?? null,
      range_end: newestDay,
      completed_at: new Date().toISOString(),
    })
  }

  await admin.from('whoop_tokens').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: 'ok',
    last_error: null,
    rows_last_sync: written,
    // Only ever moves forward, so a Whoop revision to an older day cannot
    // make the next run look like it found something new.
    last_day: newestDay && (!row.last_day || newestDay > row.last_day)
      ? newestDay
      : row.last_day,
  }).eq('user_id', row.user_id)

  return written
}

/** Constant time, so a wrong guess cannot be narrowed down by how long the
 *  comparison took. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Is this the scheduled run rather than a person pressing "Sync now"?
 *
 * The secret is generated by the database (see migration 0004) and read back
 * here with the service-role client, so nothing has to be copied between the
 * two by hand. An earlier version had the job present the project's
 * service-role key, which meant a setup step that could be -- and was --
 * pasted with the placeholder still in it, leaving every scheduled run
 * answering 401 with nothing in the UI to show for it.
 */
async function isScheduledRun(admin: SupabaseClient, req: Request): Promise<boolean> {
  const presented = req.headers.get('X-Cron-Secret')
  if (!presented) return false

  const { data } = await admin.from('sync_config').select('cron_secret').maybeSingle()
  return !!data?.cron_secret && secretsMatch(data.cron_secret, presented)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
    const isCron = await isScheduledRun(admin, req)

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    if (!isCron && !token) return json({ error: 'Missing authorization' }, 401)

    let query = admin.from('whoop_tokens')
      .select('user_id, access_token, refresh_token, expires_at, last_sync_at, last_day')

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
        results.push({ user_id: row.user_id, rows: await syncUser(admin, row, !isCron) })
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
