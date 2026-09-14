/** A small RFC-4180 CSV reader: quoted fields, escaped quotes, embedded
 *  newlines and commas, and tolerant of both CRLF and LF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip a UTF-8 BOM, which Whoop's exports sometimes carry.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  for (; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
      continue
    }

    if (c === '"') { inQuotes = true }
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* handled by the \n that follows */ }
    else { field += c }
  }

  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

const normalize = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Shortest overlap a prefix match may rely on. Without a floor, a candidate
 *  like "sleepdebtmin" would happily match a two-letter column. */
const MIN_PREFIX = 4

/**
 * A row keyed by normalised header, so column renames and punctuation drift in
 * Whoop's export ("Deep (SWS) duration (min)") do not break the import.
 */
export class Row {
  private readonly byKey: Map<string, string>

  constructor(byKey: Map<string, string>) {
    this.byKey = byKey
  }

  /** First candidate that is present, matched on the normalised header.
   *  Every candidate gets a chance at an exact match before any of them falls
   *  back to a prefix match, so a precise later candidate is never beaten by a
   *  fuzzy hit on an earlier one. The prefix pass absorbs unit suffixes that
   *  Whoop adds or drops between export versions ("Sleep debt" -> "Sleep debt
   *  (min)"). */
  raw(...candidates: string[]): string | undefined {
    for (const c of candidates) {
      const direct = this.byKey.get(normalize(c))
      if (direct !== undefined && direct !== '') return direct
    }
    // The header carries a suffix the candidate lacks ("Sleep debt" asked for,
    // "Sleep debt (min)" present).
    for (const c of candidates) {
      const key = normalize(c)
      if (key.length < MIN_PREFIX) continue
      for (const [k, v] of this.byKey) {
        if (v !== '' && k.startsWith(key)) return v
      }
    }
    // The candidate carries a suffix the header lacks, which is the same drift
    // in the other direction.
    for (const c of candidates) {
      const key = normalize(c)
      for (const [k, v] of this.byKey) {
        if (v !== '' && k.length >= MIN_PREFIX && key.startsWith(k)) return v
      }
    }
    return undefined
  }

  num(...candidates: string[]): number | null {
    const v = this.raw(...candidates)
    if (v === undefined) return null
    const n = Number(v.replace(/[, ]/g, ''))
    return Number.isFinite(n) ? n : null
  }

  bool(...candidates: string[]): boolean {
    const v = this.raw(...candidates)
    return v !== undefined && /^(true|yes|1)$/i.test(v.trim())
  }

  text(...candidates: string[]): string | null {
    const v = this.raw(...candidates)
    return v === undefined ? null : v.trim() || null
  }
}

export function toRows(text: string): Row[] {
  const table = parseCsv(text)
  if (table.length < 2) return []
  const headers = table[0].map(normalize)
  return table.slice(1).map((cells) => {
    const m = new Map<string, string>()
    headers.forEach((h, idx) => m.set(h, (cells[idx] ?? '').trim()))
    return new Row(m)
  })
}
