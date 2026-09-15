import { createClient } from 'jsr:@supabase/supabase-js@2'
import { CORS, env, json, localDay, round, sha256, upsertAll } from '../_shared/common.ts'

/**
 * Push endpoint for Apple Health.
 *
 * Apple exposes no cloud API -- HealthKit lives on the device -- so nothing can
 * pull this data. A device-side agent posts it here instead: Health Auto
 * Export on a schedule, or an iOS Shortcut.
 *
 * The caller holds no Supabase session, so it authenticates with a bearer
 * token minted by `ingest-token`. Only the token's SHA-256 is stored, so a
 * leaked database row does not yield a working credential.
 *
 * Accepts Health Auto Export's shape:
 *   { "data": { "metrics": [ { name, units, data: [ { date, qty } ] } ], "workouts": [...] } }
 * Its dates are `yyyy-MM-dd HH:mm:ss Z`, the same format Apple's own export.xml
 * uses, so the leading ten characters are already the correct local date.
 */

type Rec = Record<string, unknown>

/** Health Auto Export metric names mapped to this dashboard's vocabulary,
 *  with the daily rollup rule each one needs. */
const METRICS: Record<string, { metric: string; agg: 'sum' | 'avg' | 'max'; unit: string }> = {
  step_count:                        { metric: 'steps', agg: 'sum', unit: 'count' },
  walking_running_distance:          { metric: 'distance_km', agg: 'sum', unit: 'km' },
  cycling_distance:                  { metric: 'cycling_km', agg: 'sum', unit: 'km' },
  swimming_distance:                 { metric: 'swimming_km', agg: 'sum', unit: 'km' },
  flights_climbed:                   { metric: 'flights_climbed', agg: 'sum', unit: 'count' },
  active_energy:                     { metric: 'active_energy_kcal', agg: 'sum', unit: 'kcal' },
  basal_energy_burned:               { metric: 'basal_energy_kcal', agg: 'sum', unit: 'kcal' },
  apple_exercise_time:               { metric: 'exercise_min', agg: 'sum', unit: 'min' },
  apple_stand_time:                  { metric: 'stand_min', agg: 'sum', unit: 'min' },
  time_in_daylight:                  { metric: 'daylight_min', agg: 'sum', unit: 'min' },
  heart_rate:                        { metric: 'heart_rate_avg', agg: 'avg', unit: 'bpm' },
  resting_heart_rate:                { metric: 'resting_hr', agg: 'avg', unit: 'bpm' },
  walking_heart_rate_average:        { metric: 'walking_hr_avg', agg: 'avg', unit: 'bpm' },
  heart_rate_variability:            { metric: 'hrv_ms', agg: 'avg', unit: 'ms' },
  respiratory_rate:                  { metric: 'respiratory_rate', agg: 'avg', unit: 'rpm' },
  blood_oxygen_saturation:           { metric: 'spo2_pct', agg: 'avg', unit: '%' },
  vo2_max:                           { metric: 'vo2_max', agg: 'max', unit: 'mL/kg-min' },
  weight_body_mass:                  { metric: 'body_mass_kg', agg: 'avg', unit: 'kg' },
  body_fat_percentage:               { metric: 'body_fat_pct', agg: 'avg', unit: '%' },
  body_mass_index:                   { metric: 'bmi', agg: 'avg', unit: '' },
  apple_sleeping_wrist_temperature:  { metric: 'wrist_temp_c', agg: 'avg', unit: 'C' },
  environmental_audio_exposure:      { metric: 'env_audio_db', agg: 'avg', unit: 'dB' },
  headphone_audio_exposure:          { metric: 'headphone_audio_db', agg: 'avg', unit: 'dB' },
  walking_steadiness:                { metric: 'walking_steadiness_pct', agg: 'avg', unit: '%' },
  dietary_water:                     { metric: 'water_l', agg: 'sum', unit: 'L' },
  dietary_energy:                    { metric: 'dietary_energy_kcal', agg: 'sum', unit: 'kcal' },
  mindful_minutes:                   { metric: 'mindful_min', agg: 'sum', unit: 'min' },
  blood_pressure_systolic:           { metric: 'bp_systolic', agg: 'avg', unit: 'mmHg' },
  blood_pressure_diastolic:          { metric: 'bp_diastolic', agg: 'avg', unit: 'mmHg' },
}

/** Health Auto Export honours the unit set in the app, so values can arrive in
 *  miles or pounds. Normalise the ones that vary. */
function convert(value: number, units: string | null, metric: string): number {
  const u = (units ?? '').trim().toLowerCase()
  if (metric.endsWith('_km')) {
    if (u === 'mi') return value * 1.609344
    if (u === 'm') return value / 1000
  }
  if (metric === 'body_mass_kg' && (u === 'lb' || u === 'lbs')) return value * 0.45359237
  if (metric === 'wrist_temp_c' && (u === 'degf' || u === 'f' || u === '°f')) {
    return (value - 32) * 5 / 9
  }
  if (metric === 'spo2_pct' && value <= 1.0001) return value * 100
  if (metric === 'water_l' && (u === 'ml' || u === 'millilitres')) return value / 1000
  return value
}

const day = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length < 10) return null
  // Both "2024-02-06 14:30:00 -0800" and ISO start with the local date.
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : localDay(v)
}

const asNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const presented = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '').trim()
    if (!presented) return json({ error: 'Missing bearer token' }, 401)

    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    const { data: tokenRow } = await admin
      .from('ingest_tokens')
      .select('id, user_id, revoked_at')
      .eq('token_hash', await sha256(presented))
      .maybeSingle()

    if (!tokenRow || tokenRow.revoked_at) return json({ error: 'Invalid token' }, 401)
    const userId = tokenRow.user_id as string

    const payload = await req.json().catch(() => null) as Rec | null
    if (!payload) return json({ error: 'Body must be JSON' }, 400)

    const data = (payload.data ?? payload) as Rec
    const metrics = Array.isArray(data.metrics) ? data.metrics as Rec[] : []
    const workoutsIn = Array.isArray(data.workouts) ? data.workouts as Rec[] : []

    // ------------------------------------------------ daily metrics + sleep
    const acc = new Map<string, { sum: number; count: number; max: number }>()
    const sleepRows: Rec[] = []

    for (const m of metrics) {
      const name = String(m.name ?? '').toLowerCase()
      const units = typeof m.units === 'string' ? m.units : null
      const points = Array.isArray(m.data) ? m.data as Rec[] : []

      if (name === 'sleep_analysis') {
        for (const p of points) {
          const d = day(p.date ?? p.sleepEnd ?? p.sleepStart)
          const start = typeof p.sleepStart === 'string' ? p.sleepStart : null
          const end = typeof p.sleepEnd === 'string' ? p.sleepEnd : null
          if (!d || !start || !end) continue

          const toMin = (h: unknown) => {
            const n = asNum(h)
            // Health Auto Export reports sleep phases in hours.
            return n === null ? null : n * 60
          }
          const rem = toMin(p.rem)
          const deep = toMin(p.deep)
          const core = toMin(p.core)
          const awake = toMin(p.awake)
          const asleep = toMin(p.asleep) ?? ((rem ?? 0) + (deep ?? 0) + (core ?? 0) || null)
          const inBed = toMin(p.inBed) ?? asleep

          sleepRows.push({
            user_id: userId,
            source: 'apple_health',
            external_id: `hae-${new Date(start).toISOString()}`,
            day: d,
            started_at: new Date(start).toISOString(),
            ended_at: new Date(end).toISOString(),
            is_nap: false,
            duration_min: round(inBed),
            asleep_min: round(asleep),
            rem_min: round(rem),
            deep_min: round(deep),
            light_min: round(core),
            awake_min: round(awake),
            latency_min: null,
            efficiency_pct: asleep && inBed ? round((asleep / inBed) * 100) : null,
            disturbances: null,
            respiratory_rate: null,
            performance_pct: null,
            need_min: null,
            debt_min: null,
          })
        }
        continue
      }

      const spec = METRICS[name]
      if (!spec) continue

      for (const p of points) {
        const d = day(p.date)
        // Quantity metrics carry qty; aggregated ones carry avg/min/max.
        const raw = asNum(p.qty) ?? asNum(p.avg) ?? asNum(p.value)
        if (!d || raw === null) continue

        const value = convert(raw, units, spec.metric)
        const key = `${d}${spec.metric}`
        const cur = acc.get(key)
        if (cur) {
          cur.sum += value
          cur.count += 1
          if (value > cur.max) cur.max = value
        } else {
          acc.set(key, { sum: value, count: 1, max: value })
        }
      }
    }

    const metricRows: Rec[] = []
    for (const [key, a] of acc) {
      const [d, metric] = key.split('')
      const spec = Object.values(METRICS).find((s) => s.metric === metric)
      const agg = spec?.agg ?? 'avg'
      const value = agg === 'sum' ? a.sum : agg === 'max' ? a.max : a.sum / a.count
      metricRows.push({
        user_id: userId,
        day: d,
        metric,
        source: 'apple_health',
        value: round(value, 3),
        unit: spec?.unit ?? null,
      })
    }

    // ------------------------------------------------------------ workouts
    const workoutRows: Rec[] = []
    for (const w of workoutsIn) {
      const start = typeof w.start === 'string' ? w.start : null
      const end = typeof w.end === 'string' ? w.end : null
      const d = day(w.start)
      if (!start || !end || !d) continue

      const pick = (...keys: string[]): number | null => {
        for (const k of keys) {
          const v = w[k]
          const n = asNum(v) ?? asNum((v as Rec)?.qty)
          if (n !== null) return n
        }
        return null
      }

      const distanceKm = pick('distance')
      const startMs = Date.parse(start)
      const endMs = Date.parse(end)

      workoutRows.push({
        user_id: userId,
        source: 'apple_health',
        external_id: `hae-${new Date(start).toISOString()}`,
        day: d,
        started_at: new Date(start).toISOString(),
        ended_at: new Date(end).toISOString(),
        activity: typeof w.name === 'string' ? w.name : 'Workout',
        duration_min: round((endMs - startMs) / 60_000),
        energy_kcal: round(pick('activeEnergyBurned', 'activeEnergy')),
        distance_km: round(distanceKm, 3),
        avg_hr: round(pick('avgHeartRate', 'averageHeartRate')),
        max_hr: round(pick('maxHeartRate')),
        strain: null,
        zone_1_min: null, zone_2_min: null, zone_3_min: null,
        zone_4_min: null, zone_5_min: null,
      })
    }

    let written = 0
    written += await upsertAll(admin, 'daily_metrics', metricRows, 'user_id,day,metric,source')
    written += await upsertAll(admin, 'sleep_sessions', sleepRows, 'user_id,source,external_id')
    written += await upsertAll(admin, 'workouts', workoutRows, 'user_id,source,external_id')

    const days = [...metricRows, ...sleepRows, ...workoutRows]
      .map((r) => r.day as string).filter(Boolean).sort()

    if (written > 0) {
      await admin.from('imports').insert({
        user_id: userId,
        source: 'apple_api',
        filename: 'Automatic push from iPhone',
        status: 'complete',
        rows_imported: written,
        range_start: days[0] ?? null,
        range_end: days[days.length - 1] ?? null,
        completed_at: new Date().toISOString(),
      })
    }

    await admin.from('ingest_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', tokenRow.id)

    return json({
      ok: true,
      written,
      metrics: metricRows.length,
      sleep: sleepRows.length,
      workouts: workoutRows.length,
      // Naming what was ignored makes a misconfigured export obvious rather
      // than silently importing nothing.
      unrecognised: metrics
        .map((m) => String(m.name ?? ''))
        .filter((n) => n && n.toLowerCase() !== 'sleep_analysis' && !METRICS[n.toLowerCase()]),
    })
  } catch (e) {
    console.error('health-ingest', e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
