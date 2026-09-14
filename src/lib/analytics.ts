import type { Cycle, DailyMetric, Recovery, SleepSession, Workout } from './types'
import { hourOfDay, weekdayOf } from './format'

export interface HealthData {
  dailyMetrics: DailyMetric[]
  sleep: SleepSession[]
  recovery: Recovery[]
  cycles: Cycle[]
  workouts: Workout[]
}

export const emptyHealthData = (): HealthData => ({
  dailyMetrics: [], sleep: [], recovery: [], cycles: [], workouts: [],
})

/** Both wearables report many of the same metrics. Whoop's chest-strap-grade
 *  HRV and recovery are the better signal where both exist; Apple wins on
 *  step counts and anything phone-derived. */
const SOURCE_RANK: Record<string, number> = {
  whoop_api: 3,
  whoop_csv: 2,
  apple_health: 1,
}

/** Collapse a metric to one value per day, preferring the better source. */
export function seriesFor(metrics: DailyMetric[], metric: string): Map<string, number> {
  const best = new Map<string, { value: number; rank: number }>()
  for (const m of metrics) {
    if (m.metric !== metric) continue
    const rank = SOURCE_RANK[m.source] ?? 0
    const cur = best.get(m.day)
    if (!cur || rank > cur.rank) best.set(m.day, { value: m.value, rank })
  }
  const out = new Map<string, number>()
  for (const [day, v] of best) out.set(day, v.value)
  return out
}

export function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x))
  if (!v.length) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export function stdev(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length < 2) return null
  const m = v.reduce((a, b) => a + b, 0) / v.length
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
}

/** Trailing rolling mean; null until the window has enough real values. */
export function rolling(
  rows: Array<{ day: string; value: number | null }>,
  window: number,
  minPoints = Math.ceil(window / 2),
): Array<{ day: string; value: number | null }> {
  return rows.map((_, i) => {
    const slice = rows.slice(Math.max(0, i - window + 1), i + 1)
    const vals = slice.map((r) => r.value).filter((v): v is number => v !== null)
    return {
      day: rows[i].day,
      value: vals.length >= minPoints ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    }
  })
}

/** Pearson correlation over the pairs where both series have a value. */
export function correlate(
  a: Map<string, number>,
  b: Map<string, number>,
): { r: number; n: number } | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const [day, x] of a) {
    const y = b.get(day)
    if (y !== undefined && Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y) }
  }
  if (xs.length < 8) return null

  const mx = xs.reduce((s, v) => s + v, 0) / xs.length
  const my = ys.reduce((s, v) => s + v, 0) / ys.length
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < xs.length; i++) {
    const a1 = xs[i] - mx
    const b1 = ys[i] - my
    num += a1 * b1
    dx += a1 * a1
    dy += b1 * b1
  }
  if (dx === 0 || dy === 0) return null
  return { r: num / Math.sqrt(dx * dy), n: xs.length }
}

/** A continuous list of days so charts show gaps as gaps rather than closing
 *  over missing data and implying continuity that was not measured. */
export function dayAxis(start: string, end: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const cur = new Date(Date.UTC(sy, sm - 1, sd))
  const last = new Date(Date.UTC(ey, em - 1, ed))
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/** The main (non-nap) sleep for each day, best source first. */
export function mainSleepByDay(sleep: SleepSession[]): Map<string, SleepSession> {
  const out = new Map<string, SleepSession>()
  for (const s of sleep) {
    if (s.is_nap) continue
    const cur = out.get(s.day)
    if (!cur) { out.set(s.day, s); continue }
    const better =
      (SOURCE_RANK[s.source] ?? 0) - (SOURCE_RANK[cur.source] ?? 0) ||
      (s.asleep_min ?? 0) - (cur.asleep_min ?? 0)
    if (better > 0) out.set(s.day, s)
  }
  return out
}

export function recoveryByDay(recovery: Recovery[]): Map<string, Recovery> {
  const out = new Map<string, Recovery>()
  for (const r of recovery) {
    const cur = out.get(r.day)
    if (!cur || (SOURCE_RANK[r.source] ?? 0) > (SOURCE_RANK[cur.source] ?? 0)) out.set(r.day, r)
  }
  return out
}

export function cycleByDay(cycles: Cycle[]): Map<string, Cycle> {
  const out = new Map<string, Cycle>()
  for (const c of cycles) {
    const cur = out.get(c.day)
    if (!cur || (SOURCE_RANK[c.source] ?? 0) > (SOURCE_RANK[cur.source] ?? 0)) out.set(c.day, c)
  }
  return out
}

/** Workouts deduplicated across sources: the same session logged by both the
 *  watch and Whoop should count once. Overlapping windows collapse to the
 *  better-instrumented record. */
export function dedupeWorkouts(workouts: Workout[]): Workout[] {
  const sorted = [...workouts].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  )
  const out: Workout[] = []
  for (const w of sorted) {
    const start = new Date(w.started_at).getTime()
    const prev = out[out.length - 1]
    if (prev) {
      const prevStart = new Date(prev.started_at).getTime()
      const prevEnd = new Date(prev.ended_at).getTime()
      // Same session if it starts within 10 minutes of the previous one, or
      // while the previous one is still running.
      if (Math.abs(start - prevStart) < 10 * 60_000 || start < prevEnd) {
        const score = (x: Workout) =>
          (x.strain !== null ? 2 : 0) + (x.avg_hr !== null ? 1 : 0) + (x.energy_kcal !== null ? 1 : 0)
        if (score(w) > score(prev)) out[out.length - 1] = { ...w }
        else {
          // Fill gaps in the kept record from the discarded one.
          out[out.length - 1] = {
            ...prev,
            strain: prev.strain ?? w.strain,
            avg_hr: prev.avg_hr ?? w.avg_hr,
            max_hr: prev.max_hr ?? w.max_hr,
            energy_kcal: prev.energy_kcal ?? w.energy_kcal,
            distance_km: prev.distance_km ?? w.distance_km,
          }
        }
        continue
      }
    }
    out.push({ ...w })
  }
  return out
}

/**
 * Sleep-consistency: how tightly bed and wake times cluster. Whoop computes
 * its own version; this one works from any source and is what makes the
 * night-shift comparison meaningful.
 *
 * Bedtimes are unwrapped around midnight first -- otherwise a 23:50 and a
 * 00:10 bedtime look 23.7 hours apart instead of 20 minutes.
 */
export function circularStdevHours(hours: number[]): number | null {
  if (hours.length < 2) return null
  let sumSin = 0
  let sumCos = 0
  for (const h of hours) {
    const theta = (h / 24) * 2 * Math.PI
    sumSin += Math.sin(theta)
    sumCos += Math.cos(theta)
  }
  const r = Math.sqrt(sumSin ** 2 + sumCos ** 2) / hours.length
  if (r <= 0 || r >= 1) return 0
  return Math.sqrt(-2 * Math.log(r)) * (24 / (2 * Math.PI))
}

export interface ShiftSplit {
  label: string
  days: string[]
  sleepMin: number | null
  efficiency: number | null
  recovery: number | null
  hrv: number | null
  restingHr: number | null
  remPct: number | null
  deepPct: number | null
}

/**
 * Split days by whether sleep looks shifted into daylight hours.
 *
 * A session whose midpoint lands between 09:00 and 20:00 is counted as
 * "daytime sleep" -- the signature of recovering from an overnight shift.
 * This is inferred from the data rather than from a roster, so it needs no
 * manual logging.
 */
export function splitByDaytimeSleep(
  sleepByDay: Map<string, SleepSession>,
  recoveries: Map<string, Recovery>,
): { day: ShiftSplit; night: ShiftSplit } {
  const daytimeDays: string[] = []
  const nighttimeDays: string[] = []

  for (const [day, s] of sleepByDay) {
    const start = new Date(s.started_at).getTime()
    const end = new Date(s.ended_at).getTime()
    const mid = new Date((start + end) / 2)
    const midHour = mid.getHours() + mid.getMinutes() / 60
    if (midHour >= 9 && midHour <= 20) daytimeDays.push(day)
    else nighttimeDays.push(day)
  }

  const summarize = (label: string, days: string[]): ShiftSplit => {
    const sessions = days.map((d) => sleepByDay.get(d)).filter((s): s is SleepSession => !!s)
    const recs = days.map((d) => recoveries.get(d)).filter((r): r is Recovery => !!r)
    const asleep = sessions.map((s) => s.asleep_min).filter((v): v is number => v !== null)
    return {
      label,
      days,
      sleepMin: mean(asleep),
      efficiency: mean(sessions.map((s) => s.efficiency_pct).filter((v): v is number => v !== null)),
      recovery: mean(recs.map((r) => r.recovery_pct).filter((v): v is number => v !== null)),
      hrv: mean(recs.map((r) => r.hrv_ms).filter((v): v is number => v !== null)),
      restingHr: mean(recs.map((r) => r.resting_hr).filter((v): v is number => v !== null)),
      remPct: mean(sessions
        .filter((s) => s.rem_min !== null && s.asleep_min)
        .map((s) => (s.rem_min! / s.asleep_min!) * 100)),
      deepPct: mean(sessions
        .filter((s) => s.deep_min !== null && s.asleep_min)
        .map((s) => (s.deep_min! / s.asleep_min!) * 100)),
    }
  }

  return {
    day: summarize('After overnight shifts', daytimeDays),
    night: summarize('Normal nights', nighttimeDays),
  }
}

/** Bedtime/wake clustering, used for the consistency headline. */
export function consistencyStats(sessions: SleepSession[]) {
  const bed = sessions.map((s) => hourOfDay(s.started_at))
  const wake = sessions.map((s) => hourOfDay(s.ended_at))
  return {
    bedtimeStdevH: circularStdevHours(bed),
    wakeStdevH: circularStdevHours(wake),
    n: sessions.length,
  }
}

/** Mean of a numeric field grouped by weekday, for the weekly-rhythm view. */
export function byWeekday<T>(
  rows: Array<{ day: string; row: T }>,
  pick: (row: T) => number | null,
): Array<{ weekday: number; value: number | null; n: number }> {
  const buckets: number[][] = [[], [], [], [], [], [], []]
  for (const { day, row } of rows) {
    const v = pick(row)
    if (v !== null && Number.isFinite(v)) buckets[weekdayOf(day)].push(v)
  }
  return buckets.map((vals, weekday) => ({
    weekday,
    value: mean(vals),
    n: vals.length,
  }))
}
