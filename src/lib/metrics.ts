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
  // ------------------------------------------------------------------ sleep
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
      'Time actually asleep, excluding time awake in bed. Naps are kept out of this so a day sleep after a night shift does not double-count.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.asleep_min),
  },
  {
    key: 'sleep-performance',
    label: 'Sleep Performance',
    category: 'sleep',
    unit: '%',
    agg: 'avg',
    perDay: 'One score per night, calculated by Whoop',
    chart: 'bar',
    goal: { value: 85, label: '85%' },
    better: 'higher',
    description:
      'How much of the sleep Whoop said you needed you actually got. Need is not a fixed eight hours: it rises with the previous day\'s strain and with any debt you are carrying.',
    source: 'Whoop',
    format: (v) => `${n0(v)}%`,
    formatShort: (v) => `${n0(v)}%`,
    formatAxis: (v) => `${n0(v)}%`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.performance_pct),
  },
  {
    key: 'sleep-need',
    label: 'Sleep Need',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, calculated by Whoop',
    chart: 'line',
    better: 'neither',
    description:
      'What Whoop reckoned you needed that night: a baseline, plus what the previous day\'s strain added, plus whatever debt had built up, less any napping.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.need_min),
  },
  {
    key: 'sleep-debt',
    label: 'Sleep Debt',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, carried forward by Whoop',
    chart: 'area',
    better: 'lower',
    description:
      'Sleep owed from previous nights, which Whoop adds to what you need tonight. It is the part of the need figure you can actually do something about.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.debt_min),
  },
  {
    key: 'time-in-bed',
    label: 'Time in Bed',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, from the main sleep session',
    chart: 'bar',
    better: 'neither',
    description:
      'From falling asleep to getting up, awake stretches included. The gap between this and time asleep is what sleep efficiency measures.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.duration_min),
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
    source: 'Whoop',
    format: (v) => `${n0(v)}%`,
    formatShort: (v) => `${n0(v)}%`,
    formatAxis: (v) => `${n0(v)}%`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.efficiency_pct),
  },
  {
    key: 'rem-sleep',
    label: 'REM Sleep',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, from the main sleep session',
    chart: 'bar',
    better: 'higher',
    description:
      'Time in REM, the stage associated with memory and learning. It tends to sit around a fifth to a quarter of a night and is the first thing a short night cuts.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.rem_min),
  },
  {
    key: 'deep-sleep',
    label: 'Deep Sleep',
    longLabel: 'Deep (Slow Wave) Sleep',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, from the main sleep session',
    chart: 'bar',
    better: 'higher',
    description:
      'Slow-wave sleep, the stage that does most of the physical repair. It is front-loaded into the first half of a night, so a late bedtime costs it disproportionately.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.deep_min),
  },
  {
    key: 'light-sleep',
    label: 'Light Sleep',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, from the main sleep session',
    chart: 'bar',
    better: 'neither',
    description:
      'The remainder of the night once REM and deep are counted. Most of a normal night is light sleep, so this moves with total sleep rather than telling you much on its own.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${Math.round(v / 60)}h`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.light_min),
  },
  {
    key: 'awake-time',
    label: 'Awake in Bed',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One value per night, from the main sleep session',
    chart: 'bar',
    better: 'lower',
    description:
      'Time awake between falling asleep and getting up. Some is normal; a lot of it is what pulls sleep efficiency down.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${n0(v)}m`,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.awake_min),
  },
  {
    key: 'disturbances',
    label: 'Disturbances',
    category: 'sleep',
    unit: 'per night',
    agg: 'avg',
    perDay: 'One count per night, from the main sleep session',
    chart: 'bar',
    better: 'lower',
    description:
      'Times Whoop saw you surface during the night. Useful next to a noisy room or a late meal rather than on its own.',
    source: 'Whoop',
    format: n0,
    formatShort: n0,
    formatAxis: n0,
    series: (d) => fromRecord(d.sleepByDay, (s) => s.disturbances),
  },

  // ------------------------------------------------------------------ heart
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
    source: 'Whoop',
    format: (v) => `${n0(v)} ms`,
    formatShort: (v) => n0(v),
    formatAxis: n0,
    series: (d) => fromRecord(d.recoveries, (r) => r.hrv_ms),
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
    source: 'Whoop',
    format: (v) => `${n0(v)} bpm`,
    formatShort: (v) => n0(v),
    formatAxis: n0,
    series: (d) => fromRecord(d.recoveries, (r) => r.resting_hr),
  },
  {
    key: 'avg-hr',
    label: 'Average HR',
    longLabel: 'Average Heart Rate',
    category: 'heart',
    unit: 'bpm',
    agg: 'avg',
    perDay: 'One value per day, averaged by Whoop across the whole cycle',
    chart: 'line',
    better: 'neither',
    description:
      'Your heart rate averaged over the entire day, sleep included. It moves with how active the day was and with how well you recovered from it.',
    source: 'Whoop',
    format: (v) => `${n0(v)} bpm`,
    formatShort: n0,
    formatAxis: n0,
    series: (d) => fromRecord(d.cycles, (c) => c.avg_hr),
  },
  {
    key: 'max-hr',
    label: 'Peak HR',
    longLabel: 'Peak Heart Rate',
    category: 'heart',
    unit: 'bpm',
    agg: 'max',
    perDay: 'The highest reading Whoop saw that day',
    chart: 'line',
    better: 'neither',
    description:
      'The highest heart rate of the day. On a training day it says how hard the hardest effort was; on a rest day it mostly reflects stairs and stress.',
    source: 'Whoop',
    format: (v) => `${n0(v)} bpm`,
    formatShort: n0,
    formatAxis: n0,
    series: (d) => fromRecord(d.cycles, (c) => c.max_hr),
  },
  {
    key: 'skin-temp',
    label: 'Skin Temperature',
    category: 'heart',
    unit: 'C',
    agg: 'avg',
    perDay: 'One value per night, measured during sleep',
    chart: 'line',
    better: 'neither',
    description:
      'Skin temperature overnight. The absolute number matters less than a departure from your own baseline, which often precedes feeling ill.',
    source: 'Whoop',
    format: (v) => `${n1(v)} C`,
    formatShort: n1,
    formatAxis: n1,
    series: (d) => fromRecord(d.recoveries, (r) => r.skin_temp_c),
  },

  // ------------------------------------------------------------ respiratory
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
    source: 'Whoop',
    format: (v) => `${n1(v)}%`,
    formatShort: (v) => `${n0(v)}%`,
    formatAxis: n0,
    series: (d) => fromRecord(d.recoveries, (r) => r.spo2_pct),
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
    source: 'Whoop',
    format: (v) => `${n1(v)} br/min`,
    formatShort: n1,
    formatAxis: n1,
    // Whoop reports this on the sleep record, not the recovery one.
    series: (d) => fromRecord(d.sleepByDay, (s) => s.respiratory_rate),
  },

  // ------------------------------------------------------------------- move
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
    key: 'training-time',
    label: 'Training Time',
    category: 'move',
    unit: 'per day',
    agg: 'sum',
    chart: 'bar',
    goal: { value: 30, label: '30m' },
    better: 'higher',
    description: 'Time in logged workouts, summed across the day.',
    source: 'Whoop',
    format: hm,
    formatShort: hm,
    formatAxis: (v) => `${n0(v)}m`,
    series: (d) => {
      const out = new Map<string, number>()
      for (const w of d.workouts) {
        if (w.duration_min == null) continue
        out.set(w.day, (out.get(w.day) ?? 0) + w.duration_min)
      }
      return out
    },
  },
  {
    key: 'workout-distance',
    label: 'Distance',
    longLabel: 'Distance Covered',
    category: 'move',
    unit: 'km',
    agg: 'sum',
    chart: 'bar',
    better: 'higher',
    description:
      'Distance across logged workouts. Only activities where Whoop recorded distance contribute, so lifting and similar count as zero.',
    source: 'Whoop',
    format: (v) => `${n2(v)} km`,
    formatShort: n1,
    formatAxis: n0,
    series: (d) => {
      const out = new Map<string, number>()
      for (const w of d.workouts) {
        if (w.distance_km == null) continue
        out.set(w.day, (out.get(w.day) ?? 0) + w.distance_km)
      }
      return out
    },
  },

  // -------------------------------------------------------------- metabolic
  {
    key: 'energy',
    label: 'Energy Burned',
    category: 'metabolic',
    unit: 'kcal',
    agg: 'sum',
    perDay: 'One total per day, accumulated by Whoop across the whole cycle',
    chart: 'bar',
    better: 'neither',
    description:
      'Total energy for the day, resting metabolism included — Whoop measures the whole cycle rather than only the active part, so this is a larger number than an active-calories figure.',
    source: 'Whoop',
    format: (v) => `${n0(v)} kcal`,
    formatShort: (v) => (v >= 1000 ? `${n1(v / 1000)}k` : n0(v)),
    formatAxis: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : n0(v)),
    // Whoop stores kilojoules; the dashboard talks in kilocalories.
    series: (d) =>
      fromRecord(d.cycles, (c) => (c.kilojoules == null ? null : c.kilojoules / 4.184)),
  },
]

export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]))

/** The order the home page shows them in, most useful first. */
export const SUMMARY_ORDER = [
  'recovery', 'strain', 'sleep-duration', 'sleep-performance',
  'hrv', 'resting-hr', 'energy', 'training-time',
  'sleep-efficiency', 'sleep-debt', 'rem-sleep', 'deep-sleep',
  'spo2', 'respiratory-rate', 'avg-hr', 'max-hr',
  'skin-temp', 'time-in-bed', 'light-sleep', 'awake-time',
  'disturbances', 'sleep-need', 'workout-distance',
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
