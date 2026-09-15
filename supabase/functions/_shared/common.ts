/** Helpers shared by the sync and ingest functions. */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing environment variable ${name}`)
  return v
}

/** Tokens are stored as SHA-256 hashes so a leaked row is not a usable key. */
export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The calendar day a timestamp belongs to in the wearer's own timezone.
 *
 * Whoop returns UTC instants plus the offset that was in effect, so the local
 * day is the shifted instant's date. Doing this by hand keeps a 1am bedtime on
 * the right date without depending on the server's timezone.
 */
export function localDay(iso: string | null | undefined, offset?: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null

  let shiftMin = 0
  if (offset) {
    const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim())
    if (m) {
      const mag = Number(m[2]) * 60 + Number(m[3])
      shiftMin = m[1] === '-' ? -mag : mag
    }
  }
  return new Date(t + shiftMin * 60_000).toISOString().slice(0, 10)
}

export function iso(v: string | null | undefined): string | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export const round = (v: number | null | undefined, dp = 2): number | null =>
  v === null || v === undefined || !Number.isFinite(v)
    ? null
    : Math.round(v * 10 ** dp) / 10 ** dp

/**
 * Collapse rows that share an upsert's conflict key, keeping the last one.
 *
 * Postgres aborts an `ON CONFLICT DO UPDATE` statement that would touch the
 * same row twice ("cannot affect row a second time"), so a batch carrying two
 * rows for one key fails outright rather than writing either. Callers that can
 * legitimately produce a collision merge the rows themselves first; this is the
 * backstop that keeps an unforeseen duplicate from failing the whole sync.
 */
export function dedupeBy(
  rows: Record<string, unknown>[],
  keyColumns: string,
): Record<string, unknown>[] {
  const cols = keyColumns.split(',').map((c) => c.trim()).filter(Boolean)
  if (!cols.length) return rows

  const byKey = new Map<string, Record<string, unknown>>()
  for (const row of rows) byKey.set(cols.map((c) => String(row[c])).join('\u0000'), row)
  return byKey.size === rows.length ? rows : [...byKey.values()]
}

/** Upsert in batches; Postgres caps parameters per statement. */
export async function upsertAll(
  admin: { from: (t: string) => { upsert: (rows: unknown[], opts: { onConflict: string }) => Promise<{ error: { message: string } | null }> } },
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<number> {
  const BATCH = 500
  const unique = dedupeBy(rows, onConflict)
  for (let i = 0; i < unique.length; i += BATCH) {
    const { error } = await admin.from(table).upsert(unique.slice(i, i + BATCH), { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
  return unique.length
}
