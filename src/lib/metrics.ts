import type { Derived } from '../views/common'
import { CATEGORY_HUES } from './palette'
import { hm } from './format'

/** Metrics take their colour from the palette's own category vocabulary,
 *  which is finer-grained than the Longevity scoring categories -- respiratory
 *  metrics get the respiratory hue even though they score under heart. */
export type MetricCategory = (typeof CATEGORY_HUES)[number]

/**
 * One definition per metric, driving the summary grid, the detail pages and
 * the navigation between them. Adding a metric here makes it appear on the
 * home page and gives it a working detail page, with no other wiring.
 */

export type Agg = 'sum' | 'avg' | 'max'

export interface MetricDef {
  /** URL segment: /metric/<key> */
  key: string
  label: string
  /** Longer name used as the detail page's title where it differs. */
  longLabel?: string
  category: MetricCategory
  unit: string
  /** How a period is summarised: steps sum, heart rate averages. */
  agg: Agg
  /** Overrides the derived "per day" wording for measures that are recorded
   *  once per night rather than sampled through the day. */
  perDay?: string
  chart: 'bar' | 'line' | 'area'
  /** Reference line, e.g. an 8-hour sleep target. */
  goal?: { value: number; label: string }
  /** Higher is better, lower is better, or neither. Drives the arrow only. */
  better: 'higher' | 'lower' | 'neither'
  description: string
  source: string
  format: (v: number) => string
  /** Compact form for a tile, where space is tight. */
  formatShort: (v: number) => string
  /** Axis tick form. */
  formatAxis: (v: number) => string
  series: (d: Derived) => Map<string, number>
}

const n0 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })
const n1 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 })
const n2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** Pull a per-day map out of a nested record collection. */
function fromRecord<T>(
  map: Map<string, T>,
  pick: (row: T) => number | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const [day, row] of map) {
    const v = pick(row)
    if (typeof v === 'number' && Number.isFinite(v)) out.set(day, v)
  }
  return out
}

export const METRICS: MetricDef[] = [
  {
    key: 'sleep-duration',
    label: 'Sleep',
    longLabel: 'Time Asleep',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, from the main sleep session',
    chart: 'bar',
    goal: { value: 480, label: '8h' },
    better: 'higher',
    description:
      'Time actually asleep, excluding time awake in bed. Whoop is preferred where both it and Apple Watch recorded the night.',
    source: 'Whoop, Apple Watch',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.asleep_min),
  },
  {
    key: 'sleep-efficiency',
    label: 'Sleep Efficiency',
    category: 'sleep',
    unit: '%',
    agg: 'avg',
    perDay: 'One value per night, from the main sleep session',
    chart: 'line',
    goal: { value: 85, label: '85%' },
    better: 'higher',
    description: 'Share of time in bed actually spent asleep. Below about 85% usually means restless nights.',
    source: 'Whoop, Apple Watch',
    format: (v) => `${n0(v)}%`,
    formatShort: (v) => `${n0(v)}%`,
    formatAxis: (v) => `${n0(v)}%`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.efficiency_pct),
  },
  {
    key: 'recovery',
    label: 'Recovery',
    category: 'heart',
    unit: '%',
    agg: 'avg',
    perDay: 'One score per day, calculated by Whoop on waking',
    chart: 'bar',
    goal: { value: 67, label: 'Green' },
    better: 'higher',
    description:
      "Whoop's readiness score, built from HRV, resting heart rate, sleep and respiratory rate. Green is 67% and up, yellow 34-66%, red below.",
    source: 'Whoop',
    format: (v) => `${n0(v)}%`,
    formatShort: (v) => `${n0(v)}%`,
    formatAxis: (v) => `${n0(v)}%`,
    series: (d) => fromRecord(d.recoveries, (r) => r.recovery_pct),
  },
  {
    key: 'hrv',
    label: 'HRV',
    longLabel: 'Heart Rate Variability',
    category: 'heart',
    unit: 'ms',
    agg: 'avg',
    perDay: 'One value per night, measured during sleep',
    chart: 'line',
    better: 'higher',
    description:
      'Variation between heartbeats, measured overnight. Read it against your own baseline rather than against other people: a drop usually follows short sleep, hard training or illness.',
    source: 'Whoop, Apple Watch',
    format: (v) => `${n0(v)} ms`,
    formatShort: (v) => n0(v),
    formatAxis: n0,
    series: (d) => {
      const whoop = fromRecord(d.recoveries, (r) => r.hrv_ms)
      const apple = d.metric('hrv_ms')
      // Whoop's chest-strap reading wins; Apple fills the gaps.
      for (const [day, v] of apple) if (!whoop.has(day)) whoop.set(day, v)
      return whoop
    },
  },
  {
    key: 'resting-hr',
    label: 'Resting HR',
    longLabel: 'Resting Heart Rate',
    category: 'heart',
    unit: 'bpm',
    agg: 'avg',
    perDay: 'One value per night, measured during sleep',
    chart: 'line',
    better: 'lower',
    description:
      'Heart rate at rest, measured overnight. A sustained rise often shows up a day or two before you feel run down.',
    source: 'Whoop, Apple Watch',
    format: (v) => `${n0(v)} bpm`,
    formatShort: (v) => n0(v),
    formatAxis: n0,
    series: (d) => {
      const whoop = fromRecord(d.recoveries, (r) => r.resting_hr)
      const apple = d.metric('resting_hr')
      for (const [day, v] of apple) if (!whoop.has(day)) whoop.set(day, v)
      return whoop
    },
  },
  {
    key: 'strain',
    label: 'Strain',
    longLabel: 'Day Strain',
    category: 'move',
    unit: '0-21',
    agg: 'avg',
    perDay: 'One value per day, accumulated by Whoop across the day',
    chart: 'bar',
    goal: { value: 14, label: 'Strenuous' },
    better: 'neither',
    description:
      "Whoop's cardiovascular load for the day on a 0-21 scale. It is logarithmic, so the top of the range is far harder to reach than the bottom.",
    source: 'Whoop',
    format: n1,
    formatShort: n1,
    formatAxis: n0,
    series: (d) => fromRecord(d.cycles, (c) => c.strain),
  },
  {
    key: 'steps',
    label: 'Steps',
    category: 'move',
    unit: 'per day',
    agg: 'sum',
    chart: 'bar',
    goal: { value: 10000, label: '10k' },
    better: 'higher',
    description: 'Steps counted by your iPhone and Apple Watch, combined and de-duplicated by Apple Health.',
    source: 'Apple Health',
    format: n0,
    formatShort: (v) => (v >= 10000 ? `${n1(v / 1000)}k` : n0(v)),
    formatAxis: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : n0(v)),
    series: (d) => d.metric('steps'),
  },
  {
    key: 'active-energy',
    label: 'Active Energy',
    category: 'move',
    unit: 'kcal',
    agg: 'sum',
    chart: 'bar',
    better: 'higher',
    description: 'Calories burned above resting, from movement and training.',
    source: 'Apple Health, Whoop',
    format: (v) => `${n0(v)} kcal`,
    formatShort: n0,
    formatAxis: n0,
    series: (d) => {
      const apple = d.metric('active_energy_kcal')
      if (apple.size) return apple
      // Whoop stores kilojoules; the dashboard talks in kilocalories.
      return fromRecord(d.cycles, (c) => (c.kilojoules == null ? null : c.kilojoules / 4.184))
    },
  },
  {
    key: 'exercise',
    label: 'Exercise',
    longLabel: 'Exercise Minutes',
    category: 'move',
    unit: 'per day',
    agg: 'sum',
    chart: 'bar',
    goal: { value: 30, label: '30m' },
    better: 'higher',
    description: 'Minutes at brisk-walk intensity or above, as Apple Health counts them.',
    source: 'Apple Health',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${n0(v)}m`,
    series: (d) => d.metric('exercise_min'),
  },
  {
    key: 'distance',
    label: 'Distance',
    longLabel: 'Walking + Running Distance',
    category: 'move',
    unit: 'km',
    agg: 'sum',
    chart: 'bar',
    better: 'higher',
    description: 'Distance covered on foot, normalised to kilometres regardless of the units your export used.',
    source: 'Apple Health',
    format: (v) => `${n2(v)} km`,
    formatShort: n1,
    formatAxis: n0,
    series: (d) => d.metric('distance_km'),
  },
  {
    key: 'vo2-max',
    label: 'VO2 Max',
    longLabel: 'Cardio Fitness',
    category: 'heart',
    unit: 'mL/kg/min',
    agg: 'max',
    perDay: 'Estimated occasionally; the highest reading of the day is kept',
    chart: 'line',
    better: 'higher',
    description:
      "Apple's estimate of your cardio fitness. It moves slowly, so read the shape over months rather than day to day.",
    source: 'Apple Watch',
    format: n1,
    formatShort: n1,
    formatAxis: n0,
    series: (d) => d.metric('vo2_max'),
  },
  {
    key: 'spo2',
    label: 'Blood Oxygen',
    category: 'respiratory',
    unit: '%',
    agg: 'avg',
    perDay: 'One value per night, sampled during sleep',
    chart: 'line',
    better: 'higher',
    description: 'Share of your red blood cells carrying oxygen, sampled overnight.',
    source: 'Apple Watch, Whoop',
    format: (v) => `${n1(v)}%`,
    formatShort: (v) => `${n0(v)}%`,
    formatAxis: n0,
    series: (d) => {
      const whoop = fromRecord(d.recoveries, (r) => r.spo2_pct)
      const apple = d.metric('spo2_pct')
      for (const [day, v] of apple) if (!whoop.has(day)) whoop.set(day, v)
      return whoop
    },
  },
  {
    key: 'respiratory-rate',
    label: 'Respiratory Rate',
    category: 'respiratory',
    unit: 'br/min',
    agg: 'avg',
    perDay: 'One value per night, measured during sleep',
    chart: 'line',
    better: 'neither',
    description: 'Breaths per minute while asleep. Steady normally, and it drifts up when you are fighting something off.',
    source: 'Whoop, Apple Watch',
    format: (v) => `${n1(v)} br/min`,
    formatShort: n1,
    formatAxis: n1,
    series: (d) => {
      const whoop = fromRecord(d.recoveries, (r) => r.respiratory_rate)
      const apple = d.metric('respiratory_rate')
      for (const [day, v] of apple) if (!whoop.has(day)) whoop.set(day, v)
      return whoop
    },
  },
  {
    key: 'daylight',
    label: 'Daylight',
    longLabel: 'Time in Daylight',
    category: 'mental',
    unit: 'per day',
    agg: 'sum',
    chart: 'bar',
    better: 'higher',
    description:
      'Time spent outdoors in daylight. Worth watching alongside sleep if your schedule pushes you indoors at odd hours.',
    source: 'Apple Watch',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => d.metric('daylight_min'),
  },
  {
    key: 'flights',
    label: 'Flights Climbed',
    category: 'move',
    unit: 'per day',
    agg: 'sum',
    chart: 'bar',
    better: 'higher',
    description: 'Floors climbed, as counted by the barometer in your iPhone or Watch.',
    source: 'Apple Health',
    format: n0,
    formatShort: n0,
    formatAxis: n0,
    series: (d) => d.metric('flights_climbed'),
  },
  {
    key: 'body-mass',
    label: 'Weight',
    longLabel: 'Body Mass',
    category: 'metabolic',
    unit: 'kg',
    agg: 'avg',
    perDay: 'Whatever you weighed in at, averaged if you logged more than once',
    chart: 'line',
    better: 'neither',
    description: 'Body mass, normalised to kilograms regardless of the units your export used.',
    source: 'Apple Health',
    format: (v) => `${n1(v)} kg`,
    formatShort: n1,
    formatAxis: n1,
    series: (d) => d.metric('body_mass_kg'),
  },
]

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]))

/** The order the home page shows them in, most useful first. */
export const SUMMARY_ORDER = [
  'sleep-duration', 'recovery', 'strain', 'steps',
  'hrv', 'resting-hr', 'active-energy', 'exercise',
  'sleep-efficiency', 'vo2-max', 'spo2', 'respiratory-rate',
  'distance', 'daylight', 'flights', 'body-mass',
]

/** Section each metric's detail page offers as a way back up. */
export const CATEGORY_SECTION: Record<MetricCategory, { path: string; label: string }> = {
  sleep: { path: '/sleep', label: 'Sleep' },
  heart: { path: '/heart', label: 'Heart' },
  respiratory: { path: '/heart', label: 'Heart' },
  move: { path: '/move', label: 'Move' },
  metabolic: { path: '/move', label: 'Move' },
  mental: { path: '/longevity', label: 'Longevity' },
  hearing: { path: '/longevity', label: 'Longevity' },
  nutrition: { path: '/longevity', label: 'Longevity' },
}

/** Palette slot for a metric's category. */
export const metricSlot = (c: MetricCategory): number => CATEGORY_HUES.indexOf(c)
