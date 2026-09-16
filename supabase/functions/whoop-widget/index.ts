import { createClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, env, json, sha256 } from '../_shared/common.ts'
import { summarise } from '../_shared/summary.ts'

/**
 * What the Mac widget reads.
 *
 * A widget process is woken by WidgetKit on its own schedule and has no way to
 * hold a Supabase session, so it presents a long-lived read-only token instead.
 * Only the hash of that token is stored, and a read token cannot write.
 *
 * Deployed with verify_jwt off, because the caller has no JWT; the token check
 * below is the whole of the authentication, so it runs before anything else.
 */

// 30 days rather than a shorter window because the readiness score judges
// today's HRV and resting heart rate against a trailing baseline, the same
// horizon the dashboard's Insights tab uses.
const DAYS = 30

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405)

  try {
    const presented = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '').trim()
    if (!presented) return json({ error: 'Missing token' }, 401)

    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    const { data: tokenRow } = await admin.from('ingest_tokens')
      .select('id, user_id, revoked_at, scope')
      .eq('token_hash', await sha256(presented))
      .maybeSingle()
    // Same answer for a wrong token and a revoked one, so neither is
    // distinguishable from the outside.
    if (!tokenRow || tokenRow.revoked_at) return json({ error: 'Invalid token' }, 401)

    const userId = tokenRow.user_id as string
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10)

    const [cycles, recovery, sleep] = await Promise.all([
      admin.from('cycles')
        .select('day, strain, avg_hr, max_hr, kilojoules')
        .eq('user_id', userId).gte('day', since),
      admin.from('recovery')
        .select('day, recovery_pct, hrv_ms, resting_hr')
        .eq('user_id', userId).gte('day', since),
      admin.from('sleep_sessions')
        .select('day, asleep_min, need_min, performance_pct, efficiency_pct')
        .eq('user_id', userId).gte('day', since).eq('is_nap', false),
    ])

    const failed = [cycles, recovery, sleep].find((r) => r.error)
    if (failed?.error) return json({ error: failed.error.message }, 500)

    // Best effort: a widget refresh should not fail because a bookkeeping
    // write did.
    await admin.from('ingest_tokens')
      .update({ last_used_at: new Date().toISOString() }).eq('id', tokenRow.id)

    return json(summarise(cycles.data ?? [], recovery.data ?? [], sleep.data ?? []))
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
