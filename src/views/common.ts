import { useMemo } from 'react'
import type { HealthData } from '../lib/analytics'
import {
  cycleByDay, dayAxis, dedupeWorkouts, mainSleepByDay, recoveryByDay, seriesFor,
} from '../lib/analytics'
import type { ChartRow } from '../components/charts/ChartCard'
import { daysAgoISO, todayISO } from '../lib/format'

/** Everything the views share, computed once per data/range change. */
export function useDerived(data: HealthData, days: number) {
  return useMemo(() => {
    const sleepByDay = mainSleepByDay(data.sleep)
    const recoveries = recoveryByDay(data.recovery)
    const cycles = cycleByDay(data.cycles)
    const workouts = dedupeWorkouts(data.workouts)

    // The axis runs to today so a gap at the end reads as "no data yet"
    // rather than silently ending the chart early.
    const allDays = [
      ...sleepByDay.keys(), ...recoveries.keys(), ...cycles.keys(),
      ...data.dailyMetrics.map((m) => m.day),
    ].sort()
    const earliest = allDays[0]
    const start = earliest && earliest > daysAgoISO(days) ? earliest : daysAgoISO(days)
    const axis = earliest ? dayAxis(start, todayISO()) : []

    const metric = (name: string) => seriesFor(data.dailyMetrics, name)

    return { sleepByDay, recoveries, cycles, workouts, axis, metric, hasAny: allDays.length > 0 }
  }, [data, days])
}

export type Derived = ReturnType<typeof useDerived>

/** Build chart rows over a day axis, leaving missing days as null so charts
 *  break the line instead of interpolating across data that was never taken. */
export function rowsFrom(
  axis: string[],
  fields: Record<string, (day: string) => number | null>,
): ChartRow[] {
  return axis.map((day) => {
    const row: ChartRow = { day }
    for (const [key, get] of Object.entries(fields)) {
      const v = get(day)
      row[key] = v !== null && Number.isFinite(v) ? v : null
    }
    return row
  })
}

/** Mean of the last `n` days that actually have a value. */
export function recentMean(rows: ChartRow[], key: string, n: number): number | null {
  const vals: number[] = []
  for (let i = rows.length - 1; i >= 0 && vals.length < n; i--) {
    const v = rows[i][key]
    if (typeof v === 'number') vals.push(v)
  }
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** The most recent non-null value and the day it belongs to. */
export function latest(rows: ChartRow[], key: string): { day: string; value: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key]
    if (typeof v === 'number') return { day: rows[i].day, value: v }
  }
  return null
}

export const RANGES = [
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '180', label: '6m' },
  { value: '365', label: '1y' },
  { value: '1825', label: 'All' },
] as const
