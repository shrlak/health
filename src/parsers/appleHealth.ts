import { Unzip, AsyncUnzipInflate } from 'fflate'
import type { DailyMetric, ParsedPayload, ParseProgress, SleepSession } from '../lib/types'
import { emptyPayload } from '../lib/types'
import { appleLocalDay, minutesBetween, parseAppleDate } from './appleDates'
import { asPercent, convert, type Kind } from './units'

type Agg = 'sum' | 'avg' | 'max' | 'min'

interface QuantitySpec { metric: string; agg: Agg; kind: Kind; unit: string }

/** Apple's type identifiers mapped to our own vocabulary, with the daily
 *  rollup rule each one needs. Summing a heart rate would be meaningless;
 *  averaging step counts would be too. */
const QUANTITY: Record<string, QuantitySpec> = {
  StepCount:                   { metric: 'steps',                  agg: 'sum', kind: 'raw',         unit: 'count' },
  DistanceWalkingRunning:      { metric: 'distance_km',            agg: 'sum', kind: 'distance_km', unit: 'km' },
  DistanceCycling:             { metric: 'cycling_km',             agg: 'sum', kind: 'distance_km', unit: 'km' },
  DistanceSwimming:            { metric: 'swimming_km',            agg: 'sum', kind: 'distance_km', unit: 'km' },
  FlightsClimbed:              { metric: 'flights_climbed',        agg: 'sum', kind: 'raw',         unit: 'count' },
  ActiveEnergyBurned:          { metric: 'active_energy_kcal',     agg: 'sum', kind: 'energy_kcal', unit: 'kcal' },
  BasalEnergyBurned:           { metric: 'basal_energy_kcal',      agg: 'sum', kind: 'energy_kcal', unit: 'kcal' },
  AppleExerciseTime:           { metric: 'exercise_min',           agg: 'sum', kind: 'raw',         unit: 'min' },
  AppleStandTime:              { metric: 'stand_min',              agg: 'sum', kind: 'raw',         unit: 'min' },
  TimeInDaylight:              { metric: 'daylight_min',           agg: 'sum', kind: 'raw',         unit: 'min' },
  HeartRate:                   { metric: 'heart_rate_avg',         agg: 'avg', kind: 'raw',         unit: 'bpm' },
  RestingHeartRate:            { metric: 'resting_hr',             agg: 'avg', kind: 'raw',         unit: 'bpm' },
  WalkingHeartRateAverage:     { metric: 'walking_hr_avg',         agg: 'avg', kind: 'raw',         unit: 'bpm' },
  HeartRateVariabilitySDNN:    { metric: 'hrv_ms',                 agg: 'avg', kind: 'raw',         unit: 'ms' },
  RespiratoryRate:             { metric: 'respiratory_rate',       agg: 'avg', kind: 'raw',         unit: 'rpm' },
  VO2Max:                      { metric: 'vo2_max',                agg: 'max', kind: 'raw',         unit: 'mL/kg-min' },
  BodyMass:                    { metric: 'body_mass_kg',           agg: 'avg', kind: 'mass_kg',     unit: 'kg' },
  BodyFatPercentage:           { metric: 'body_fat_pct',           agg: 'avg', kind: 'raw',         unit: '%' },
  BodyMassIndex:               { metric: 'bmi',                    agg: 'avg', kind: 'raw',         unit: '' },
  BloodPressureSystolic:       { metric: 'bp_systolic',            agg: 'avg', kind: 'raw',         unit: 'mmHg' },
  BloodPressureDiastolic:      { metric: 'bp_diastolic',           agg: 'avg', kind: 'raw',         unit: 'mmHg' },
  AppleSleepingWristTemperature: { metric: 'wrist_temp_c',         agg: 'avg', kind: 'temp_c',      unit: 'C' },
  EnvironmentalAudioExposure:  { metric: 'env_audio_db',           agg: 'avg', kind: 'raw',         unit: 'dB' },
  HeadphoneAudioExposure:      { metric: 'headphone_audio_db',     agg: 'avg', kind: 'raw',         unit: 'dB' },
  AppleWalkingSteadiness:      { metric: 'walking_steadiness_pct', agg: 'avg', kind: 'raw',         unit: '%' },
  DietaryWater:                { metric: 'water_l',                agg: 'sum', kind: 'raw',         unit: 'L' },
  DietaryEnergyConsumed:       { metric: 'dietary_energy_kcal',    agg: 'sum', kind: 'energy_kcal', unit: 'kcal' },
  MindfulSession:              { metric: 'mindful_min',            agg: 'sum', kind: 'raw',         unit: 'min' },
}

/** SpO2 needs the 0..1 -> 0..100 fixup, so it is handled apart from the table. */
const PERCENT_TYPES = new Set(['OxygenSaturation'])

/** Separator for the accumulator's composite key. A tab cannot occur in
 *  either a YYYY-MM-DD day or one of our metric slugs. */
const KEY_SEP = '\t'

interface Acc { sum: number; count: number; max: number; min: number }

class DailyAccumulator {
  private data = new Map<string, Acc>()

  add(day: string, metric: string, value: number) {
    const key = day + KEY_SEP + metric
    const cur = this.data.get(key)
    if (cur) {
      cur.sum += value
      cur.count += 1
      if (value > cur.max) cur.max = value
      if (value < cur.min) cur.min = value
    } else {
      this.data.set(key, { sum: value, count: 1, max: value, min: value })
    }
  }

  drain(specByMetric: Map<string, QuantitySpec>): DailyMetric[] {
    const out: DailyMetric[] = []
    for (const [key, acc] of this.data) {
      const sep = key.indexOf(KEY_SEP)
      const day = key.slice(0, sep)
      const metric = key.slice(sep + 1)
      const spec = specByMetric.get(metric)
      const agg = spec?.agg ?? 'avg'
      const value =
        agg === 'sum' ? acc.sum :
        agg === 'max' ? acc.max :
        agg === 'min' ? acc.min :
        acc.sum / acc.count
      out.push({
        day,
        metric,
        source: 'apple_health',
        value: Math.round(value * 1000) / 1000,
        unit: spec?.unit ?? null,
      })
    }
    return out
  }
}

const ATTR = /([A-Za-z]+)="([^"]*)"/g

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(tag))) out[m[1]] = m[2]
  return out
}

/** Index just past the '>' that closes the tag starting at `from`, skipping
 *  any '>' that sits inside a quoted attribute value. -1 if incomplete. */
function tagEnd(buf: string, from: number): number {
  let inQuote = false
  for (let i = from; i < buf.length; i++) {
    const c = buf[i]
    if (c === '"') inQuote = !inQuote
    else if (c === '>' && !inQuote) return i + 1
  }
  return -1
}

interface SleepSegment { day: string; start: Date; end: Date; stage: string }

function prettyActivity(raw: string): string {
  const name = raw
    .replace('HKWorkoutActivityType', '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return name || 'Workout'
}

function round(v: number | null): number | null {
  return v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100
}

/**
 * Parse an Apple Health `export.zip` entirely in the browser.
 *
 * The file is streamed: fflate inflates `export.xml` chunk by chunk and each
 * chunk is scanned for complete elements, so a multi-gigabyte export never
 * needs to be held in memory at once. Records are rolled up to daily values
 * *before* upload -- a decade of Apple Health is tens of millions of samples
 * but only a few thousand daily rows.
 */
export async function parseAppleHealthZip(
  file: File | Blob,
  onProgress: (p: ParseProgress) => void,
): Promise<ParsedPayload> {
  const payload = emptyPayload()
  const daily = new DailyAccumulator()
  const sleepSegments: SleepSegment[] = []

  const specByMetric = new Map<string, QuantitySpec>()
  for (const spec of Object.values(QUANTITY)) specByMetric.set(spec.metric, spec)
  specByMetric.set('spo2_pct', { metric: 'spo2_pct', agg: 'avg', kind: 'raw', unit: '%' })

  let recordCount = 0
  let bytesIn = 0
  const totalBytes = 'size' in file ? file.size : 0
  let buffer = ''
  let lastTick = 0

  const decoder = new TextDecoder('utf-8')

  const handleRecord = (tag: string) => {
    const a = attrs(tag)
    const type = a.type
    if (!type || !a.startDate) return
    recordCount++

    if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const start = parseAppleDate(a.startDate)
      const end = parseAppleDate(a.endDate)
      if (!start || !end || end <= start) return
      sleepSegments.push({
        day: appleLocalDay(a.endDate),
        start,
        end,
        stage: (a.value ?? '').replace('HKCategoryValueSleepAnalysis', ''),
      })
      return
    }

    const short = type
      .replace('HKQuantityTypeIdentifier', '')
      .replace('HKCategoryTypeIdentifier', '')
    const value = Number(a.value)
    if (!Number.isFinite(value)) return

    if (PERCENT_TYPES.has(short)) {
      daily.add(appleLocalDay(a.startDate), 'spo2_pct', asPercent(value))
      return
    }

    const spec = QUANTITY[short]
    if (!spec) return
    daily.add(appleLocalDay(a.startDate), spec.metric, convert(value, a.unit, spec.kind))
  }

  const handleWorkout = (block: string) => {
    const openEnd = tagEnd(block, 0)
    const a = attrs(block.slice(0, openEnd < 0 ? block.length : openEnd))
    const start = parseAppleDate(a.startDate)
    const end = parseAppleDate(a.endDate)
    if (!start || !end) return

    let energy: number | null = null
    let distance: number | null = null
    let avgHr: number | null = null
    let maxHr: number | null = null

    // Modern exports put totals in <WorkoutStatistics> children.
    const statRe = /<WorkoutStatistics\b([^>]*)\/?>/g
    let sm: RegExpExecArray | null
    while ((sm = statRe.exec(block))) {
      const s = attrs(sm[1])
      const t = (s.type ?? '').replace('HKQuantityTypeIdentifier', '')
      const sum = Number(s.sum)
      const avg = Number(s.average)
      const mx = Number(s.maximum)
      if (t === 'ActiveEnergyBurned' && Number.isFinite(sum)) {
        energy = convert(sum, s.unit, 'energy_kcal')
      } else if (t.startsWith('Distance') && Number.isFinite(sum)) {
        distance = convert(sum, s.unit, 'distance_km')
      } else if (t === 'HeartRate') {
        if (Number.isFinite(avg)) avgHr = avg
        if (Number.isFinite(mx)) maxHr = mx
      }
    }

    // Older exports carried totals as attributes on <Workout> itself.
    if (energy === null && Number.isFinite(Number(a.totalEnergyBurned))) {
      energy = convert(Number(a.totalEnergyBurned), a.totalEnergyBurnedUnit, 'energy_kcal')
    }
    if (distance === null && Number.isFinite(Number(a.totalDistance))) {
      distance = convert(Number(a.totalDistance), a.totalDistanceUnit, 'distance_km')
    }

    const duration = Number.isFinite(Number(a.duration))
      ? (a.durationUnit === 's' ? Number(a.duration) / 60 : Number(a.duration))
      : minutesBetween(start, end)

    payload.workouts.push({
      source: 'apple_health',
      external_id: 'ah-' + start.toISOString(),
      day: appleLocalDay(a.startDate),
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      activity: prettyActivity(a.workoutActivityType ?? ''),
      duration_min: round(duration),
      energy_kcal: round(energy),
      distance_km: round(distance),
      avg_hr: round(avgHr),
      max_hr: round(maxHr),
      strain: null,
      zone_1_min: null,
      zone_2_min: null,
      zone_3_min: null,
      zone_4_min: null,
      zone_5_min: null,
    })
  }

  const scan = (final: boolean) => {
    let pos = 0
    for (;;) {
      const lt = buffer.indexOf('<', pos)
      if (lt < 0) { pos = buffer.length; break }

      if (buffer.startsWith('<Record', lt)) {
        const end = tagEnd(buffer, lt)
        if (end < 0) break
        handleRecord(buffer.slice(lt, end))
        pos = end
      } else if (buffer.startsWith('<Workout ', lt)) {
        const openEnd = tagEnd(buffer, lt)
        if (openEnd < 0) break
        if (buffer[openEnd - 2] === '/') {
          handleWorkout(buffer.slice(lt, openEnd))
          pos = openEnd
        } else {
          const close = buffer.indexOf('</Workout>', openEnd)
          if (close < 0) break
          handleWorkout(buffer.slice(lt, close))
          pos = close + '</Workout>'.length
        }
      } else {
        // Some other element (MetadataEntry, ExportDate, ...) -- skip its '<'.
        pos = lt + 1
      }
    }
    buffer = final ? '' : buffer.slice(pos)
  }

  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip()
    unzip.register(AsyncUnzipInflate)

    let sawXml = false
    let pending = 0
    let feedDone = false
    const maybeResolve = () => { if (feedDone && pending === 0) resolve() }

    unzip.onfile = (entry) => {
      if (!entry.name.endsWith('export.xml')) return
      sawXml = true
      pending++
      entry.ondata = (err, chunk, final) => {
        if (err) { reject(err); return }
        buffer += decoder.decode(chunk, { stream: !final })
        scan(final)
        const now = Date.now()
        if (final || now - lastTick > 120) {
          lastTick = now
          onProgress({
            phase: 'Reading Apple Health export',
            ratio: totalBytes ? Math.min(0.97, bytesIn / totalBytes) : null,
            detail: recordCount.toLocaleString() + ' records',
          })
        }
        if (final) { pending--; maybeResolve() }
      }
      entry.start()
    }

    void (async () => {
      try {
        const reader = (file as Blob).stream().getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytesIn += value.byteLength
          unzip.push(value, false)
        }
        unzip.push(new Uint8Array(0), true)
        feedDone = true
        if (!sawXml) {
          reject(new Error(
            'No export.xml found in that zip. Make sure you picked the file the ' +
            'Health app produced (Health > your photo > Export All Health Data).',
          ))
          return
        }
        maybeResolve()
      } catch (e) {
        reject(e)
      }
    })()
  })

  onProgress({ phase: 'Building sleep sessions', ratio: null })
  payload.sleep = buildSleepSessions(sleepSegments)
  payload.dailyMetrics = daily.drain(specByMetric)

  return payload
}

/** Apple emits one record per sleep *stage interval*; a night is dozens of
 *  rows. Segments are stitched into sessions, splitting whenever more than an
 *  hour passes with no data at all. */
export function buildSleepSessions(segments: SleepSegment[]): SleepSession[] {
  if (!segments.length) return []
  segments.sort((a, b) => a.start.getTime() - b.start.getTime())

  const GAP_MIN = 60
  const groups: SleepSegment[][] = []
  let cur: SleepSegment[] = [segments[0]]
  let curEnd = segments[0].end

  for (let i = 1; i < segments.length; i++) {
    const s = segments[i]
    if (minutesBetween(curEnd, s.start) > GAP_MIN) {
      groups.push(cur)
      cur = [s]
      curEnd = s.end
    } else {
      cur.push(s)
      if (s.end > curEnd) curEnd = s.end
    }
  }
  groups.push(cur)

  const sessions = groups.map((g): SleepSession => {
    const start = g[0].start
    const end = g.reduce((mx, s) => (s.end > mx ? s.end : mx), g[0].end)
    let rem = 0
    let deep = 0
    let light = 0
    let awake = 0
    let asleepUnspecified = 0
    let inBed = 0

    for (const s of g) {
      const mins = minutesBetween(s.start, s.end)
      switch (s.stage) {
        case 'AsleepREM':         rem += mins; break
        case 'AsleepDeep':        deep += mins; break
        case 'AsleepCore':        light += mins; break
        case 'Awake':             awake += mins; break
        case 'AsleepUnspecified': asleepUnspecified += mins; break
        case 'InBed':             inBed += mins; break
      }
    }

    const staged = rem + deep + light
    const asleep = staged + asleepUnspecified
    const inBedTotal = Math.max(inBed, minutesBetween(start, end))

    return {
      source: 'apple_health',
      external_id: 'ah-' + start.toISOString(),
      day: g[g.length - 1].day,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      is_nap: false,
      duration_min: round(inBedTotal),
      asleep_min: round(asleep || null),
      rem_min: round(rem || null),
      deep_min: round(deep || null),
      light_min: round(light || null),
      awake_min: round(awake || null),
      latency_min: null,
      efficiency_pct: inBedTotal > 0 && asleep > 0
        ? round((asleep / inBedTotal) * 100)
        : null,
      disturbances: null,
      respiratory_rate: null,
      performance_pct: null,
      need_min: null,
      debt_min: null,
    }
  })

  // A short session on a day that also has a long one reads as a nap.
  const longestByDay = new Map<string, number>()
  for (const s of sessions) {
    const prev = longestByDay.get(s.day) ?? 0
    if ((s.duration_min ?? 0) > prev) longestByDay.set(s.day, s.duration_min ?? 0)
  }
  for (const s of sessions) {
    const longest = longestByDay.get(s.day) ?? 0
    if ((s.duration_min ?? 0) < 180 && (s.duration_min ?? 0) < longest) s.is_nap = true
  }

  return sessions
}
