import { useMemo, useState } from 'react'
import { ChartCard } from '../components/charts/ChartCard'
import { AreaTrend, SimpleBars, TrendChart } from '../components/charts/Charts'
import { Empty, StatTile } from '../components/ui'
import { hm, num } from '../lib/format'
import { useTheme } from '../lib/theme'
import type { Derived } from './common'
import { recentMean, rowsFrom } from './common'

/** Presentation for the open-ended set of metrics an Apple Health export can
 *  carry. Anything not listed still shows up in the explorer at the bottom. */
const LABELS: Record<string, { label: string; unit: string; digits: number }> = {
  steps:                  { label: 'Steps', unit: '', digits: 0 },
  distance_km:            { label: 'Walking + running distance', unit: 'km', digits: 2 },
  cycling_km:             { label: 'Cycling distance', unit: 'km', digits: 2 },
  swimming_km:            { label: 'Swimming distance', unit: 'km', digits: 2 },
  flights_climbed:        { label: 'Flights climbed', unit: '', digits: 0 },
  active_energy_kcal:     { label: 'Active energy', unit: 'kcal', digits: 0 },
  basal_energy_kcal:      { label: 'Resting energy', unit: 'kcal', digits: 0 },
  exercise_min:           { label: 'Exercise minutes', unit: 'min', digits: 0 },
  stand_min:              { label: 'Stand minutes', unit: 'min', digits: 0 },
  daylight_min:           { label: 'Time in daylight', unit: 'min', digits: 0 },
  vo2_max:                { label: 'VO2 max', unit: 'mL/kg/min', digits: 1 },
  body_mass_kg:           { label: 'Body mass', unit: 'kg', digits: 1 },
  body_fat_pct:           { label: 'Body fat', unit: '%', digits: 1 },
  bmi:                    { label: 'BMI', unit: '', digits: 1 },
  spo2_pct:               { label: 'Blood oxygen', unit: '%', digits: 1 },
  heart_rate_avg:         { label: 'Average heart rate', unit: 'bpm', digits: 0 },
  walking_hr_avg:         { label: 'Walking heart rate', unit: 'bpm', digits: 0 },
  resting_hr:             { label: 'Resting heart rate', unit: 'bpm', digits: 0 },
  hrv_ms:                 { label: 'HRV (SDNN)', unit: 'ms', digits: 0 },
  respiratory_rate:       { label: 'Respiratory rate', unit: 'rpm', digits: 1 },
  wrist_temp_c:           { label: 'Sleeping wrist temperature', unit: 'C', digits: 2 },
  env_audio_db:           { label: 'Environmental sound', unit: 'dB', digits: 0 },
  headphone_audio_db:     { label: 'Headphone audio', unit: 'dB', digits: 0 },
  walking_steadiness_pct: { label: 'Walking steadiness', unit: '%', digits: 0 },
  water_l:                { label: 'Water', unit: 'L', digits: 2 },
  dietary_energy_kcal:    { label: 'Dietary energy', unit: 'kcal', digits: 0 },
  mindful_min:            { label: 'Mindful minutes', unit: 'min', digits: 0 },
  bp_systolic:            { label: 'Blood pressure, systolic', unit: 'mmHg', digits: 0 },
  bp_diastolic:           { label: 'Blood pressure, diastolic', unit: 'mmHg', digits: 0 },
}

const HEADLINE = ['steps', 'active_energy_kcal', 'exercise_min', 'distance_km']

export function Activity({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const rows = useMemo(() => {
    const get = (name: string) => d.metric(name)
    const steps = get('steps')
    const energy = get('active_energy_kcal')
    const exercise = get('exercise_min')
    const distance = get('distance_km')
    const vo2 = get('vo2_max')
    const daylight = get('daylight_min')
    const flights = get('flights_climbed')
    return rowsFrom(d.axis, {
      steps: (day) => steps.get(day) ?? null,
      energy: (day) => energy.get(day) ?? null,
      exercise: (day) => exercise.get(day) ?? null,
      distance: (day) => distance.get(day) ?? null,
      vo2: (day) => vo2.get(day) ?? null,
      daylight: (day) => daylight.get(day) ?? null,
      flights: (day) => flights.get(day) ?? null,
    })
  }, [d])

  const anyData = rows.some((r) => HEADLINE.some(() => typeof r.steps === 'number' || typeof r.energy === 'number'))

  if (!anyData) {
    return (
      <Empty
        title="No activity data"
        body="Steps, energy and distance come from your Apple Health export. Import one to see them here."
      />
    )
  }

  const steps7 = recentMean(rows, 'steps', 7)
  const steps28 = recentMean(rows, 'steps', 28)
  const energy7 = recentMean(rows, 'energy', 7)
  const exercise7 = recentMean(rows, 'exercise', 7)
  const distance7 = recentMean(rows, 'distance', 7)

  const fmtSteps = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Steps per day"
          value={num(steps7, 0)}
          delta={steps7 !== null && steps28 !== null ? (steps7 - steps28) / 1000 : null}
          deltaLabel="k vs 28-day"
          color="var(--series-6)"
          sub="7-day average"
        />
        <StatTile label="Active energy" value={num(energy7, 0)} unit="kcal" color="var(--series-3)" sub="7-day average" />
        <StatTile label="Exercise" value={hm(exercise7)} color="var(--series-3)" sub="7-day average" />
        <StatTile label="Distance" value={num(distance7, 2)} unit="km" color="var(--series-6)" sub="7-day average" />
      </div>

      <ChartCard
        title="Steps"
        accent="var(--series-3)"
        hint="Dashed line marks 10,000."
        rows={rows}
        series={[{ key: 'steps', label: 'Steps', color: palette.series[2], format: fmtSteps }]}
      >
        <SimpleBars
          rows={rows}
          series={[{ key: 'steps', label: 'Steps', color: palette.series[2], format: fmtSteps }]}
          yTickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          guides={[{ value: 10000, label: '10k' }]}
          height={220}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Active energy"
          accent="var(--series-3)"
          rows={rows}
          series={[{ key: 'energy', label: 'Active energy', color: palette.series[2], format: (v) => `${v.toFixed(0)} kcal` }]}
        >
          <AreaTrend
            rows={rows}
            series={[{ key: 'energy', label: 'Active energy', color: palette.series[2], format: (v) => `${v.toFixed(0)} kcal` }]}
          />
        </ChartCard>

        <ChartCard
          title="Exercise minutes"
          accent="var(--series-3)"
          rows={rows}
          series={[{ key: 'exercise', label: 'Exercise', color: palette.series[2], format: hm }]}
        >
          <SimpleBars
            rows={rows}
            series={[{ key: 'exercise', label: 'Exercise', color: palette.series[2], format: hm }]}
            yTickFormatter={(v) => `${v}m`}
            guides={[{ value: 30, label: '30m' }]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="VO2 max"
          accent="var(--series-1)"
          hint="Apple's cardio-fitness estimate. It moves slowly, so read the shape rather than day to day."
          rows={rows}
          series={[{ key: 'vo2', label: 'VO2 max', color: palette.series[0], format: (v) => v.toFixed(1) }]}
        >
          <TrendChart
            rows={rows}
            series={[{ key: 'vo2', label: 'VO2 max', color: palette.series[0], format: (v) => v.toFixed(1) }]}
          />
        </ChartCard>

        <ChartCard
          title="Time in daylight"
          accent="var(--series-5)"
          hint="Worth watching alongside sleep if your schedule pushes you indoors at odd hours."
          rows={rows}
          series={[{ key: 'daylight', label: 'Daylight', color: palette.series[4], format: hm }]}
        >
          <SimpleBars
            rows={rows}
            series={[{ key: 'daylight', label: 'Daylight', color: palette.series[4], format: hm }]}
            yTickFormatter={(v) => `${Math.round(v / 60)}h`}
          />
        </ChartCard>
      </div>

      <MetricExplorer d={d} />
    </div>
  )
}

/** Whatever else the export happened to contain. Apple Health's metric list
 *  grows with every watchOS release, so the dashboard exposes everything it
 *  recognised rather than only the metrics it has a designed card for. */
function MetricExplorer({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const names = useMemo(
    () => Object.keys(LABELS)
      .filter((name) => d.metric(name).size > 0)
      .sort((a, b) => LABELS[a].label.localeCompare(LABELS[b].label)),
    [d],
  )

  const [selected, setSelected] = useState<string>('')
  const active = selected || names[0] || ''

  const rows = useMemo(() => {
    if (!active) return []
    const series = d.metric(active)
    return rowsFrom(d.axis, { value: (day) => series.get(day) ?? null })
  }, [d, active])

  if (names.length <= 1) return null

  const meta = LABELS[active] ?? { label: active, unit: '', digits: 1 }
  const format = (v: number) =>
    `${v.toLocaleString(undefined, { maximumFractionDigits: meta.digits })}${meta.unit ? ' ' + meta.unit : ''}`

  return (
    <ChartCard
      title="Everything else"
      accent="var(--series-2)"
      hint="Every metric found in your export, including ones without a card of their own."
      rows={rows}
      series={[{ key: 'value', label: meta.label, color: palette.series[0], format }]}
      right={
        <select
          aria-label="Choose a metric"
          value={active}
          onChange={(e) => setSelected(e.target.value)}
          className="t-caption rounded-[10px] bg-[var(--fill)] px-2.5 py-1.5 text-[var(--label)]"
        >
          {names.map((n) => (
            <option key={n} value={n}>{LABELS[n]?.label ?? n}</option>
          ))}
        </select>
      }
    >
      <TrendChart
        rows={rows}
        series={[{ key: 'value', label: meta.label, color: palette.series[0], format }]}
      />
    </ChartCard>
  )
}
