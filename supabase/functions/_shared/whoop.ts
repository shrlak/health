import { iso, localDay, round } from './common.ts'

/**
 * Whoop API v2.
 *
 * v1 is no longer supported, so everything here targets v2: sleep and workout
 * ids became UUIDs, and workouts report `sport_name` rather than a numeric
 * sport id.
 *
 * Field access is deliberately defensive. This could not be tested against a
 * live Whoop account while it was written, so every value is read through a
 * tolerant accessor and a renamed or absent field degrades to null rather than
 * throwing mid-sync.
 */

export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
export const WHOOP_API = 'https://api.prod.whoop.com/developer'

export const WHOOP_SCOPES = [
  'offline',
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:workout',
  'read:profile',
  'read:body_measurement',
].join(' ')

type Rec = Record<string, unknown>

const obj = (v: unknown): Rec => (v && typeof v === 'object' ? v as Rec : {})

/** First present finite number among the given paths. */
function num(source: Rec, ...paths: string[]): number | null {
  for (const path of paths) {
    let cur: unknown = source
    for (const part of path.split('.')) cur = obj(cur)[part]
    if (typeof cur === 'number' && Number.isFinite(cur)) return cur
  }
  return null
}

function str(source: Rec, ...paths: string[]): string | null {
  for (const path of paths) {
    let cur: unknown = source
    for (const part of path.split('.')) cur = obj(cur)[part]
    if (typeof cur === 'string' && cur) return cur
  }
  return null
}

const ms = (v: number | null): number | null => (v === null ? null : v / 60_000)

export interface TokenSet {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}

/** Whoop invalidates the old access token as soon as a refresh is used, so the
 *  new pair must be persisted immediately by the caller. */
export async function refreshTokens(
  refreshToken: string, clientId: string, clientSecret: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    scope: WHOOP_SCOPES,
  })
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Whoop token refresh failed (${res.status}): ${await res.text()}`)
  return await res.json() as TokenSet
}

/** Walk a paginated collection to the end. Whoop returns `{records, next_token}`
 *  and signals the last page with an empty token. */
export async function fetchAll(
  path: string, accessToken: string, start: string, end: string,
): Promise<Rec[]> {
  const out: Rec[] = []
  let nextToken: string | undefined
  // A guard against a server that keeps handing back a token.
  for (let page = 0; page < 200; page++) {
    const url = new URL(`${WHOOP_API}${path}`)
    url.searchParams.set('start', start)
    url.searchParams.set('end', end)
    url.searchParams.set('limit', '25')
    if (nextToken) url.searchParams.set('nextToken', nextToken)

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (res.status === 429) {
      // Rate limited: back off once, then continue from the same token.
      await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    if (!res.ok) throw new Error(`Whoop ${path} failed (${res.status}): ${await res.text()}`)

    const body = await res.json() as { records?: Rec[]; next_token?: string }
    out.push(...(body.records ?? []))
    nextToken = body.next_token || undefined
    if (!nextToken) break
  }
  return out
}

// ------------------------------------------------------------------ mapping

const maxOf = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

const sumOf = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b

/**
 * Whoop cycles, rolled up to one row per calendar day.
 *
 * A cycle begins when you wake, so a day holds more than one whenever you wake
 * twice on the same date -- an overnight shift followed by daytime sleep does
 * it routinely, and so does any nap long enough for Whoop to close the cycle.
 * `cycles` is keyed on (user_id, day, source), so those have to be combined
 * here: sending both to one upsert makes Postgres abort the whole statement
 * with "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * Combining, field by field:
 *   - strain is Whoop's 0-21 logarithmic scale, so it is not additive. The
 *     larger figure is the honest one; adding would invent a day that never
 *     happened, and averaging would erase a hard day's effort.
 *   - kilojoules is energy, which genuinely accumulates, so it sums.
 *   - max_hr is the higher of the two, by definition.
 *   - avg_hr comes from whichever cycle covered more of the day rather than
 *     being averaged, so it stays a figure Whoop actually reported. An
 *     in-progress cycle has no end yet and loses that comparison.
 */
export function mapCycles(records: Rec[], userId: string) {
  const byDay = new Map<string, Rec>()
  const spans = new Map<string, number>()
  const cycleDays = new Map<string, string>()

  for (const r of records) {
    const offset = str(r, 'timezone_offset')
    const day = localDay(str(r, 'start'), offset)
    if (!day) continue
    const id = String(obj(r).id ?? '')
    if (id) cycleDays.set(id, day)

    const startMs = Date.parse(str(r, 'start') ?? '')
    const endMs = Date.parse(str(r, 'end') ?? '')
    const span = Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : 0

    const row: Rec = {
      user_id: userId,
      day,
      source: 'whoop_api',
      strain: round(num(r, 'score.strain')),
      avg_hr: round(num(r, 'score.average_heart_rate')),
      max_hr: round(num(r, 'score.max_heart_rate')),
      kilojoules: round(num(r, 'score.kilojoule')),
    }

    const prev = byDay.get(day)
    if (!prev) {
      byDay.set(day, row)
      spans.set(day, span)
      continue
    }

    const longer = span > (spans.get(day) ?? 0)
    byDay.set(day, {
      ...prev,
      strain: maxOf(prev.strain as number | null, row.strain as number | null),
      max_hr: maxOf(prev.max_hr as number | null, row.max_hr as number | null),
      kilojoules: round(sumOf(prev.kilojoules as number | null, row.kilojoules as number | null)),
      avg_hr: longer ? (row.avg_hr ?? prev.avg_hr) : (prev.avg_hr ?? row.avg_hr),
    })
    if (longer) spans.set(day, span)
  }

  return { rows: [...byDay.values()], cycleDays }
}

const SCORES = ['recovery_pct', 'hrv_ms', 'resting_hr', 'spo2_pct', 'skin_temp_c']

const filled = (row: Rec): number => SCORES.filter((k) => row[k] !== null).length

/**
 * Whoop recoveries, one row per calendar day.
 *
 * Recovery is scored per cycle, so a day with two cycles (see mapCycles) can
 * carry two of them, and `recovery` is keyed on (user_id, day, source). Unlike
 * strain these are point-in-time physiological readings, so they are not
 * combined: blending two mornings' HRV would report a number the body never
 * produced. One real reading is kept instead -- the most complete, and on a tie
 * the later one, which for a shift worker is the score from the main sleep
 * rather than from a nap earlier in the same date.
 */
export function mapRecovery(records: Rec[], userId: string, cycleDays: Map<string, string>) {
  const byDay = new Map<string, Rec>()
  const seenAt = new Map<string, number>()
  for (const r of records) {
    const cycleId = String(obj(r).cycle_id ?? '')
    const day = cycleDays.get(cycleId) ?? localDay(str(r, 'created_at'))
    if (!day) continue

    // "milli" is milliseconds, but guard against a value that arrived in
    // seconds so a unit change upstream cannot silently flatten the chart.
    let hrv = num(r, 'score.hrv_rmssd_milli')
    if (hrv !== null && hrv > 0 && hrv < 1) hrv = hrv * 1000

    const row: Rec = {
      user_id: userId,
      day,
      source: 'whoop_api',
      recovery_pct: round(num(r, 'score.recovery_score')),
      hrv_ms: round(hrv),
      resting_hr: round(num(r, 'score.resting_heart_rate')),
      spo2_pct: round(num(r, 'score.spo2_percentage')),
      skin_temp_c: round(num(r, 'score.skin_temp_celsius')),
      respiratory_rate: null,
    }

    const at = Date.parse(str(r, 'created_at') ?? '')
    const createdAt = Number.isFinite(at) ? at : 0
    const prev = byDay.get(day)
    if (
      !prev ||
      filled(row) > filled(prev) ||
      (filled(row) === filled(prev) && createdAt >= (seenAt.get(day) ?? 0))
    ) {
      byDay.set(day, row)
      seenAt.set(day, createdAt)
    }
  }
  return [...byDay.values()]
}

export function mapSleep(records: Rec[], userId: string) {
  const rows: Rec[] = []
  for (const r of records) {
    const offset = str(r, 'timezone_offset')
    const startedAt = iso(str(r, 'start'))
    const endedAt = iso(str(r, 'end'))
    // Attributed to the wake date, matching how the CSV importer does it.
    const day = localDay(str(r, 'end'), offset)
    if (!startedAt || !endedAt || !day) continue

    const inBed = ms(num(r, 'score.stage_summary.total_in_bed_time_milli'))
    const awake = ms(num(r, 'score.stage_summary.total_awake_time_milli'))
    const light = ms(num(r, 'score.stage_summary.total_light_sleep_time_milli'))
    const deep = ms(num(r, 'score.stage_summary.total_slow_wave_sleep_time_milli'))
    const rem = ms(num(r, 'score.stage_summary.total_rem_sleep_time_milli'))

    const staged = (light ?? 0) + (deep ?? 0) + (rem ?? 0)
    const asleep = staged > 0 ? staged : null

    // Whoop reports need as a set of components that add up to the total.
    const needParts = [
      num(r, 'score.sleep_needed.baseline_milli'),
      num(r, 'score.sleep_needed.need_from_sleep_debt_milli'),
      num(r, 'score.sleep_needed.need_from_recent_strain_milli'),
      num(r, 'score.sleep_needed.need_from_recent_nap_milli'),
    ].filter((v): v is number => v !== null)
    const need = needParts.length ? ms(needParts.reduce((a, b) => a + b, 0)) : null
    const debt = ms(num(r, 'score.sleep_needed.need_from_sleep_debt_milli'))

    const efficiency = num(r, 'score.sleep_efficiency_percentage')

    rows.push({
      user_id: userId,
      source: 'whoop_api',
      external_id: String(obj(r).id ?? startedAt),
      day,
      started_at: startedAt,
      ended_at: endedAt,
      is_nap: obj(r).nap === true,
      duration_min: round(inBed),
      asleep_min: round(asleep),
      rem_min: round(rem),
      deep_min: round(deep),
      light_min: round(light),
      awake_min: round(awake),
      latency_min: null,
      efficiency_pct: round(
        efficiency ?? (asleep && inBed ? (asleep / inBed) * 100 : null),
      ),
      disturbances: num(r, 'score.stage_summary.disturbance_count'),
      respiratory_rate: round(num(r, 'score.respiratory_rate')),
      performance_pct: round(num(r, 'score.sleep_performance_percentage')),
      need_min: round(need),
      debt_min: round(debt),
    })
  }
  return rows
}

export function mapWorkouts(records: Rec[], userId: string) {
  const rows: Rec[] = []
  for (const r of records) {
    const offset = str(r, 'timezone_offset')
    const startedAt = iso(str(r, 'start'))
    const endedAt = iso(str(r, 'end'))
    const day = localDay(str(r, 'start'), offset)
    if (!startedAt || !endedAt || !day) continue

    const kj = num(r, 'score.kilojoule')
    const meters = num(r, 'score.distance_meter')
    const zone = (k: string) => ms(num(r, `score.zone_durations.${k}`))

    rows.push({
      user_id: userId,
      source: 'whoop_api',
      external_id: String(obj(r).id ?? startedAt),
      day,
      started_at: startedAt,
      ended_at: endedAt,
      // v2 names the sport; v1's numeric id is gone.
      activity: str(r, 'sport_name') ?? 'Workout',
      duration_min: round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000),
      energy_kcal: round(kj === null ? null : kj / 4.184),
      distance_km: round(meters === null ? null : meters / 1000, 3),
      avg_hr: round(num(r, 'score.average_heart_rate')),
      max_hr: round(num(r, 'score.max_heart_rate')),
      strain: round(num(r, 'score.strain')),
      // zone_zero is time below zone 1 and is not one of the five.
      zone_1_min: round(zone('zone_one_milli')),
      zone_2_min: round(zone('zone_two_milli')),
      zone_3_min: round(zone('zone_three_milli')),
      zone_4_min: round(zone('zone_four_milli')),
      zone_5_min: round(zone('zone_five_milli')),
    })
  }
  return rows
}
