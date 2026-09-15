/**
 * Checks for the automatic-sync mappers.
 *
 * These matter more than most tests here: the Whoop code could not be run
 * against a live account while it was written, so these fixtures are the only
 * verification that the field paths, unit conversions and day attribution are
 * right. They are built from the shapes Whoop's v2 documentation describes.
 *
 * If a sync ever lands wrong data, correct the fixture first and let it fail,
 * then fix the mapper.
 */
import {
  mapCycles, mapRecovery, mapSleep, mapWorkouts,
} from '../supabase/functions/_shared/whoop'
import { dedupeBy, localDay, round } from '../supabase/functions/_shared/common'

let failures = 0
let checks = 0

function check(name: string, cond: boolean, detail?: unknown) {
  checks++
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}`)
    if (detail !== undefined) console.log('       got:', JSON.stringify(detail))
  }
}

const near = (a: unknown, b: number, tol = 0.01) =>
  typeof a === 'number' && Math.abs(a - b) <= tol

const USER = '00000000-0000-0000-0000-000000000001'

// ------------------------------------------------------------------ localDay

function testLocalDay() {
  console.log('\nLocal day attribution')

  // 01:30 UTC on the 2nd is still the evening of the 1st in New York.
  check('applies a negative offset',
    localDay('2026-03-02T01:30:00.000Z', '-05:00') === '2026-03-01',
    localDay('2026-03-02T01:30:00.000Z', '-05:00'))

  // 23:30 UTC on the 1st is already the 2nd in Tokyo.
  check('applies a positive offset',
    localDay('2026-03-01T23:30:00.000Z', '+09:00') === '2026-03-02',
    localDay('2026-03-01T23:30:00.000Z', '+09:00'))

  check('accepts an offset without a colon',
    localDay('2026-03-02T01:30:00.000Z', '-0500') === '2026-03-01',
    localDay('2026-03-02T01:30:00.000Z', '-0500'))

  check('falls back to UTC with no offset',
    localDay('2026-03-02T01:30:00.000Z') === '2026-03-02',
    localDay('2026-03-02T01:30:00.000Z'))

  check('returns null for junk', localDay('not a date') === null)
  check('returns null for nothing', localDay(null) === null)
}

// -------------------------------------------------------------------- cycles

const CYCLES = [{
  id: 93845,
  user_id: 10129,
  start: '2026-03-01T09:00:00.000Z',
  end: '2026-03-02T09:00:00.000Z',
  timezone_offset: '-05:00',
  score_state: 'SCORED',
  score: {
    strain: 13.2411,
    kilojoule: 8288.297,
    average_heart_rate: 78,
    max_heart_rate: 172,
  },
}]

function testCycles() {
  console.log('\nWhoop cycles')
  const { rows, cycleDays } = mapCycles(CYCLES, USER)
  const c = rows[0]

  check('maps one row', rows.length === 1, rows.length)
  check('uses the local start date', c.day === '2026-03-01', c.day)
  check('reads strain', near(c.strain, 13.24), c.strain)
  check('reads average heart rate', c.avg_hr === 78, c.avg_hr)
  check('reads max heart rate', c.max_hr === 172, c.max_hr)
  check('keeps energy in kilojoules', near(c.kilojoules, 8288.3, 0.05), c.kilojoules)
  check('tags the source', c.source === 'whoop_api', c.source)
  check('indexes the cycle for recoveries',
    cycleDays.get('93845') === '2026-03-01', [...cycleDays])
}

// ------------------------------------------------------------------ recovery

const RECOVERY = [{
  cycle_id: 93845,
  sleep_id: '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b',
  user_id: 10129,
  created_at: '2026-03-02T09:05:00.000Z',
  score_state: 'SCORED',
  score: {
    user_calibrating: false,
    recovery_score: 44,
    resting_heart_rate: 64,
    hrv_rmssd_milli: 31.813,
    spo2_percentage: 95.6875,
    skin_temp_celsius: 33.7,
  },
}]

function testRecovery() {
  console.log('\nWhoop recovery')
  const { cycleDays } = mapCycles(CYCLES, USER)
  const r = mapRecovery(RECOVERY, USER, cycleDays)[0]

  check('places recovery on its cycle day', r.day === '2026-03-01', r.day)
  check('reads recovery score', r.recovery_pct === 44, r.recovery_pct)
  check('reads HRV in milliseconds', near(r.hrv_ms, 31.81), r.hrv_ms)
  check('reads resting heart rate', r.resting_hr === 64, r.resting_hr)
  check('reads blood oxygen', near(r.spo2_pct, 95.69), r.spo2_pct)
  check('reads skin temperature', near(r.skin_temp_c, 33.7), r.skin_temp_c)

  // If Whoop ever switched that field to seconds, an unguarded mapper would
  // flatten the HRV chart to near zero rather than failing loudly.
  const asSeconds = [{
    ...RECOVERY[0],
    score: { ...RECOVERY[0].score, hrv_rmssd_milli: 0.0318 },
  }]
  const guarded = mapRecovery(asSeconds, USER, cycleDays)[0]
  check('rescales an HRV that arrived in seconds', near(guarded.hrv_ms, 31.8, 0.1), guarded.hrv_ms)

  // With no matching cycle it must still land somewhere sensible.
  const orphan = mapRecovery([{ ...RECOVERY[0], cycle_id: 99999 }], USER, cycleDays)[0]
  check('falls back to created_at without a cycle', orphan.day === '2026-03-02', orphan.day)
}

// --------------------------------------------------------------------- sleep

const SLEEP = [{
  id: '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b',
  v1_id: 93845,
  user_id: 10129,
  start: '2026-03-02T03:15:00.000Z',
  end: '2026-03-02T11:05:00.000Z',
  timezone_offset: '-05:00',
  nap: false,
  score_state: 'SCORED',
  score: {
    stage_summary: {
      total_in_bed_time_milli: 28_200_000,        // 470 min
      total_awake_time_milli: 2_280_000,          //  38 min
      total_no_data_time_milli: 0,
      total_light_sleep_time_milli: 13_800_000,   // 230 min
      total_slow_wave_sleep_time_milli: 5_520_000, //  92 min
      total_rem_sleep_time_milli: 6_600_000,      // 110 min
      sleep_cycle_count: 4,
      disturbance_count: 7,
    },
    sleep_needed: {
      baseline_milli: 27_000_000,                 // 450 min
      need_from_sleep_debt_milli: 2_700_000,      //  45 min
      need_from_recent_strain_milli: 900_000,     //  15 min
      need_from_recent_nap_milli: 0,
    },
    respiratory_rate: 14.2,
    sleep_performance_percentage: 88,
    sleep_consistency_percentage: 72,
    sleep_efficiency_percentage: 91.9,
  },
}]

function testSleep() {
  console.log('\nWhoop sleep')
  const s = mapSleep(SLEEP, USER)[0]

  // Wakes 11:05 UTC = 06:05 in New York, so it belongs to the 2nd.
  check('attributes the night to the wake date', s.day === '2026-03-02', s.day)
  check('converts in-bed milliseconds to minutes', near(s.duration_min, 470), s.duration_min)
  check('sums staged sleep into asleep minutes', near(s.asleep_min, 432), s.asleep_min)
  check('reads REM minutes', near(s.rem_min, 110), s.rem_min)
  check('reads deep from slow-wave sleep', near(s.deep_min, 92), s.deep_min)
  check('reads light from light sleep', near(s.light_min, 230), s.light_min)
  check('reads awake minutes', near(s.awake_min, 38), s.awake_min)
  check('prefers the reported efficiency', near(s.efficiency_pct, 91.9), s.efficiency_pct)
  check('reads disturbances', s.disturbances === 7, s.disturbances)
  check('reads respiratory rate', near(s.respiratory_rate, 14.2), s.respiratory_rate)
  check('reads sleep performance', s.performance_pct === 88, s.performance_pct)
  check('sums the components of sleep need', near(s.need_min, 510), s.need_min)
  check('reads sleep debt on its own', near(s.debt_min, 45), s.debt_min)
  check('uses the UUID as the external id',
    s.external_id === '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b', s.external_id)
  check('marks a non-nap as such', s.is_nap === false, s.is_nap)

  const nap = mapSleep([{ ...SLEEP[0], nap: true }], USER)[0]
  check('carries the nap flag through', nap.is_nap === true, nap.is_nap)

  // An unscored night still has start and end, and must not be dropped.
  const unscored = mapSleep([{
    id: 'x', start: SLEEP[0].start, end: SLEEP[0].end,
    timezone_offset: '-05:00', score_state: 'PENDING_SCORE',
  }], USER)
  check('keeps an unscored sleep', unscored.length === 1, unscored.length)
  check('leaves unscored stages null', unscored[0].asleep_min === null, unscored[0])

  // A record missing its timestamps has nothing to attribute and is skipped.
  check('skips a record with no end',
    mapSleep([{ id: 'y', start: SLEEP[0].start }], USER).length === 0)
}

// ------------------------------------------------------------------ workouts

const WORKOUTS = [{
  id: '7f8e9d0c-1b2a-4c3d-8e9f-0a1b2c3d4e5f',
  v1_id: 1043,
  user_id: 10129,
  start: '2026-03-01T22:00:00.000Z',
  end: '2026-03-01T23:00:00.000Z',
  timezone_offset: '-05:00',
  sport_name: 'weightlifting',
  score_state: 'SCORED',
  score: {
    strain: 9.4,
    average_heart_rate: 131,
    max_heart_rate: 168,
    kilojoule: 1799.12,
    percent_recorded: 100,
    distance_meter: 8046.72,
    altitude_gain_meter: 46.64,
    // Sums to the 60-minute session: 10 min below zone 1, 50 min across the
    // five zones. Keeping the fixture self-consistent is what makes the
    // "zone zero is excluded" assertion below mean anything.
    zone_durations: {
      zone_zero_milli: 600_000,   // 10 min, below zone 1 and not one of the five
      zone_one_milli: 720_000,    // 12 min
      zone_two_milli: 1_080_000,  // 18 min
      zone_three_milli: 720_000,  // 12 min
      zone_four_milli: 300_000,   //  5 min
      zone_five_milli: 180_000,   //  3 min
    },
  },
}]

function testWorkouts() {
  console.log('\nWhoop workouts')
  const w = mapWorkouts(WORKOUTS, USER)[0]

  // 22:00 UTC = 17:00 in New York, so it is still the 1st.
  check('uses the local start date', w.day === '2026-03-01', w.day)
  check('reads the v2 sport name', w.activity === 'weightlifting', w.activity)
  check('derives duration from the timestamps', near(w.duration_min, 60), w.duration_min)
  check('converts kilojoules to kilocalories', near(w.energy_kcal, 430.0, 0.5), w.energy_kcal)
  check('converts metres to kilometres', near(w.distance_km, 8.047, 0.001), w.distance_km)
  check('reads average heart rate', w.avg_hr === 131, w.avg_hr)
  check('reads workout strain', near(w.strain, 9.4), w.strain)
  check('converts zone one to minutes', near(w.zone_1_min, 12), w.zone_1_min)
  check('converts zone five to minutes', near(w.zone_5_min, 3), w.zone_5_min)
  check('uses the UUID as the external id',
    w.external_id === '7f8e9d0c-1b2a-4c3d-8e9f-0a1b2c3d4e5f', w.external_id)

  // zone_zero is time below zone one. Counting it would total the full 60
  // minutes instead of the 50 actually spent in zones one to five.
  const zoneTotal = [w.zone_1_min, w.zone_2_min, w.zone_3_min, w.zone_4_min, w.zone_5_min]
    .reduce((a: number, b) => a + (typeof b === 'number' ? b : 0), 0)
  check('excludes zone zero from the five zones', near(zoneTotal, 50), zoneTotal)
  check('reads zone three', near(w.zone_3_min, 12), w.zone_3_min)
  check('reads zone four', near(w.zone_4_min, 5), w.zone_4_min)

  const unnamed = mapWorkouts([{ ...WORKOUTS[0], sport_name: undefined }], USER)[0]
  check('falls back when the sport is missing', unnamed.activity === 'Workout', unnamed.activity)
}

// ------------------------------------------------- tolerance to schema drift

function testDrift() {
  console.log('\nTolerance to schema drift')

  // Whoop renaming or dropping a field must degrade to null, never throw:
  // one changed key should not take down a whole scheduled sync.
  const stripped = [{
    id: 1,
    start: '2026-03-01T09:00:00.000Z',
    end: '2026-03-02T09:00:00.000Z',
    timezone_offset: '-05:00',
  }]
  let threw = false
  let rows: Record<string, unknown>[] = []
  try {
    rows = mapCycles(stripped, USER).rows
  } catch { threw = true }
  check('maps a cycle with no score block without throwing', !threw)
  check('leaves the missing values null', rows[0]?.strain === null, rows[0])

  let threwNested = false
  try {
    mapSleep([{ ...SLEEP[0], score: { stage_summary: null } }], USER)
  } catch { threwNested = true }
  check('survives a null nested object', !threwNested)

  let threwGarbage = false
  try {
    mapWorkouts([{ id: 1, start: 'nonsense', end: 'nonsense' }], USER)
  } catch { threwGarbage = true }
  check('survives unparseable timestamps', !threwGarbage)

  check('rounds to a sane precision', round(1.23456) === 1.23, round(1.23456))
  check('passes null through rounding', round(null) === null)
  check('rejects a non-finite value', round(Number.NaN) === null)
}

// --------------------------------------------------- more than one per day

/**
 * A Whoop cycle starts when you wake, so waking twice on one date produces two
 * cycles for it -- routine on an overnight shift, where the main sleep happens
 * during the day. `cycles` and `recovery` are keyed on the day, and Postgres
 * aborts an upsert that would touch one row twice, so a live sync failed
 * outright with "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" until these were collapsed here.
 */

// 04:00 local on the 1st, closed twelve hours later.
const NIGHT_CYCLE = {
  id: 93845,
  start: '2026-03-01T09:00:00.000Z',
  end: '2026-03-01T21:00:00.000Z',
  timezone_offset: '-05:00',
  score: { strain: 13.2411, kilojoule: 8288.297, average_heart_rate: 78, max_heart_rate: 172 },
}

// 17:00 local the same date, still running.
const DAY_CYCLE = {
  id: 93846,
  start: '2026-03-01T22:00:00.000Z',
  end: null,
  timezone_offset: '-05:00',
  score: { strain: 4.5, kilojoule: 1200, average_heart_rate: 60, max_heart_rate: 140 },
}

function testTwoCyclesOneDay() {
  console.log('\nTwo cycles on one date')

  const { rows, cycleDays } = mapCycles([NIGHT_CYCLE, DAY_CYCLE], USER)
  check('collapses them to one row', rows.length === 1, rows.length)

  const c = rows[0]
  check('keeps the single date', c.day === '2026-03-01', c.day)
  check('takes the higher strain, not the sum', near(c.strain, 13.24), c.strain)
  check('takes the higher max heart rate', c.max_hr === 172, c.max_hr)
  check('adds the energy', near(c.kilojoules, 9488.3, 0.05), c.kilojoules)
  check('takes average HR from the longer cycle', c.avg_hr === 78, c.avg_hr)
  check('still indexes both cycles',
    cycleDays.get('93845') === '2026-03-01' && cycleDays.get('93846') === '2026-03-01',
    [...cycleDays])

  // Whoop's ordering must not change the answer.
  const reversed = mapCycles([DAY_CYCLE, NIGHT_CYCLE], USER).rows[0]
  check('is independent of record order',
    reversed.strain === c.strain && reversed.avg_hr === c.avg_hr &&
      reversed.kilojoules === c.kilojoules,
    reversed)

  // Distinct days must still come through separately.
  const twoDays = mapCycles(
    [NIGHT_CYCLE, { ...NIGHT_CYCLE, id: 93847, start: '2026-03-02T09:00:00.000Z' }],
    USER,
  ).rows
  check('does not collapse separate days', twoDays.length === 2, twoDays.length)
}

function testTwoRecoveriesOneDay() {
  console.log('\nTwo recoveries on one date')
  const { cycleDays } = mapCycles([NIGHT_CYCLE, DAY_CYCLE], USER)

  const nap = {
    cycle_id: 93845,
    created_at: '2026-03-01T13:00:00.000Z',
    score: {
      recovery_score: 31, resting_heart_rate: 70, hrv_rmssd_milli: 22.0,
      spo2_percentage: 95.1, skin_temp_celsius: 33.4,
    },
  }
  const main = {
    cycle_id: 93846,
    created_at: '2026-03-01T21:30:00.000Z',
    score: {
      recovery_score: 68, resting_heart_rate: 58, hrv_rmssd_milli: 44.5,
      spo2_percentage: 96.2, skin_temp_celsius: 33.8,
    },
  }

  const rows = mapRecovery([nap, main], USER, cycleDays)
  check('collapses them to one row', rows.length === 1, rows.length)
  check('keeps the later reading', rows[0].recovery_pct === 68, rows[0].recovery_pct)
  check('does not average the HRV', near(rows[0].hrv_ms, 44.5), rows[0].hrv_ms)
  check('is independent of record order',
    mapRecovery([main, nap], USER, cycleDays)[0].recovery_pct === 68)

  // A fuller reading beats a more recent but sparser one, so a partial score
  // arriving late cannot blank out a complete morning.
  const sparseLater = { cycle_id: 93846, created_at: '2026-03-01T23:00:00.000Z', score: {} }
  const kept = mapRecovery([main, sparseLater], USER, cycleDays)[0]
  check('prefers the more complete reading', kept.recovery_pct === 68, kept.recovery_pct)
}

function testDedupe() {
  console.log('\nUpsert backstop')

  const rows = [
    { user_id: USER, day: '2026-03-01', source: 'whoop_api', strain: 1 },
    { user_id: USER, day: '2026-03-01', source: 'whoop_api', strain: 2 },
    { user_id: USER, day: '2026-03-02', source: 'whoop_api', strain: 3 },
  ]
  const unique = dedupeBy(rows, 'user_id,day,source')
  check('drops a duplicate key', unique.length === 2, unique.length)
  check('keeps the last of the pair',
    unique.find((r) => r.day === '2026-03-01')?.strain === 2, unique)
  check('leaves a clean batch untouched',
    dedupeBy(rows.slice(1), 'user_id,day,source').length === 2)
  check('tolerates spaces in the key list',
    dedupeBy(rows, 'user_id, day, source').length === 2)
}

function main() {
  testLocalDay()
  testCycles()
  testRecovery()
  testTwoCyclesOneDay()
  testTwoRecoveriesOneDay()
  testDedupe()
  testSleep()
  testWorkouts()
  testDrift()

  console.log(`\n${checks - failures}/${checks} checks passed`)
  if (failures) process.exit(1)
}

main()
