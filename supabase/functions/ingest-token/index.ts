import { createClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, env, json, sha256 } from '../_shared/common.ts'

/**
 * Mints and revokes the bearer tokens the iPhone uses to push Apple Health
 * data.
 *
 * Minting happens here rather than in the browser so the plaintext is
 * generated server-side and only its hash is ever stored. The value is
 * returned exactly once; after that the database holds nothing that can be
 * turned back into a working credential.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401)
    const userId = userData.user.id

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as { label?: string }

      // 32 random bytes, base64url. Generated here so it never depends on the
      // browser's entropy or travels further than this response.
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const token = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

      const { error } = await admin.from('ingest_tokens').insert({
        user_id: userId,
        token_hash: await sha256(token),
        token_hint: token.slice(0, 6),
        label: body.label ?? 'iPhone',
      })
      if (error) return json({ error: error.message }, 500)

      return json({ token, hint: token.slice(0, 6) })
    }

    if (req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id')
      if (!id) return json({ error: 'Missing id' }, 400)
      const { error } = await admin.from('ingest_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        // Scoped to the caller, so an id from another account cannot be revoked.
        .eq('user_id', userId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ error: 'POST or DELETE' }, 405)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
