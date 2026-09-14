/** Minutes -> "7h 42m". The dashboard shows a lot of durations and decimal
 *  hours are surprisingly hard to read at a glance. */
export function hm(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '--'
  const total = Math.round(min)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

export function num(v: number | null | undefined, digits = 0, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--'
  return v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + suffix
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format a YYYY-MM-DD as "12 Mar" without constructing a Date, which would
 *  drag the value through the viewer's timezone and can shift it a day. */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** Day of week, 0 = Sunday, derived arithmetically from the date string. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Clock time of an ISO instant in the viewer's local zone, as "23:40". */
export function clock(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Hours past midnight as a float, for plotting bed/wake times on an axis. */
export function hourOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() + d.getMinutes() / 60
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysAgoISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
