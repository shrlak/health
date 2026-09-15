import { createClient } from 'jsr:@supabase/supabase-js@2'

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing environment variable ${name}`)
  return v
}

/**
 * Whoop's redirect target.
 *
 * Public by necessity -- the browser arrives here from Whoop with no Supabase
 * session -- so the stored one-time state is what authenticates the exchange.
 * It is consumed on use, so a replayed callback cannot bind an account twice.
 */
function done(appUrl: string, params: Record<string, string>): Response {
  const url = new URL(appUrl)
  const q = new URLSearchParams(params).toString()
  url.hash = `/connections?${q}`
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

Deno.serve(async (req) => {
  const appUrl = Deno.env.get('APP_URL') ?? 'https://shrlak.github.io/health/'

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const denied = url.searchParams.get('error')

    if (denied) return done(appUrl, { whoop: 'denied', reason: denied })
    if (!code || !state) return done(appUrl, { whoop: 'error', reason: 'missing_code' })

    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    const { data: row } = await admin
      .from('oauth_states').select('user_id, created_at').eq('state', state).maybeSingle()
    // Consume it either way, so a guessed or replayed state gets one attempt.
    await admin.from('oauth_states').delete().eq('state', state)

    if (!row) return done(appUrl, { whoop: 'error', reason: 'bad_state' })
    if (Date.now() - Date.parse(row.created_at) > 3600_000) {
      return done(appUrl, { whoop: 'error', reason: 'expired' })
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env('WHOOP_CLIENT_ID'),
      client_secret: env('WHOOP_CLIENT_SECRET'),
      redirect_uri: `${env('SUPABASE_URL')}/functions/v1/whoop-callback`,
    })
    const res = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      console.error('whoop token exchange', res.status, await res.text())
      return done(appUrl, { whoop: 'error', reason: 'exchange_failed' })
    }
    const tokens = await res.json() as {
      access_token: string; refresh_token: string; expires_in: number; scope?: string
    }

    const { error } = await admin.from('whoop_tokens').upsert({
      user_id: row.user_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      scope: tokens.scope ?? null,
      connected_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('whoop token store', error.message)
      return done(appUrl, { whoop: 'error', reason: 'store_failed' })
    }

    return done(appUrl, { whoop: 'connected' })
  } catch (e) {
    console.error('whoop-callback', e)
    return done(appUrl, { whoop: 'error', reason: 'exchange_failed' })
  }
})
