import { unzipSync, strFromU8 } from 'fflate'
import type { Cycle, ParsedPayload, ParseProgress, Recovery, SleepSession, Workout } from '../lib/types'
import { emptyPayload } from '../lib/types'
import { toRows, type Row } from './csv'

/**
 * Whoop's "Download my data" export is a zip of CSVs (physiological_cycles,
 * sleeps, workouts, journal_entries). Users can also drop a single CSV in.
 * Files are matched on their *contents* as well as their name, so a renamed
 * download still lands in the right importer.
 */

/** Whoop writes wall-clock timestamps plus a separate timezone column
 *  ("2024-01-15 07:23:11" + "-04:00"). Newer exports are already ISO. */
function whoopInstant(ts: string | null, tz: string | null): string | null {
  if (!ts) return null
  const trimmed = ts.trim()
  if (!trimmed) return null

  // Already carries a zone designator.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed.replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  const zone = (tz ?? '').trim()
  const suffix = /^[+-]\d{2}:?\d{2}$/.test(zone)
    ? (zone.includes(':') ? zone : zone.slice(0, 3) + ':' + zone.slice(3))
    : 'Z'
  const d = new Date(trimmed.replace(' ', 'T') + suffix)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** The local calendar day, taken from the wall-clock text Whoop wrote rather
 *  than from the UTC instant, so a 1am bedtime stays on the right date. */
function localDay(ts: string | null): string | null {
  if (!ts) return null
  const m = ts.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

const TZ_COLS = ['Cycle timezone', 'Timezone', 'timezone offset']

function sleepFromRow(r: Row, idPrefix: string): SleepSession | null {
  const tz = r.text(...TZ_COLS)
  const onset = r.text('Sleep onset', 'Start time', 'Cycle start time')
  const wake = r.text('Wake onset', 'End time', 'Cycle end time')
  const startedAt = whoopInstant(onset, tz)
  const endedAt = whoopInstant(wake, tz)
  const day = localDay(wake) ?? localDay(onset)
  if (!startedAt || !endedAt || !day) return null

  const asleep = r.num('Asleep duration (min)', 'Asleep duration')
  const inBed = r.num('In bed duration (min)', 'In bed duration')
  const efficiency = r.num('Sleep efficiency %', 'Sleep efficiency')

  return {
    source: 'whoop_csv',
    external_id: idPrefix + '-' + startedAt,
    day,
    started_at: startedAt,
    ended_at: endedAt,
    is_nap: r.bool('Nap'),
    duration_min: inBed ?? asleep,
    asleep_min: asleep,
    rem_min: r.num('REM duration (min)', 'REM duration'),
    deep_min: r.num('Deep (SWS) duration (min)', 'Deep sleep duration', 'Deep duration'),
    light_min: r.num('Light sleep duration (min)', 'Light duration'),
    awake_min: r.num('Awake duration (min)', 'Awake duration'),
    latency_min: r.num('Sleep latency (min)', 'Latency'),
    efficiency_pct: efficiency ?? (asleep && inBed ? (asleep / inBed) * 100 : null),
    disturbances: r.num('Disturbances', 'Sleep disturbances'),
    respiratory_rate: r.num('Respiratory rate (rpm)', 'Respiratory rate'),
    performance_pct: r.num('Sleep performance %', 'Sleep performance'),
    need_min: r.num('Sleep need (min)', 'Sleep need'),
    debt_min: r.num('Sleep debt (min)', 'Sleep debt'),
  }
}

function importCycles(rows: Row[], out: ParsedPayload) {
  const seenSleep = new Set(out.sleep.map((s) => s.external_id))

  for (const r of rows) {
    const tz = r.text(...TZ_COLS)
    const day = localDay(r.text('Cycle start time', 'Start time'))
    if (!day) continue

    const recovery: Recovery = {
      day,
      source: 'whoop_csv',
      recovery_pct: r.num('Recovery score %', 'Recovery score'),
      hrv_ms: r.num('Heart rate variability (ms)', 'Heart rate variability'),
      resting_hr: r.num('Resting heart rate (bpm)', 'Resting heart rate'),
      spo2_pct: r.num('Blood oxygen %', 'Blood oxygen'),
      skin_temp_c: r.num('Skin temp (celsius)', 'Skin temp'),
      respiratory_rate: r.num('Respiratory rate (rpm)', 'Respiratory rate'),
    }
    if (Object.values(recovery).some((v) => typeof v === 'number')) out.recovery.push(recovery)

    const kcal = r.num('Energy burned (cal)', 'Energy burned', 'Calories')
    const cycle: Cycle = {
      day,
      source: 'whoop_csv',
      strain: r.num('Day Strain', 'Strain'),
      avg_hr: r.num('Average HR (bpm)', 'Average HR'),
      max_hr: r.num('Max HR (bpm)', 'Max HR'),
      // Whoop labels this column "cal" but means kilocalories; the column is
      // stored in kJ so it matches what the Whoop API returns.
      kilojoules: kcal === null ? null : kcal * 4.184,
    }
    if (cycle.strain !== null || cycle.avg_hr !== null || cycle.kilojoules !== null) {
      out.cycles.push(cycle)
    }

    // physiological_cycles.csv repeats the night's sleep inline. Keep it only
    // when sleeps.csv did not already supply a richer row.
    const s = sleepFromRow(r, 'whoop')
    if (s && s.asleep_min !== null && !seenSleep.has(s.external_id)) {
      seenSleep.add(s.external_id)
      out.sleep.push(s)
    }
    void tz
  }
}

function importSleeps(rows: Row[], out: ParsedPayload) {
  const seen = new Set(out.sleep.map((s) => s.external_id))
  for (const r of rows) {
    const s = sleepFromRow(r, 'whoop')
    if (!s) continue
    if (seen.has(s.external_id)) {
      // sleeps.csv is the more detailed source; let it replace the inline copy.
      const idx = out.sleep.findIndex((x) => x.external_id === s.external_id)
      if (idx >= 0) out.sleep[idx] = s
      continue
    }
    seen.add(s.external_id)
    out.sleep.push(s)
  }
}

function importWorkouts(rows: Row[], out: ParsedPayload) {
  for (const r of rows) {
    const tz = r.text(...TZ_COLS)
    const startedAt = whoopInstant(r.text('Workout start time', 'Start time'), tz)
    const endedAt = whoopInstant(r.text('Workout end time', 'End time'), tz)
    const day = localDay(r.text('Workout start time', 'Start time'))
    if (!startedAt || !endedAt || !day) continue

    const duration = r.num('Duration (min)', 'Duration')
    const kcal = r.num('Energy burned (cal)', 'Energy burned', 'Calories')
    const meters = r.num('Distance (meters)', 'Distance')

    // Whoop reports heart-rate zones as a percentage of the workout.
    const zonePct = (n: number) => r.num(`HR Zone ${n} %`, `HR Zone ${n}`)
    const zoneMin = (n: number) => {
      const pct = zonePct(n)
      if (pct === null || duration === null) return null
      return Math.round(duration * (pct / 100) * 100) / 100
    }

    const w: Workout = {
      source: 'whoop_csv',
      external_id: 'whoop-' + startedAt,
      day,
      started_at: startedAt,
      ended_at: endedAt,
      activity: r.text('Activity name', 'Activity') ?? 'Workout',
      duration_min: duration,
      energy_kcal: kcal,
      distance_km: meters === null ? null : meters / 1000,
      avg_hr: r.num('Average HR (bpm)', 'Average HR'),
      max_hr: r.num('Max HR (bpm)', 'Max HR'),
      strain: r.num('Activity Strain', 'Strain'),
      zone_1_min: zoneMin(1),
      zone_2_min: zoneMin(2),
      zone_3_min: zoneMin(3),
      zone_4_min: zoneMin(4),
      zone_5_min: zoneMin(5),
    }
    out.workouts.push(w)
  }
}

type Kind = 'cycles' | 'sleeps' | 'workouts' | 'unknown'

/** Identify a CSV by filename first, then by the columns it actually has, so
 *  a file the user renamed still imports correctly. */
export function classifyCsv(name: string, header: string): Kind {
  const n = name.toLowerCase()
  if (n.includes('physiological') || n.includes('cycle')) return 'cycles'
  if (n.includes('sleep')) return 'sleeps'
  if (n.includes('workout')) return 'workouts'

  const h = header.toLowerCase()
  if (h.includes('workout start time') || h.includes('activity name')) return 'workouts'
  if (h.includes('recovery score') || h.includes('day strain')) return 'cycles'
  if (h.includes('sleep performance') || h.includes('asleep duration')) return 'sleeps'
  return 'unknown'
}

export async function parseWhoopExport(
  file: File | Blob,
  filename: string,
  onProgress: (p: ParseProgress) => void,
): Promise<ParsedPayload> {
  const out = emptyPayload()
  const files: Array<{ name: string; text: string }> = []

  if (filename.toLowerCase().endsWith('.zip')) {
    onProgress({ phase: 'Unpacking Whoop export', ratio: null })
    const buf = new Uint8Array(await file.arrayBuffer())
    const entries = unzipSync(buf, {
      filter: (f) => f.name.toLowerCase().endsWith('.csv') && !f.name.includes('__MACOSX'),
    })
    for (const [name, bytes] of Object.entries(entries)) {
      files.push({ name, text: strFromU8(bytes) })
    }
  } else {
    files.push({ name: filename, text: await (file as Blob).text() })
  }

  if (!files.length) {
    throw new Error('No CSV files found in that Whoop export.')
  }

  // physiological_cycles first, so sleeps.csv can upgrade the rows it duplicates.
  const order: Kind[] = ['cycles', 'sleeps', 'workouts']
  const classified = files.map((f) => ({
    ...f,
    kind: classifyCsv(f.name, f.text.slice(0, 2000)),
  }))
  classified.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))

  let handled = 0
  for (const f of classified) {
    if (f.kind === 'unknown') continue
    onProgress({ phase: 'Reading ' + f.name, ratio: null })
    const rows = toRows(f.text)
    if (f.kind === 'cycles') importCycles(rows, out)
    else if (f.kind === 'sleeps') importSleeps(rows, out)
    else if (f.kind === 'workouts') importWorkouts(rows, out)
    handled++
  }

  if (!handled) {
    throw new Error(
      'None of those CSVs looked like Whoop data. Expected physiological_cycles.csv, ' +
      'sleeps.csv or workouts.csv from Whoop > Settings > Data Export.',
    )
  }

  return out
}
