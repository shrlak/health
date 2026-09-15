import { createClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, env, json } from '../_shared/common.ts'

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth'

/** `offline` is what gets us a refresh token; without it the connection dies
 *  after an hour and can only be restored by the user re-authorising. */
const WHOOP_SCOPES = [
  'offline',
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:workout',
  'read:profile',
  'read:body_measurement',
].join(' ')

/**
 * Starts the Whoop authorization round trip.
 *
 * Returns the URL to send the user to. A one-time state value is stored first:
 * the callback arrives with no session, so state is the only thing tying the
 * redirect back to this user, and it is what stops someone else's callback
 * from attaching their Whoop account to this one.
 *
 * JWT verification is done here rather than by the platform, because the
 * platform's check also accepts the project's anon key -- which every visitor
 * has. Only a real user token should be able to start this.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    const { data: userData, error: userErr } = await admin.auth.getUser(
      authHeader.replace(/^Bearer /i, ''),
    )
    if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401)
    const userId = userData.user.id

    const clientId = env('WHOOP_CLIENT_ID')
    const redirectUri = `${env('SUPABASE_URL')}/functions/v1/whoop-callback`

    // Whoop requires at least eight characters.
    const state = crypto.randomUUID().replace(/-/g, '')

    const body = await req.json().catch(() => ({})) as { redirectTo?: string }

    const { error } = await admin.from('oauth_states').insert({
      state, user_id: userId, provider: 'whoop', redirect_to: body.redirectTo ?? null,
    })
    if (error) return json({ error: `Could not start authorization: ${error.message}` }, 500)

    // Anything older than an hour is abandoned; clearing here avoids a cron job
    // for a table that only ever holds a handful of rows.
    await admin.from('oauth_states')
      .delete()
      .lt('created_at', new Date(Date.now() - 3600_000).toISOString())

    const url = new URL(WHOOP_AUTH_URL)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', WHOOP_SCOPES)
    url.searchParams.set('state', state)

    return json({ url: url.toString() })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
