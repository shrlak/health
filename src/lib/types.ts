export type Source = 'apple_health' | 'whoop_csv' | 'whoop_api'

/** A day-grained scalar measurement. Long format keeps Apple Health's
 *  open-ended metric vocabulary from forcing a schema change per data type. */
export interface DailyMetric {
  day: string
  metric: string
  source: Source
  value: number
  unit: string | null
}

export interface SleepSession {
  source: Source
  external_id: string
  day: string
  started_at: string
  ended_at: string
  is_nap: boolean
  duration_min: number | null
  asleep_min: number | null
  rem_min: number | null
  deep_min: number | null
  light_min: number | null
  awake_min: number | null
  latency_min: number | null
  efficiency_pct: number | null
  disturbances: number | null
  respiratory_rate: number | null
  performance_pct: number | null
  need_min: number | null
  debt_min: number | null
}

export interface Recovery {
  day: string
  source: Source
  recovery_pct: number | null
  hrv_ms: number | null
  resting_hr: number | null
  spo2_pct: number | null
  skin_temp_c: number | null
  respiratory_rate: number | null
}

export interface Cycle {
  day: string
  source: Source
  strain: number | null
  avg_hr: number | null
  max_hr: number | null
  kilojoules: number | null
}

export interface Workout {
  source: Source
  external_id: string
  day: string
  started_at: string
  ended_at: string
  activity: string | null
  duration_min: number | null
  energy_kcal: number | null
  distance_km: number | null
  avg_hr: number | null
  max_hr: number | null
  strain: number | null
  zone_1_min: number | null
  zone_2_min: number | null
  zone_3_min: number | null
  zone_4_min: number | null
  zone_5_min: number | null
}

export interface ImportRecord {
  id: string
  source: Source
  filename: string | null
  status: 'running' | 'complete' | 'error'
  rows_imported: number
  range_start: string | null
  range_end: string | null
  error: string | null
  created_at: string
}

/** Everything a parser hands back, ready to upsert. */
export interface ParsedPayload {
  dailyMetrics: DailyMetric[]
  sleep: SleepSession[]
  recovery: Recovery[]
  cycles: Cycle[]
  workouts: Workout[]
}

export const emptyPayload = (): ParsedPayload => ({
  dailyMetrics: [], sleep: [], recovery: [], cycles: [], workouts: [],
})

export interface ParseProgress {
  phase: string
  /** 0..1 where known, otherwise null for indeterminate work. */
  ratio: number | null
  detail?: string
}
