import { supabase } from './supabase'

const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

/** Public endpoint an iPhone posts Apple Health data to. */
export const INGEST_URL = `${base}/health-ingest`

/**
 * Call an Edge Function as the signed-in user.
 *
 * The session token goes in the Authorization header; each function validates
 * it itself rather than relying on the platform's check, because that check
 * also accepts the project's anon key.
 */
export async function callFunction<T>(
  name: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const url = new URL(`${base}/${name}`)
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)

  const res = await fetch(url, {
    method: init.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  const text = await res.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { /* non-JSON error page */ }

  if (!res.ok) {
    const message = (parsed as { error?: string } | null)?.error
      ?? `${name} failed (${res.status})`
    throw new Error(message)
  }
  return parsed as T
}
