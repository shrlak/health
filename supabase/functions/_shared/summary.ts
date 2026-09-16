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
  kilojoules: number | null
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
  efficiency_pct: number | null
}

export type ReadinessBand = 'recover' | 'pace' | 'ready' | 'go'

export interface Summary {
  day: string | null
  recovery: number | null
  hrv: number | null
  restingHr: number | null
  strain: number | null
  calories: number | null
  /** The cycle's average and peak heart rate, in bpm. */
  avgHr: number | null
  maxHr: number | null
  sleepMin: number | null
  sleepNeedMin: number | null
  sleepPerformance: number | null
  sleepEfficiency: number | null
  /** 0-10, the same blend the dashboard's Insights tab shows. Null until
   *  there is at least one of recovery/sleep/HRV/resting heart rate to
   *  build it from. */
  readiness: number | null
  readinessBand: ReadinessBand | null
  /** Oldest to newest, one entry per day that has a reading. */
  recoveryTrend: Array<{ day: string; value: number }>
  strainTrend: Array<{ day: string; value: number }>
  hrvTrend: Array<{ day: string; value: number }>
  /** Minutes asleep per day, for the large widget's sleep trend. */
  sleepTrend: Array<{ day: string; value: number }>
  restingHrTrend: Array<{ day: string; value: number }>
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

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null

/** Scale a value to 0..1 across a plausible range, clamped at both ends. */
const norm = (v: number, lo: number, hi: number): number =>
  Math.max(0, Math.min(1, (v - lo) / (hi - lo)))

/** How far above or below a baseline, expressed as 0..1 where 0.5 is "on
 *  baseline". `spread` is the deviation that maps to the top or bottom. */
const relative = (v: number, baseline: number, spread: number, higherIsBetter: boolean): number => {
  const delta = (v - baseline) / (spread || 1)
  const scaled = 0.5 + (higherIsBetter ? delta : -delta) * 0.5
  return Math.max(0, Math.min(1, scaled))
}

const bandFor = (score: number): ReadinessBand => {
  if (score < 4) return 'recover'
  if (score < 6) return 'pace'
  if (score < 8) return 'ready'
  return 'go'
}

/**
 * The same 0-10 readiness blend as `computeReadiness` in the dashboard's
 * `src/lib/wellness.ts` -- recovery, sleep, HRV and resting heart rate
 * weighted 0.4/0.3/0.2/0.1, with HRV and resting heart rate judged against
 * their own trailing baseline rather than a fixed scale. Reimplemented here
 * rather than shared, since this edge function already has exactly the rows
 * it needs (the same `DAYS`-day window fetched for the trend arrays) and
 * pulling in the dashboard's richer client-side types would be more coupling
 * than the duplication it would save.
 */
function computeReadiness(
  day: string,
  recovery: RecoveryRow[],
  sleep: SleepRow[],
  priorDays: string[],
): { score: number | null; band: ReadinessBand | null } {
  const recByDay = byDay(recovery)
  const sleepByDay = byDay(sleep)
  const rec = recByDay.get(day)
  const sl = sleepByDay.get(day)

  const priorHrv = priorDays.map((d) => recByDay.get(d)?.hrv_ms).filter((v): v is number => v != null)
  const priorRhr = priorDays.map((d) => recByDay.get(d)?.resting_hr).filter((v): v is number => v != null)

  const parts: Array<{ weight: number; value: number | null }> = []

  parts.push({
    weight: 0.4,
    value: rec?.recovery_pct != null ? norm(rec.recovery_pct, 0, 100) : null,
  })

  parts.push({
    weight: 0.3,
    value: sl?.performance_pct != null ? norm(sl.performance_pct, 40, 100)
      : sl?.asleep_min != null ? norm(sl.asleep_min, 240, 510)
      : null,
  })

  const hrvBase = mean(priorHrv)
  const hrvSpread = priorHrv.length > 4 ? (Math.max(...priorHrv) - Math.min(...priorHrv)) / 2 : null
  parts.push({
    weight: 0.2,
    value: rec?.hrv_ms != null && hrvBase != null && hrvSpread
      ? relative(rec.hrv_ms, hrvBase, hrvSpread, true) : null,
  })

  const rhrBase = mean(priorRhr)
  const rhrSpread = priorRhr.length > 4 ? (Math.max(...priorRhr) - Math.min(...priorRhr)) / 2 : null
  parts.push({
    weight: 0.1,
    value: rec?.resting_hr != null && rhrBase != null && rhrSpread
      ? relative(rec.resting_hr, rhrBase, rhrSpread, false) : null,
  })

  const present = parts.filter((p) => p.value !== null)
  if (!present.length) return { score: null, band: null }

  const totalWeight = present.reduce((s, p) => s + p.weight, 0)
  const blended = present.reduce((s, p) => s + p.value! * p.weight, 0) / totalWeight
  const score = Math.round(blended * 100) / 10
  return { score, band: bandFor(score) }
}

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
  const hrvTrend = trend(recovery, (r) => r.hrv_ms)
  const sleepTrend = trend(sleep, (row) => row.asleep_min)
  const restingHrTrend = trend(recovery, (r) => r.resting_hr)

  const days = [...cycles, ...recovery, ...sleep].map((r) => r.day).filter(Boolean).sort()
  const day = days.length ? days[days.length - 1] : null

  const c = day ? byDay(cycles).get(day) : undefined
  const r = day ? byDay(recovery).get(day) : undefined
  const s = day ? byDay(sleep).get(day) : undefined

  // Every day strictly before the latest one, for the readiness baseline.
  const priorDays = day ? days.filter((d) => d < day) : []
  const readiness = day
    ? computeReadiness(day, recovery, sleep, priorDays)
    : { score: null, band: null }

  return {
    day,
    recovery: r?.recovery_pct ?? null,
    hrv: r?.hrv_ms ?? null,
    restingHr: r?.resting_hr ?? null,
    strain: c?.strain ?? null,
    calories: c?.kilojoules != null ? Math.round(c.kilojoules / 4.184) : null,
    avgHr: c?.avg_hr ?? null,
    maxHr: c?.max_hr ?? null,
    sleepMin: s?.asleep_min ?? null,
    sleepNeedMin: s?.need_min ?? null,
    sleepPerformance: s?.performance_pct ?? null,
    sleepEfficiency: s?.efficiency_pct ?? null,
    readiness: readiness.score,
    readinessBand: readiness.band,
    recoveryTrend,
    strainTrend,
    hrvTrend,
    sleepTrend,
    restingHrTrend,
    updatedAt: now.toISOString(),
  }
}
