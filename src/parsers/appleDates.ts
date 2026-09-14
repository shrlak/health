/** Apple Health writes dates as "2024-01-15 07:23:11 -0500" — a local wall
 *  clock plus the UTC offset that was in effect when the sample was recorded. */

const OFFSET = /([+-]\d{2})(\d{2})$/

export function parseAppleDate(s: string): Date | null {
  if (!s) return null
  // "2024-01-15 07:23:11 -0500" -> "2024-01-15T07:23:11-05:00"
  const iso = s.replace(' ', 'T').replace(' ', '').replace(OFFSET, '$1:$2')
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The calendar day *as the user experienced it*. Because Apple embeds the
 *  recording offset, the leading 10 characters are already the correct local
 *  date — no timezone maths, and it stays right across travel and DST. */
export function appleLocalDay(s: string): string {
  return s.slice(0, 10)
}

/** Shift a YYYY-MM-DD string by whole days without touching UTC semantics. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000
}
