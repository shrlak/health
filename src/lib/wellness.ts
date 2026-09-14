import type { Cycle, Recovery, SleepSession } from './types'
import { consistencyStats, mean } from './analytics'

/**
 * Readiness and category scoring.
 *
 * Apple's redesigned Health app is reported to show a 0-10 readiness score
 * labelled Recover / Pace Yourself / Ready / Go For It, and a Longevity tab
 * scoring heart, sleep, mental wellbeing, movement, metabolic, hearing and
 * nutrition. This module computes the same shapes from Apple Health and Whoop
 * data.
 *
 * Every score is a transparent, inspectable blend of measured inputs against
 * your own recent baseline -- not a model, and not a medical assessment. Each
 * one reports which inputs it actually had, so a score built from one signal
 * is never presented as though it were built from four.
 */

export type ReadinessBand = 'recover' | 'pace' | 'ready' | 'go'

export const BAND_LABEL: Record<ReadinessBand, string> = {
  recover: 'Recover',
  pace: 'Pace Yourself',
  ready: 'Ready',
  go: 'Go For It',
}

export const BAND_BLURB: Record<ReadinessBand, string> = {
  recover: 'Your body is asking for a lighter day. Keep intensity low and protect tonight’s sleep.',
  pace: 'You are a little under your usual baseline. Train, but leave something in reserve.',
  ready: 'You are in your normal range. A regular training day should land well.',
  go: 'Everything is sitting above baseline. This is the day for the hard session.',
}

export function bandFor(score: number): ReadinessBand {
  if (score < 4) return 'recover'
  if (score < 6) return 'pace'
  if (score < 8) return 'ready'
  return 'go'
}

export interface Contribution {
  label: string
  /** 0..1 after normalisation, or null when the input was not available. */
  value: number | null
  detail: string
}

export interface Readiness {
  /** 0-10, or null when nothing could be measured. */
  score: number | null
  band: ReadinessBand | null
  day: string | null
  contributions: Contribution[]
}

/** Scale a value to 0..1 across a plausible range, clamped at both ends. */
function norm(v: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
}

/** How far above or below a baseline, expressed as 0..1 where 0.5 is "on
 *  baseline". `spread` is the deviation that maps to the top or bottom. */
function relative(v: number, baseline: number, spread: number, higherIsBetter = true): number {
  const delta = (v - baseline) / (spread || 1)
  const scaled = 0.5 + (higherIsBetter ? delta : -delta) * 0.5
  return Math.max(0, Math.min(1, scaled))
}

/**
 * Today's readiness, from whichever of recovery, sleep, HRV and resting heart
 * rate are present. Weights are renormalised over the inputs that exist, so a
 * missing signal shifts weight rather than silently scoring zero.
 */
export function computeReadiness(
  days: string[],
  sleepByDay: Map<string, SleepSession>,
  recoveries: Map<string, Recovery>,
): Readiness {
  // The most recent day that carries anything at all.
  let day: string | null = null
  for (let i = days.length - 1; i >= 0; i--) {
    if (recoveries.has(days[i]) || sleepByDay.has(days[i])) { day = days[i]; break }
  }
  if (!day) return { score: null, band: null, day: null, contributions: [] }

  // Baselines from the preceding 30 days, excluding today.
  const window = days.slice(Math.max(0, days.indexOf(day) - 30), days.indexOf(day))
  const priorHrv = window.map((d) => recoveries.get(d)?.hrv_ms).filter((v): v is number => v != null)
  const priorRhr = window.map((d) => recoveries.get(d)?.resting_hr).filter((v): v is number => v != null)

  const rec = recoveries.get(day)
  const sleep = sleepByDay.get(day)
  const parts: Array<{ label: string; weight: number; value: number | null; detail: string }> = []

  parts.push({
    label: 'Recovery',
    weight: 0.4,
    value: rec?.recovery_pct != null ? norm(rec.recovery_pct, 0, 100) : null,
    detail: rec?.recovery_pct != null ? `${Math.round(rec.recovery_pct)}%` : 'No recovery score',
  })

  // Sleep performance where Whoop supplies it, otherwise duration against 8h.
  const perf = sleep?.performance_pct
  const asleep = sleep?.asleep_min
  parts.push({
    label: 'Sleep',
    weight: 0.3,
    value: perf != null ? norm(perf, 40, 100)
      : asleep != null ? norm(asleep, 240, 510)
      : null,
    detail: perf != null ? `${Math.round(perf)}% of need`
      : asleep != null ? `${Math.floor(asleep / 60)}h ${Math.round(asleep % 60)}m asleep`
      : 'No sleep recorded',
  })

  const hrvBase = mean(priorHrv)
  const hrvSpread = priorHrv.length > 4 ? (Math.max(...priorHrv) - Math.min(...priorHrv)) / 2 : null
  parts.push({
    label: 'HRV',
    weight: 0.2,
    value: rec?.hrv_ms != null && hrvBase != null && hrvSpread
      ? relative(rec.hrv_ms, hrvBase, hrvSpread, true) : null,
    detail: rec?.hrv_ms != null && hrvBase != null
      ? `${Math.round(rec.hrv_ms)} ms vs ${Math.round(hrvBase)} ms baseline`
      : 'No HRV baseline yet',
  })

  const rhrBase = mean(priorRhr)
  const rhrSpread = priorRhr.length > 4 ? (Math.max(...priorRhr) - Math.min(...priorRhr)) / 2 : null
  parts.push({
    label: 'Resting heart rate',
    weight: 0.1,
    value: rec?.resting_hr != null && rhrBase != null && rhrSpread
      ? relative(rec.resting_hr, rhrBase, rhrSpread, false) : null,
    detail: rec?.resting_hr != null && rhrBase != null
      ? `${Math.round(rec.resting_hr)} bpm vs ${Math.round(rhrBase)} bpm baseline`
      : 'No resting heart rate baseline yet',
  })

  const present = parts.filter((p) => p.value !== null)
  if (!present.length) {
    return {
      score: null, band: null, day,
      contributions: parts.map((p) => ({ label: p.label, value: null, detail: p.detail })),
    }
  }

  const totalWeight = present.reduce((s, p) => s + p.weight, 0)
  const blended = present.reduce((s, p) => s + p.value! * p.weight, 0) / totalWeight
  const score = Math.round(blended * 100) / 10

  return {
    score,
    band: bandFor(score),
    day,
    contributions: parts.map((p) => ({ label: p.label, value: p.value, detail: p.detail })),
  }
}

// ---------------------------------------------------------------- longevity

export type CategoryKey =
  | 'heart' | 'sleep' | 'movement' | 'metabolic' | 'mental' | 'hearing' | 'nutrition'

export interface CategoryScore {
  key: CategoryKey
  label: string
  /** 0-100, or null when there was nothing to score. */
  score: number | null
  summary: string
  /** Named inputs that fed the score, so it is never a black box. */
  inputs: string[]
}

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  heart: 'Heart health',
  sleep: 'Sleep',
  movement: 'Movement',
  metabolic: 'Metabolic health',
  mental: 'Mental wellbeing',
  hearing: 'Hearing',
  nutrition: 'Nutrition',
}

/** The palette slot each category borrows, matching the Health app's colours. */
export const CATEGORY_SLOT: Record<CategoryKey, number> = {
  heart: 0, hearing: 1, movement: 2, mental: 4, nutrition: 5, sleep: 6, metabolic: 7,
}

export function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent'
  if (score >= 65) return 'Good'
  if (score >= 50) return 'Fair'
  return 'Needs attention'
}

interface ScoreInput {
  days: string[]
  sleepByDay: Map<string, SleepSession>
  recoveries: Map<string, Recovery>
  cycles: Map<string, Cycle>
  metric: (name: string) => Map<string, number>
}

/** Average of a metric across the last `n` days that have a value. */
function recent(series: Map<string, number>, days: string[], n = 30): number | null {
  const vals: number[] = []
  for (let i = days.length - 1; i >= 0 && vals.length < n; i--) {
    const v = series.get(days[i])
    if (v !== undefined) vals.push(v)
  }
  return mean(vals)
}

export function computeCategories(input: ScoreInput): CategoryScore[] {
  const { days, sleepByDay, recoveries, cycles, metric } = input
  const out: CategoryScore[] = []

  const recentSleep = days
    .slice(-30)
    .map((d) => sleepByDay.get(d))
    .filter((s): s is SleepSession => !!s)

  // ------------------------------------------------------------- heart
  {
    const inputs: string[] = []
    const parts: number[] = []
    const rhr = mean(days.slice(-30).map((d) => recoveries.get(d)?.resting_hr)
      .filter((v): v is number => v != null))
    const hrv = mean(days.slice(-30).map((d) => recoveries.get(d)?.hrv_ms)
      .filter((v): v is number => v != null))
    const vo2 = recent(metric('vo2_max'), days)
    const rhrFallback = rhr ?? recent(metric('resting_hr'), days)

    if (rhrFallback != null) {
      // Lower is better; 45 bpm and below scores full, 75 and above scores zero.
      parts.push(1 - norm(rhrFallback, 45, 75))
      inputs.push(`Resting heart rate ${Math.round(rhrFallback)} bpm`)
    }
    if (hrv != null) {
      parts.push(norm(hrv, 25, 110))
      inputs.push(`HRV ${Math.round(hrv)} ms`)
    }
    if (vo2 != null) {
      parts.push(norm(vo2, 30, 55))
      inputs.push(`VO2 max ${vo2.toFixed(1)}`)
    }
    out.push(make('heart', parts, inputs,
      'Resting heart rate, heart rate variability and cardio fitness.'))
  }

  // ------------------------------------------------------------- sleep
  {
    const inputs: string[] = []
    const parts: number[] = []
    const asleep = mean(recentSleep.map((s) => s.asleep_min).filter((v): v is number => v != null))
    const eff = mean(recentSleep.map((s) => s.efficiency_pct).filter((v): v is number => v != null))
    const cons = consistencyStats(recentSleep)

    if (asleep != null) {
      parts.push(norm(asleep, 300, 480))
      inputs.push(`${Math.floor(asleep / 60)}h ${Math.round(asleep % 60)}m average`)
    }
    if (eff != null) {
      parts.push(norm(eff, 70, 95))
      inputs.push(`${Math.round(eff)}% efficiency`)
    }
    if (cons.bedtimeStdevH != null) {
      // Under half an hour of bedtime spread scores full; three hours scores zero.
      parts.push(1 - norm(cons.bedtimeStdevH, 0.5, 3))
      inputs.push(`Bedtime varies by ${cons.bedtimeStdevH.toFixed(1)}h`)
    }
    out.push(make('sleep', parts, inputs, 'Duration, efficiency and how steady your schedule is.'))
  }

  // ---------------------------------------------------------- movement
  {
    const inputs: string[] = []
    const parts: number[] = []
    const steps = recent(metric('steps'), days)
    const exercise = recent(metric('exercise_min'), days)
    const strain = mean(days.slice(-30).map((d) => cycles.get(d)?.strain)
      .filter((v): v is number => v != null))

    if (steps != null) {
      parts.push(norm(steps, 2000, 11000))
      inputs.push(`${Math.round(steps).toLocaleString()} steps a day`)
    }
    if (exercise != null) {
      parts.push(norm(exercise, 5, 45))
      inputs.push(`${Math.round(exercise)} exercise minutes a day`)
    }
    if (strain != null) {
      parts.push(norm(strain, 6, 15))
      inputs.push(`Strain ${strain.toFixed(1)}`)
    }
    out.push(make('movement', parts, inputs, 'Steps, exercise minutes and training load.'))
  }

  // --------------------------------------------------------- metabolic
  {
    const inputs: string[] = []
    const parts: number[] = []
    const active = recent(metric('active_energy_kcal'), days)
    const bmi = recent(metric('bmi'), days)

    if (active != null) {
      parts.push(norm(active, 200, 800))
      inputs.push(`${Math.round(active)} kcal active energy a day`)
    }
    if (bmi != null) {
      // Scores highest in the middle of the healthy range and tails off either side.
      parts.push(1 - Math.min(1, Math.abs(bmi - 22) / 8))
      inputs.push(`BMI ${bmi.toFixed(1)}`)
    }
    out.push(make('metabolic', parts, inputs, 'Energy expenditure and body composition.'))
  }

  // ------------------------------------------------------------ mental
  {
    const inputs: string[] = []
    const parts: number[] = []
    const daylight = recent(metric('daylight_min'), days)
    const mindful = recent(metric('mindful_min'), days)
    const cons = consistencyStats(recentSleep)

    if (daylight != null) {
      parts.push(norm(daylight, 15, 120))
      inputs.push(`${Math.round(daylight)} min daylight a day`)
    }
    if (mindful != null && mindful > 0) {
      parts.push(norm(mindful, 0, 20))
      inputs.push(`${Math.round(mindful)} mindful minutes a day`)
    }
    if (cons.bedtimeStdevH != null) {
      parts.push(1 - norm(cons.bedtimeStdevH, 0.5, 3))
      inputs.push('Schedule regularity')
    }
    out.push(make('mental', parts, inputs,
      'Daylight exposure, mindful minutes and how regular your days are.'))
  }

  // ----------------------------------------------------------- hearing
  {
    const inputs: string[] = []
    const parts: number[] = []
    const env = recent(metric('env_audio_db'), days)
    const head = recent(metric('headphone_audio_db'), days)

    if (env != null) {
      // 70 dB and below is comfortable; sustained 85 dB and above is not.
      parts.push(1 - norm(env, 60, 85))
      inputs.push(`${Math.round(env)} dB around you`)
    }
    if (head != null) {
      parts.push(1 - norm(head, 60, 85))
      inputs.push(`${Math.round(head)} dB in headphones`)
    }
    out.push(make('hearing', parts, inputs, 'Sound exposure, from the world and from headphones.'))
  }

  // ---------------------------------------------------------- nutrition
  {
    const inputs: string[] = []
    const parts: number[] = []
    const water = recent(metric('water_l'), days)
    const diet = recent(metric('dietary_energy_kcal'), days)

    if (water != null && water > 0) {
      parts.push(norm(water, 0.5, 2.5))
      inputs.push(`${water.toFixed(1)} L water a day`)
    }
    if (diet != null && diet > 0) {
      parts.push(norm(diet, 1200, 2400))
      inputs.push(`${Math.round(diet)} kcal logged a day`)
    }
    out.push(make('nutrition', parts, inputs, 'Whatever you log for food and water.'))
  }

  return out
}

function make(
  key: CategoryKey, parts: number[], inputs: string[], summary: string,
): CategoryScore {
  const score = parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : null
  return { key, label: CATEGORY_LABEL[key], score, summary, inputs }
}

// ----------------------------------------------------------------- insights

export interface Insight {
  /** Which category it belongs to, for colour and grouping. */
  category: CategoryKey
  headline: string
  body: string
  tone: 'neutral' | 'good' | 'warning'
}

/**
 * The Insights feed.
 *
 * Apple's version is generated by Apple Intelligence. This one is rule-based
 * and says so: each entry is a comparison the data actually supports, phrased
 * the way the Health app phrases them. Nothing here is inferred beyond what the
 * numbers show.
 */
export function buildInsights(input: ScoreInput): Insight[] {
  const { days, sleepByDay, recoveries, cycles, metric } = input
  const out: Insight[] = []
  const last7 = days.slice(-7)
  const prior21 = days.slice(-28, -7)

  const avg = (ds: string[], pick: (d: string) => number | null | undefined) =>
    mean(ds.map((d) => pick(d)).filter((v): v is number => v != null))

  // Sleep, this week against the preceding three.
  const sleep7 = avg(last7, (d) => sleepByDay.get(d)?.asleep_min)
  const sleep21 = avg(prior21, (d) => sleepByDay.get(d)?.asleep_min)
  if (sleep7 != null && sleep21 != null) {
    const delta = sleep7 - sleep21
    if (Math.abs(delta) >= 15) {
      out.push({
        category: 'sleep',
        headline: delta > 0 ? 'You are sleeping more this week' : 'You are sleeping less this week',
        body: `${Math.floor(Math.abs(delta) / 60) ? `${Math.floor(Math.abs(delta) / 60)}h ` : ''}${Math.round(Math.abs(delta) % 60)}m ${delta > 0 ? 'more' : 'less'} a night than your previous three weeks.`,
        tone: delta > 0 ? 'good' : 'warning',
      })
    }
  }

  // HRV against its own baseline.
  const hrv7 = avg(last7, (d) => recoveries.get(d)?.hrv_ms)
  const hrv21 = avg(prior21, (d) => recoveries.get(d)?.hrv_ms)
  if (hrv7 != null && hrv21 != null && Math.abs(hrv7 - hrv21) / hrv21 > 0.08) {
    const up = hrv7 > hrv21
    out.push({
      category: 'heart',
      headline: up ? 'Your HRV is trending up' : 'Your HRV is trending down',
      body: `${Math.round(hrv7)} ms over the last week against a ${Math.round(hrv21)} ms baseline. ${up ? 'That usually follows good sleep and manageable load.' : 'Often a sign of accumulated fatigue, illness or short sleep.'}`,
      tone: up ? 'good' : 'warning',
    })
  }

  // Resting heart rate drift.
  const rhr7 = avg(last7, (d) => recoveries.get(d)?.resting_hr ?? metric('resting_hr').get(d))
  const rhr21 = avg(prior21, (d) => recoveries.get(d)?.resting_hr ?? metric('resting_hr').get(d))
  if (rhr7 != null && rhr21 != null && rhr7 - rhr21 >= 2) {
    out.push({
      category: 'heart',
      headline: 'Resting heart rate is up',
      body: `${Math.round(rhr7)} bpm this week against ${Math.round(rhr21)} bpm before. A sustained rise often shows up before you feel run down.`,
      tone: 'warning',
    })
  }

  // Daytime sleep, the overnight-shift signature.
  const daytime = last7.filter((d) => {
    const s = sleepByDay.get(d)
    if (!s) return false
    const mid = new Date((new Date(s.started_at).getTime() + new Date(s.ended_at).getTime()) / 2)
    const h = mid.getHours() + mid.getMinutes() / 60
    return h >= 9 && h <= 20
  })
  if (daytime.length >= 2) {
    out.push({
      category: 'mental',
      headline: `${daytime.length} daytime sleeps this week`,
      body: 'Sleep centred in daylight hours is the pattern that follows overnight shifts. The Sleep tab compares those nights against your normal ones.',
      tone: 'neutral',
    })
  }

  // A new peak, which is the example Apple gives for the Insights feed.
  const vo2 = metric('vo2_max')
  if (vo2.size > 8) {
    const entries = [...vo2.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const latest = entries[entries.length - 1]
    const best = entries.slice(0, -1).reduce((m, e) => (e[1] > m ? e[1] : m), -Infinity)
    if (latest[1] > best) {
      out.push({
        category: 'heart',
        headline: 'New VO2 max peak',
        body: `${latest[1].toFixed(1)} mL/kg/min is the highest cardio fitness reading in this range.`,
        tone: 'good',
      })
    }
  }

  // Training load.
  const strain7 = avg(last7, (d) => cycles.get(d)?.strain)
  const strain21 = avg(prior21, (d) => cycles.get(d)?.strain)
  if (strain7 != null && strain21 != null && strain7 - strain21 >= 1.5) {
    out.push({
      category: 'movement',
      headline: 'Training load is climbing',
      body: `Average strain ${strain7.toFixed(1)} this week against ${strain21.toFixed(1)} before. Worth watching recovery alongside it.`,
      tone: 'neutral',
    })
  }

  // Steps.
  const steps7 = avg(last7, (d) => metric('steps').get(d))
  const steps21 = avg(prior21, (d) => metric('steps').get(d))
  if (steps7 != null && steps21 != null && Math.abs(steps7 - steps21) > 1200) {
    const up = steps7 > steps21
    out.push({
      category: 'movement',
      headline: up ? 'You are moving more' : 'You are moving less',
      body: `${Math.round(steps7).toLocaleString()} steps a day this week against ${Math.round(steps21).toLocaleString()} before.`,
      tone: up ? 'good' : 'neutral',
    })
  }

  return out
}
