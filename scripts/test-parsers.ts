/**
 * Parser checks against synthetic-but-realistic exports.
 *
 * Run with: npm test
 *
 * These cover the parts most likely to break quietly: locale units, sleep
 * segments stitched into sessions, timezone handling, and the day a night of
 * sleep gets attributed to.
 */
import { zipSync, strToU8 } from 'fflate'
import { parseAppleHealthZip } from '../src/parsers/appleHealth'
import { parseWhoopExport } from '../src/parsers/whoop'
import { buildSleepSessions } from '../src/parsers/appleHealth'
import { toRows, parseCsv } from '../src/parsers/csv'
import { splitByDaytimeSleep, circularStdevHours, dedupeWorkouts } from '../src/lib/analytics'
import type { SleepSession } from '../src/lib/types'

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

function near(a: number | null | undefined, b: number, tol = 0.01): boolean {
  return a !== null && a !== undefined && Math.abs(a - b) <= tol
}

// --------------------------------------------------------------- Apple Health

const APPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
 <ExportDate value="2026-03-02 09:00:00 -0500"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-03-01 08:00:00 -0500" endDate="2026-03-01 08:10:00 -0500" value="1200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2026-03-01 18:00:00 -0500" endDate="2026-03-01 18:10:00 -0500" value="800"/>
 <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="Watch" unit="mi" startDate="2026-03-01 08:00:00 -0500" endDate="2026-03-01 08:10:00 -0500" value="1"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" startDate="2026-03-01 08:00:00 -0500" endDate="2026-03-01 08:00:30 -0500" value="60"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" startDate="2026-03-01 09:00:00 -0500" endDate="2026-03-01 09:00:30 -0500" value="80"/>
 <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Watch" unit="%" startDate="2026-03-01 03:00:00 -0500" endDate="2026-03-01 03:00:30 -0500" value="0.97"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="lb" startDate="2026-03-01 07:00:00 -0500" endDate="2026-03-01 07:00:00 -0500" value="220.462"/>
 <Record type="HKQuantityTypeIdentifierVO2Max" sourceName="Watch" unit="mL/min·kg" startDate="2026-03-01 12:00:00 -0500" endDate="2026-03-01 12:00:00 -0500" value="44.5"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" unit="ms" startDate="2026-03-01 04:00:00 -0500" endDate="2026-03-01 04:01:00 -0500" value="68">
  <MetadataEntry key="HKAlgorithmVersion" value="2"/>
 </Record>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-02-28 23:30:00 -0500" endDate="2026-03-01 01:00:00 -0500"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-03-01 01:00:00 -0500" endDate="2026-03-01 02:00:00 -0500"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepREM" startDate="2026-03-01 02:00:00 -0500" endDate="2026-03-01 03:00:00 -0500"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAwake" startDate="2026-03-01 03:00:00 -0500" endDate="2026-03-01 03:15:00 -0500"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-03-01 03:15:00 -0500" endDate="2026-03-01 06:30:00 -0500"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeFunctionalStrengthTraining" duration="45" durationUnit="min" startDate="2026-03-01 17:00:00 -0500" endDate="2026-03-01 17:45:00 -0500" sourceName="Watch">
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="320" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="132" maximum="168" unit="count/min"/>
  <MetadataEntry key="HKIndoorWorkout" value="1"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="1800" durationUnit="s" startDate="2026-03-02 07:00:00 -0500" endDate="2026-03-02 07:30:00 -0500" sourceName="Watch" totalDistance="3" totalDistanceUnit="mi" totalEnergyBurned="300" totalEnergyBurnedUnit="kcal"/>
</HealthData>`

async function testAppleHealth() {
  console.log('\nApple Health export')
  const zipped = zipSync({ 'apple_health_export/export.xml': strToU8(APPLE_XML) })
  const blob = new Blob([zipped as unknown as BlobPart])
  const payload = await parseAppleHealthZip(blob, () => {})

  const metric = (name: string, day: string) =>
    payload.dailyMetrics.find((m) => m.metric === name && m.day === day)?.value ?? null

  check('sums step counts across sources', metric('steps', '2026-03-01') === 2000,
    metric('steps', '2026-03-01'))
  check('converts miles to kilometres', near(metric('distance_km', '2026-03-01'), 1.609, 0.002),
    metric('distance_km', '2026-03-01'))
  check('averages heart rate instead of summing', metric('heart_rate_avg', '2026-03-01') === 70,
    metric('heart_rate_avg', '2026-03-01'))
  check('rescales fractional SpO2 to a percentage', near(metric('spo2_pct', '2026-03-01'), 97),
    metric('spo2_pct', '2026-03-01'))
  check('converts pounds to kilograms', near(metric('body_mass_kg', '2026-03-01'), 100, 0.01),
    metric('body_mass_kg', '2026-03-01'))
  check('takes the max for VO2 max', near(metric('vo2_max', '2026-03-01'), 44.5),
    metric('vo2_max', '2026-03-01'))
  check('reads a record that has child elements',
    near(metric('hrv_ms', '2026-03-01'), 68), metric('hrv_ms', '2026-03-01'))

  const sleep = payload.sleep
  check('stitches sleep segments into one session', sleep.length === 1, sleep.length)
  const s = sleep[0]
  check('attributes the night to the wake date', s?.day === '2026-03-01', s?.day)
  // 90 core + 60 deep + 60 rem + 195 core = 405 asleep, 15 awake.
  check('sums asleep minutes across stages', near(s?.asleep_min, 405), s?.asleep_min)
  check('sums deep minutes', near(s?.deep_min, 60), s?.deep_min)
  check('sums REM minutes', near(s?.rem_min, 60), s?.rem_min)
  check('counts awake time separately', near(s?.awake_min, 15), s?.awake_min)
  check('computes efficiency from time in bed', near(s?.efficiency_pct, 96.43, 0.05),
    s?.efficiency_pct)

  const workouts = payload.workouts
  check('reads both workouts', workouts.length === 2, workouts.length)
  const strength = workouts.find((w) => w.activity?.includes('Strength'))
  check('de-camel-cases the activity name',
    strength?.activity === 'Functional Strength Training', strength?.activity)
  check('reads energy from WorkoutStatistics', near(strength?.energy_kcal, 320),
    strength?.energy_kcal)
  check('reads average and max heart rate',
    near(strength?.avg_hr, 132) && near(strength?.max_hr, 168),
    [strength?.avg_hr, strength?.max_hr])

  const run = workouts.find((w) => w.activity === 'Running')
  check('converts a duration given in seconds', near(run?.duration_min, 30), run?.duration_min)
  check('falls back to legacy total attributes',
    near(run?.distance_km, 4.828, 0.002) && near(run?.energy_kcal, 300),
    [run?.distance_km, run?.energy_kcal])
}

// ---------------------------------------------------------- sleep sessioning

function testSessioning() {
  console.log('\nSleep sessioning')
  const seg = (start: string, end: string, stage: string, day: string) => ({
    day, start: new Date(start), end: new Date(end), stage,
  })

  // A nap in the afternoon and a full night should not merge.
  const sessions = buildSleepSessions([
    seg('2026-03-01T18:00:00Z', '2026-03-01T19:00:00Z', 'AsleepCore', '2026-03-01'),
    seg('2026-03-02T03:00:00Z', '2026-03-02T11:00:00Z', 'AsleepCore', '2026-03-02'),
  ])
  check('splits sessions separated by a long gap', sessions.length === 2, sessions.length)
  check('marks the short one as a nap',
    sessions.filter((s) => s.is_nap).length === 0, sessions.map((s) => s.is_nap))

  // Two segments 20 minutes apart belong to the same night.
  const merged = buildSleepSessions([
    seg('2026-03-02T03:00:00Z', '2026-03-02T05:00:00Z', 'AsleepCore', '2026-03-02'),
    seg('2026-03-02T05:20:00Z', '2026-03-02T09:00:00Z', 'AsleepREM', '2026-03-02'),
  ])
  check('merges segments within the gap threshold', merged.length === 1, merged.length)

  // Same day, one long night and one short nap -> the short one is a nap.
  const withNap = buildSleepSessions([
    seg('2026-03-02T03:00:00Z', '2026-03-02T11:00:00Z', 'AsleepCore', '2026-03-02'),
    seg('2026-03-02T18:00:00Z', '2026-03-02T19:00:00Z', 'AsleepCore', '2026-03-02'),
  ])
  check('flags the shorter same-day session as a nap',
    withNap.filter((s) => s.is_nap).length === 1, withNap.map((s) => [s.duration_min, s.is_nap]))
}

// ------------------------------------------------------------------- Whoop

const CYCLES_CSV = `Cycle start time,Cycle end time,Cycle timezone,Recovery score %,Resting heart rate (bpm),Heart rate variability (ms),Skin temp (celsius),Blood oxygen %,Day Strain,Energy burned (cal),Max HR (bpm),Average HR (bpm),Sleep onset,Wake onset,Sleep performance %,Respiratory rate (rpm),Asleep duration (min),In bed duration (min),Light sleep duration (min),Deep (SWS) duration (min),REM duration (min),Awake duration (min),Sleep need (min),Sleep debt (min),Sleep efficiency %
2026-03-01 04:00:00,2026-03-02 04:00:00,-05:00,68,52,94,33.4,96,13.2,2400,172,78,2026-03-01 23:15:00,2026-03-02 07:05:00,88,14.2,432,470,230,92,110,38,491,45,91.9
2026-03-02 04:00:00,2026-03-03 04:00:00,-05:00,41,57,61,33.9,95,16.8,2900,181,84,2026-03-02 09:30:00,2026-03-02 15:10:00,62,15.1,310,340,180,55,75,30,500,190,91.2`

const WORKOUTS_CSV = `Cycle start time,Cycle timezone,Workout start time,Workout end time,Duration (min),Activity name,Activity Strain,Energy burned (cal),Max HR (bpm),Average HR (bpm),HR Zone 1 %,HR Zone 2 %,HR Zone 3 %,HR Zone 4 %,HR Zone 5 %,Distance (meters),Altitude Gain (meters)
2026-03-01 04:00:00,-05:00,2026-03-01 17:00:00,2026-03-01 18:00:00,60,Weightlifting,9.4,430,168,131,20,30,30,15,5,,
2026-03-02 04:00:00,-05:00,2026-03-02 18:30:00,2026-03-02 19:15:00,45,Running,12.1,520,182,155,5,15,40,30,10,8046,42`

const SLEEPS_CSV = `Cycle start time,Cycle timezone,Sleep onset,Wake onset,Sleep performance %,Respiratory rate (rpm),Asleep duration (min),In bed duration (min),Light sleep duration (min),Deep (SWS) duration (min),REM duration (min),Awake duration (min),Sleep need (min),Sleep debt (min),Sleep efficiency %,Nap
2026-03-01 04:00:00,-05:00,2026-03-01 23:15:00,2026-03-02 07:05:00,88,14.2,432,470,230,92,110,38,491,45,91.9,false
2026-03-02 04:00:00,-05:00,2026-03-02 13:00:00,2026-03-02 13:40:00,10,14.0,38,40,38,0,0,2,500,190,95.0,true`

async function testWhoop() {
  console.log('\nWhoop export')
  const zipped = zipSync({
    'my_whoop_data/physiological_cycles.csv': strToU8(CYCLES_CSV),
    'my_whoop_data/workouts.csv': strToU8(WORKOUTS_CSV),
    'my_whoop_data/sleeps.csv': strToU8(SLEEPS_CSV),
  })
  const blob = new Blob([zipped as unknown as BlobPart])
  const payload = await parseWhoopExport(blob, 'my_whoop_data.zip', () => {})

  const rec = payload.recovery.find((r) => r.day === '2026-03-01')
  check('reads recovery score', rec?.recovery_pct === 68, rec?.recovery_pct)
  check('reads HRV', rec?.hrv_ms === 94, rec?.hrv_ms)
  check('reads resting heart rate', rec?.resting_hr === 52, rec?.resting_hr)
  check('reads skin temperature', near(rec?.skin_temp_c, 33.4), rec?.skin_temp_c)

  const cyc = payload.cycles.find((c) => c.day === '2026-03-02')
  check('reads day strain', near(cyc?.strain, 16.8), cyc?.strain)
  check('converts calories to kilojoules', near(cyc?.kilojoules, 2900 * 4.184, 0.5),
    cyc?.kilojoules)

  const night = payload.sleep.find((s) => s.day === '2026-03-02' && !s.is_nap)
  check('attributes sleep to the wake date', !!night, payload.sleep.map((s) => s.day))
  check('reads asleep minutes', near(night?.asleep_min, 432), night?.asleep_min)
  check('reads REM and deep minutes',
    near(night?.rem_min, 110) && near(night?.deep_min, 92), [night?.rem_min, night?.deep_min])
  check('reads sleep debt', near(night?.debt_min, 45), night?.debt_min)
  check('applies the timezone offset',
    night?.started_at === '2026-03-02T04:15:00.000Z', night?.started_at)

  const nap = payload.sleep.find((s) => s.is_nap)
  check('keeps naps and flags them', !!nap && near(nap.asleep_min, 38), nap?.asleep_min)

  check('does not duplicate the sleep that cycles and sleeps both carry',
    payload.sleep.filter((s) => s.started_at === '2026-03-02T04:15:00.000Z').length === 1,
    payload.sleep.length)

  const lift = payload.workouts.find((w) => w.activity === 'Weightlifting')
  check('reads workout strain', near(lift?.strain, 9.4), lift?.strain)
  check('converts zone percentages to minutes', near(lift?.zone_3_min, 18), lift?.zone_3_min)
  const run = payload.workouts.find((w) => w.activity === 'Running')
  check('converts metres to kilometres', near(run?.distance_km, 8.046), run?.distance_km)
  check('leaves distance null when the column is blank',
    lift?.distance_km === null, lift?.distance_km)
}

// ---------------------------------------------------------------- CSV reader

function testCsv() {
  console.log('\nCSV reader')
  const rows = parseCsv('a,b,c\n1,"two, with comma",3\r\n4,"say ""hi""",6\n')
  check('handles quoted commas', rows[1][1] === 'two, with comma', rows[1])
  check('handles escaped quotes', rows[2][1] === 'say "hi"', rows[2])
  check('handles CRLF', rows[1][2] === '3', rows[1])

  const parsed = toRows('Sleep debt,Max HR (bpm)\n45,180\n')
  check('matches a header that gained a unit suffix', parsed[0].num('Max HR') === 180)
  check('matches a header that lost one', parsed[0].num('Sleep debt (min)') === 45)
  check('returns null for a missing column', parsed[0].num('Nonexistent') === null)
}

// ----------------------------------------------------------------- analytics

function testAnalytics() {
  console.log('\nAnalytics')

  const mk = (day: string, start: string, end: string, extra: Partial<SleepSession> = {}): SleepSession => ({
    source: 'whoop_csv', external_id: day, day,
    started_at: start, ended_at: end, is_nap: false,
    duration_min: 480, asleep_min: 450, rem_min: 100, deep_min: 90,
    light_min: 260, awake_min: 30, latency_min: null, efficiency_pct: 93,
    disturbances: null, respiratory_rate: null, performance_pct: null,
    need_min: null, debt_min: null, ...extra,
  })

  // Bedtimes just either side of midnight are 40 minutes apart, not 23 hours.
  const spread = circularStdevHours([23.5, 0.17])
  check('treats bedtimes around midnight as close together',
    spread !== null && spread < 1, spread)

  const wide = circularStdevHours([2, 14])
  check('treats a twelve-hour swing as inconsistent', wide !== null && wide > 3, wide)

  // Local-time construction so the daytime test does not depend on the runner's zone.
  const localIso = (day: string, hour: number) => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d, hour, 0, 0).toISOString()
  }
  const sleepByDay = new Map<string, SleepSession>([
    ['2026-03-01', mk('2026-03-01', localIso('2026-02-28', 23), localIso('2026-03-01', 7))],
    ['2026-03-02', mk('2026-03-02', localIso('2026-03-02', 9), localIso('2026-03-02', 16))],
    ['2026-03-03', mk('2026-03-03', localIso('2026-03-03', 10), localIso('2026-03-03', 17))],
    ['2026-03-04', mk('2026-03-04', localIso('2026-03-04', 9), localIso('2026-03-04', 15))],
  ])
  const split = splitByDaytimeSleep(sleepByDay, new Map())
  check('classifies daytime sleep as post-shift', split.day.days.length === 3, split.day.days)
  check('classifies overnight sleep as a normal night',
    split.night.days.length === 1, split.night.days)

  // A session logged by both the watch and Whoop should count once.
  const base = {
    day: '2026-03-01', started_at: '2026-03-01T22:00:00.000Z',
    ended_at: '2026-03-01T23:00:00.000Z', activity: 'Running',
    duration_min: 60, distance_km: 8, zone_1_min: null, zone_2_min: null,
    zone_3_min: null, zone_4_min: null, zone_5_min: null,
  }
  const deduped = dedupeWorkouts([
    { ...base, source: 'apple_health', external_id: 'a', energy_kcal: 500, avg_hr: null, max_hr: null, strain: null },
    { ...base, source: 'whoop_csv', external_id: 'b', started_at: '2026-03-01T22:03:00.000Z',
      energy_kcal: 520, avg_hr: 150, max_hr: 175, strain: 11.2 },
  ])
  check('collapses the same workout logged twice', deduped.length === 1, deduped.length)
  check('keeps the better-instrumented record', deduped[0]?.strain === 11.2, deduped[0]?.strain)
}

async function main() {
  await testAppleHealth()
  testSessioning()
  await testWhoop()
  testCsv()
  testAnalytics()

  console.log(`\n${checks - failures}/${checks} checks passed`)
  if (failures) process.exit(1)
}

void main()
