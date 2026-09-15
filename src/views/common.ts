import { useMemo } from 'react'
import type { HealthData } from '../lib/analytics'
import {
  cycleByDay, dayAxis, dedupeWorkouts, mainSleepByDay, recoveryByDay,
} from '../lib/analytics'
import type { ChartRow } from '../components/charts/ChartCard'
import { daysAgoISO, todayISO } from '../lib/format'

/** Everything the views share, computed once per data/range change.
 *  `days` is null for the All range, where the axis starts at the first day
 *  with data rather than at a window edge. */
export function useDerived(data: HealthData, days: number | null) {
  return useMemo(() => {
    const sleepByDay = mainSleepByDay(data.sleep)
    const recoveries = recoveryByDay(data.recovery)
    const cycles = cycleByDay(data.cycles)
    const workouts = dedupeWorkouts(data.workouts)

    // The axis runs to today so a gap at the end reads as "no data yet"
    // rather than silently ending the chart early.
    const allDays = [
      ...sleepByDay.keys(), ...recoveries.keys(), ...cycles.keys(),
      ...workouts.map((w) => w.day),
    ].sort()
    const earliest = allDays[0]
    const floor = days === null ? null : daysAgoISO(days)
    // Whichever is later: the window edge, or the first day there is data for.
    const start = floor ? (earliest && earliest > floor ? earliest : floor) : earliest
    const axis = earliest && start ? dayAxis(start, todayISO()) : []

    return { sleepByDay, recoveries, cycles, workouts, axis, hasAny: allDays.length > 0 }
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

/** 'all' rather than a very large number of days, so the query asks for
 *  everything instead of a window that happens to be wide enough today. */
export const ALL_RANGE = 'all'

export const RANGES = [
  { value: '1', label: '1D' },
  { value: '7', label: '1W' },
  { value: '30', label: '1M' },
  { value: '90', label: '3M' },
  { value: '180', label: '6M' },
  { value: ALL_RANGE, label: 'All' },
] as const
