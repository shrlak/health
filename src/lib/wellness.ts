import type { Cycle, Recovery, SleepSession, Workout } from './types'
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
  | 'heart' | 'sleep' | 'recovery' | 'movement' | 'respiratory' | 'metabolic'

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
  recovery: 'Recovery',
  movement: 'Movement',
  respiratory: 'Respiratory',
  metabolic: 'Metabolic health',
}

/** The palette slot each category borrows, matching the Health app's colours. */
export const CATEGORY_SLOT: Record<CategoryKey, number> = {
  heart: 0, movement: 2, respiratory: 3, recovery: 4, sleep: 6, metabolic: 7,
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
  workouts: Workout[]
}

export function computeCategories(input: ScoreInput): CategoryScore[] {
  const { days, sleepByDay, recoveries, cycles, workouts } = input
  const out: CategoryScore[] = []

  const window = days.slice(-30)
  const windowSet = new Set(window)

  const recentSleep = window
    .map((d) => sleepByDay.get(d))
    .filter((s): s is SleepSession => !!s)

  /** Average of a field across the scoring window's days that have a value. */
  const avgOf = (pick: (day: string) => number | null | undefined): number | null =>
    mean(window.map(pick).filter((v): v is number => v != null))

  // ------------------------------------------------------------- heart
  {
    const inputs: string[] = []
    const parts: number[] = []
    const rhr = avgOf((d) => recoveries.get(d)?.resting_hr)
    const hrv = avgOf((d) => recoveries.get(d)?.hrv_ms)

    if (rhr != null) {
      // Lower is better; 45 bpm and below scores full, 75 and above scores zero.
      parts.push(1 - norm(rhr, 45, 75))
      inputs.push(`Resting heart rate ${Math.round(rhr)} bpm`)
    }
    if (hrv != null) {
      parts.push(norm(hrv, 25, 110))
      inputs.push(`HRV ${Math.round(hrv)} ms`)
    }
    out.push(make('heart', parts, inputs,
      'Resting heart rate and heart rate variability, measured overnight.'))
  }

  // ------------------------------------------------------------- sleep
  {
    const inputs: string[] = []
    const parts: number[] = []
    const asleep = mean(recentSleep.map((s) => s.asleep_min).filter((v): v is number => v != null))
    const eff = mean(recentSleep.map((s) => s.efficiency_pct).filter((v): v is number => v != null))
    const perf = mean(recentSleep.map((s) => s.performance_pct).filter((v): v is number => v != null))
    const cons = consistencyStats(recentSleep)

    if (asleep != null) {
      parts.push(norm(asleep, 300, 480))
      inputs.push(`${Math.floor(asleep / 60)}h ${Math.round(asleep % 60)}m average`)
    }
    if (eff != null) {
      parts.push(norm(eff, 70, 95))
      inputs.push(`${Math.round(eff)}% efficiency`)
    }
    if (perf != null) {
      // Whoop's own verdict on whether the night covered what it needed to.
      parts.push(norm(perf, 50, 95))
      inputs.push(`${Math.round(perf)}% of sleep need met`)
    }
    if (cons.bedtimeStdevH != null) {
      // Under half an hour of bedtime spread scores full; three hours scores zero.
      parts.push(1 - norm(cons.bedtimeStdevH, 0.5, 3))
      inputs.push(`Bedtime varies by ${cons.bedtimeStdevH.toFixed(1)}h`)
    }
    out.push(make('sleep', parts, inputs,
      'Duration, efficiency, how much of your need you met, and how steady the schedule is.'))
  }

  // ---------------------------------------------------------- recovery
  {
    const inputs: string[] = []
    const parts: number[] = []
    const recovery = avgOf((d) => recoveries.get(d)?.recovery_pct)
    const debt = mean(recentSleep.map((s) => s.debt_min).filter((v): v is number => v != null))

    if (recovery != null) {
      // Whoop's own scale: the score already runs 0-100 the right way round.
      parts.push(recovery / 100)
      inputs.push(`Recovery ${Math.round(recovery)}%`)
    }
    if (debt != null) {
      // No debt scores full; two hours owed scores zero.
      parts.push(1 - norm(debt, 0, 120))
      inputs.push(`${Math.round(debt)} min sleep debt`)
    }
    out.push(make('recovery', parts, inputs,
      "Whoop's readiness score and the sleep debt carried into it."))
  }

  // ---------------------------------------------------------- movement
  {
    const inputs: string[] = []
    const parts: number[] = []
    const strain = avgOf((d) => cycles.get(d)?.strain)

    const trainingByDay = new Map<string, number>()
    for (const w of workouts) {
      if (!windowSet.has(w.day) || w.duration_min == null) continue
      trainingByDay.set(w.day, (trainingByDay.get(w.day) ?? 0) + w.duration_min)
    }
    // Days with no workout count as zero rather than being skipped, so a single
    // hard session in a month cannot read as a month of training.
    const training = window.length
      ? window.reduce((sum, d) => sum + (trainingByDay.get(d) ?? 0), 0) / window.length
      : null

    if (strain != null) {
      parts.push(norm(strain, 6, 15))
      inputs.push(`Strain ${strain.toFixed(1)}`)
    }
    if (training != null) {
      parts.push(norm(training, 5, 45))
      inputs.push(`${Math.round(training)} min training a day`)
    }
    out.push(make('movement', parts, inputs, 'Day strain and time spent in logged workouts.'))
  }

  // ------------------------------------------------------- respiratory
  {
    const inputs: string[] = []
    const parts: number[] = []
    const spo2 = avgOf((d) => recoveries.get(d)?.spo2_pct)
    const rr = mean(recentSleep.map((s) => s.respiratory_rate).filter((v): v is number => v != null))

    if (spo2 != null) {
      // 95% and above is unremarkable; sustained 90% is not.
      parts.push(norm(spo2, 90, 97))
      inputs.push(`Blood oxygen ${spo2.toFixed(1)}%`)
    }
    if (rr != null) {
      // Scored on steadiness around a typical 14 breaths a minute rather than
      // on direction, since neither end is good news on its own.
      parts.push(1 - Math.min(1, Math.abs(rr - 14) / 6))
      inputs.push(`${rr.toFixed(1)} breaths a minute asleep`)
    }
    out.push(make('respiratory', parts, inputs,
      'Blood oxygen and breathing rate, both sampled while you sleep.'))
  }

  // --------------------------------------------------------- metabolic
  {
    const inputs: string[] = []
    const parts: number[] = []
    // Whoop stores kilojoules; the dashboard talks in kilocalories.
    const energy = avgOf((d) => {
      const kj = cycles.get(d)?.kilojoules
      return kj == null ? null : kj / 4.184
    })

    if (energy != null) {
      // A whole-cycle figure, resting metabolism included, so the band sits
      // well above what an active-calories number would.
      parts.push(norm(energy, 1800, 3200))
      inputs.push(`${Math.round(energy)} kcal a day`)
    }
    out.push(make('metabolic', parts, inputs,
      'Total energy burned across the day, resting metabolism included.'))
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
  const { days, sleepByDay, recoveries, cycles, workouts } = input
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
  const rhr7 = avg(last7, (d) => recoveries.get(d)?.resting_hr)
  const rhr21 = avg(prior21, (d) => recoveries.get(d)?.resting_hr)
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
      category: 'recovery',
      headline: `${daytime.length} daytime sleeps this week`,
      body: 'Sleep centred in daylight hours is the pattern that follows overnight shifts. The Sleep tab compares those nights against your normal ones.',
      tone: 'neutral',
    })
  }

  // A new peak. Apple's example for this feed was VO2 max, which needs a
  // Watch; HRV is the equivalent signal Whoop measures every night.
  const hrvSeries = days
    .map((d) => ({ day: d, value: recoveries.get(d)?.hrv_ms }))
    .filter((e): e is { day: string; value: number } => e.value != null)
  if (hrvSeries.length > 8) {
    const latest = hrvSeries[hrvSeries.length - 1]
    const best = hrvSeries.slice(0, -1).reduce((m, e) => Math.max(m, e.value), -Infinity)
    if (latest.value > best) {
      out.push({
        category: 'heart',
        headline: 'New HRV high',
        body: `${Math.round(latest.value)} ms is the highest overnight reading in this range.`,
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

  // Time in logged workouts, the Whoop stand-in for a step count. Days with
  // no workout count as zero so a rest week reads as one.
  const trainingOn = (day: string) =>
    workouts.reduce((sum, w) => (w.day === day ? sum + (w.duration_min ?? 0) : sum), 0)
  const train7 = mean(last7.map(trainingOn))
  const train21 = mean(prior21.map(trainingOn))
  if (train7 != null && train21 != null && Math.abs(train7 - train21) >= 10) {
    const up = train7 > train21
    out.push({
      category: 'movement',
      headline: up ? 'You are training more' : 'You are training less',
      body: `${Math.round(train7)} minutes a day this week against ${Math.round(train21)} before.`,
      tone: up ? 'good' : 'neutral',
    })
  }

  // Sleep debt, which is the number a shift schedule moves first.
  const debt7 = avg(last7, (d) => sleepByDay.get(d)?.debt_min)
  if (debt7 != null && debt7 >= 45) {
    out.push({
      category: 'sleep',
      headline: 'Sleep debt is building',
      body: `Whoop has you carrying about ${Math.round(debt7)} minutes of debt a night this week. It is added to what you need tonight, so it compounds until a long night clears it.`,
      tone: 'warning',
    })
  }

  return out
}
