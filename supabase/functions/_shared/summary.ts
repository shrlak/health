/**
 * The figures the Mac widget shows.
 *
 * Kept apart from the endpoint so it can be tested without a database: a
 * widget that quietly renders a stale or wrong number is worse than one that
 * fails visibly, and there is nowhere in a widget to surface a mistake.
 */

export interface CycleRow {
  day: string
  strain: number | null
  avg_hr: number | null
  max_hr: number | null
}

export interface RecoveryRow {
  day: string
  recovery_pct: number | null
  hrv_ms: number | null
  resting_hr: number | null
}

export interface SleepRow {
  day: string
  asleep_min: number | null
  need_min: number | null
  performance_pct: number | null
}

export interface Summary {
  day: string | null
  recovery: number | null
  hrv: number | null
  restingHr: number | null
  strain: number | null
  sleepMin: number | null
  sleepNeedMin: number | null
  sleepPerformance: number | null
  /** Oldest to newest, one entry per day that has a reading. */
  recoveryTrend: Array<{ day: string; value: number }>
  strainTrend: Array<{ day: string; value: number }>
  updatedAt: string
}

const byDay = <T extends { day: string }>(rows: T[]): Map<string, T> => {
  const m = new Map<string, T>()
  for (const r of rows) if (r.day) m.set(r.day, r)
  return m
}

const trend = <T extends { day: string }>(
  rows: T[], pick: (r: T) => number | null,
): Array<{ day: string; value: number }> =>
  rows
    .filter((r) => r.day)
    .map((r) => ({ day: r.day, value: pick(r) }))
    .filter((p): p is { day: string; value: number } => p.value !== null)
    .sort((a, b) => a.day.localeCompare(b.day))

/**
 * The most recent day with anything on it.
 *
 * Not simply "today": Whoop scores a night when you wake, so on an overnight
 * shift the newest complete day is often yesterday's date, and a widget that
 * asked for today alone would show blanks for most of the morning.
 */
export function summarise(
  cycles: CycleRow[],
  recovery: RecoveryRow[],
  sleep: SleepRow[],
  now: Date = new Date(),
): Summary {
  const recoveryTrend = trend(recovery, (r) => r.recovery_pct)
  const strainTrend = trend(cycles, (c) => c.strain)

  const days = [...cycles, ...recovery, ...sleep].map((r) => r.day).filter(Boolean).sort()
  const day = days.length ? days[days.length - 1] : null

  const c = day ? byDay(cycles).get(day) : undefined
  const r = day ? byDay(recovery).get(day) : undefined
  const s = day ? byDay(sleep).get(day) : undefined

  return {
    day,
    recovery: r?.recovery_pct ?? null,
    hrv: r?.hrv_ms ?? null,
    restingHr: r?.resting_hr ?? null,
    strain: c?.strain ?? null,
    sleepMin: s?.asleep_min ?? null,
    sleepNeedMin: s?.need_min ?? null,
    sleepPerformance: s?.performance_pct ?? null,
    recoveryTrend,
    strainTrend,
    updatedAt: now.toISOString(),
  }
}
