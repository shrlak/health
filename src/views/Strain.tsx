import { useMemo } from 'react'
import { ChartCard } from '../components/charts/ChartCard'
import { RankedBars, Relationship, SimpleBars, StackedBars } from '../components/charts/Charts'
import { Card, Empty, SectionTitle, StatTile } from '../components/ui'
import { hm, longDay, num } from '../lib/format'
import { correlate, mean } from '../lib/analytics'
import { useTheme } from '../lib/theme'
import type { Derived } from './common'
import { recentMean, rowsFrom } from './common'

export function Strain({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const rows = useMemo(() => {
    const workoutMin = new Map<string, number>()
    for (const w of d.workouts) {
      workoutMin.set(w.day, (workoutMin.get(w.day) ?? 0) + (w.duration_min ?? 0))
    }
    return rowsFrom(d.axis, {
      strain: (day) => d.cycles.get(day)?.strain ?? null,
      avgHr: (day) => d.cycles.get(day)?.avg_hr ?? null,
      // Whoop stores kilojoules; the dashboard talks in kilocalories.
      energy: (day) => {
        const kj = d.cycles.get(day)?.kilojoules
        return typeof kj === 'number' ? kj / 4.184 : null
      },
      maxHr: (day) => d.cycles.get(day)?.max_hr ?? null,
      trainingMin: (day) => workoutMin.get(day) ?? null,
    })
  }, [d])

  const byActivity = useMemo(() => {
    const agg = new Map<string, { min: number; n: number; strain: number[] }>()
    for (const w of d.workouts) {
      const key = w.activity ?? 'Workout'
      const cur = agg.get(key) ?? { min: 0, n: 0, strain: [] }
      cur.min += w.duration_min ?? 0
      cur.n += 1
      if (w.strain !== null) cur.strain.push(w.strain)
      agg.set(key, cur)
    }
    return [...agg.entries()]
      .map(([label, v]) => ({ label, minutes: Math.round(v.min), count: v.n, strain: mean(v.strain) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8)
  }, [d.workouts])

  const zoneRows = useMemo(() => {
    const withZones = d.workouts.filter((w) => w.zone_1_min !== null)
    const byDay = new Map<string, { z1: number; z2: number; z3: number; z4: number; z5: number }>()
    for (const w of withZones) {
      const cur = byDay.get(w.day) ?? { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
      cur.z1 += w.zone_1_min ?? 0
      cur.z2 += w.zone_2_min ?? 0
      cur.z3 += w.zone_3_min ?? 0
      cur.z4 += w.zone_4_min ?? 0
      cur.z5 += w.zone_5_min ?? 0
      byDay.set(w.day, cur)
    }
    return rowsFrom(d.axis, {
      z1: (day) => byDay.get(day)?.z1 ?? null,
      z2: (day) => byDay.get(day)?.z2 ?? null,
      z3: (day) => byDay.get(day)?.z3 ?? null,
      z4: (day) => byDay.get(day)?.z4 ?? null,
      z5: (day) => byDay.get(day)?.z5 ?? null,
    })
  }, [d])

  const hasZones = zoneRows.some((r) => typeof r.z1 === 'number')

  const strainVsRecovery = useMemo(() => {
    const pts: Array<{ x: number; y: number; day: string }> = []
    for (let i = 0; i < d.axis.length - 1; i++) {
      const strain = d.cycles.get(d.axis[i])?.strain
      // Yesterday's strain against the recovery it produced this morning.
      const rec = d.recoveries.get(d.axis[i + 1])?.recovery_pct
      if (typeof strain === 'number' && typeof rec === 'number') {
        pts.push({ x: strain, y: rec, day: d.axis[i] })
      }
    }
    return pts
  }, [d])

  const corr = useMemo(() => {
    const a = new Map<string, number>()
    const b = new Map<string, number>()
    for (const p of strainVsRecovery) { a.set(p.day, p.x); b.set(p.day, p.y) }
    return correlate(a, b)
  }, [strainVsRecovery])

  const recent = useMemo(() => [...d.workouts].reverse().slice(0, 12), [d.workouts])

  const weekWorkouts = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000
    return d.workouts.filter((w) => new Date(w.started_at).getTime() > cutoff).length
  }, [d.workouts])

  if (!d.workouts.length && !rows.some((r) => typeof r.strain === 'number')) {
    return (
      <Empty
        title="No training data"
        body="Strain and workouts come from Whoop. Connect it to fill this in."
      />
    )
  }

  const strain7 = recentMean(rows, 'strain', 7)
  const strain28 = recentMean(rows, 'strain', 28)
  const energy7 = recentMean(rows, 'energy', 7)
  const train7 = recentMean(rows, 'trainingMin', 7)

  // Zones are ordered by intensity, so they ramp rather than take five hues.
  const zoneSeries = [
    { key: 'z1', label: 'Zone 1', color: palette.hrZones[0], format: hm },
    { key: 'z2', label: 'Zone 2', color: palette.hrZones[1], format: hm },
    { key: 'z3', label: 'Zone 3', color: palette.hrZones[2], format: hm },
    { key: 'z4', label: 'Zone 4', color: palette.hrZones[3], format: hm },
    { key: 'z5', label: 'Zone 5', color: palette.hrZones[4], format: hm },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Strain, 7-day average"
          value={num(strain7, 1)}
          delta={strain7 !== null && strain28 !== null ? strain7 - strain28 : null}
          deltaLabel="vs 28-day"
          color="var(--series-3)"
        />
        <StatTile label="Workouts this week" value={String(weekWorkouts)} color="var(--series-3)" />
        <StatTile label="Training time per day" value={hm(train7)} color="var(--series-3)" sub="7-day average" />
        <StatTile label="Energy burned per day" value={num(energy7, 0)} unit="kcal" color="var(--series-6)" sub="7-day average" />
      </div>

      <ChartCard
        title="Day strain"
        accent="var(--series-3)"
        hint="Whoop's 0-21 scale. It is logarithmic, so the top of the range is much harder to reach than the bottom."
        rows={rows}
        series={[{ key: 'strain', label: 'Strain', color: palette.series[2], format: (v) => v.toFixed(1) }]}
      >
        <SimpleBars
          rows={rows}
          series={[{ key: 'strain', label: 'Strain', color: palette.series[2], format: (v) => v.toFixed(1) }]}
          guides={[{ value: 14, label: 'Strenuous' }, { value: 10, label: 'Moderate' }]}
          height={220}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Where the time goes"
          accent="var(--series-3)"
          hint="Total minutes per activity across the selected range."
          rows={byActivity.map((a) => ({ day: a.label, minutes: a.minutes }))}
          series={[{ key: 'minutes', label: 'Minutes', color: palette.series[2], format: hm }]}
        >
          <RankedBars
            rows={byActivity}
            series={[{ key: 'minutes', label: 'Total time', color: palette.series[2], format: hm }]}
            formatValue={hm}
            height={Math.max(160, byActivity.length * 30)}
          />
        </ChartCard>

        <ChartCard
          title="Does hard training cost you the next morning?"
          accent="var(--series-3)"
          hint={
            corr
              ? `Yesterday's strain against this morning's recovery: r = ${corr.r.toFixed(2)} over ${corr.n} days. A negative value means harder days do show up as lower recovery.`
              : 'Needs at least eight days with both strain and next-day recovery.'
          }
          rows={[]}
          series={[]}
        >
          <Relationship
            points={strainVsRecovery}
            xLabel="Strain (previous day)"
            yLabel="Recovery %"
            color={palette.series[2]}
            xFormat={(v) => v.toFixed(1)}
            yFormat={(v) => `${v.toFixed(0)}%`}
          />
        </ChartCard>
      </div>

      {hasZones && (
        <ChartCard
          title="Heart rate zones"
          accent="var(--series-1)"
          hint="Minutes per zone per day, from Whoop's per-workout zone breakdown."
          rows={zoneRows}
          series={zoneSeries}
        >
          <StackedBars rows={zoneRows} series={zoneSeries} yTickFormatter={(v) => `${v}m`} height={220} />
        </ChartCard>
      )}

      <Card>
        <SectionTitle>Recent workouts</SectionTitle>
        <div className="overflow-x-auto">
          <table className="t-subhead w-full min-w-[520px] text-left">
            <thead>
              <tr className="t-caption text-[var(--label-3)]">
                <th scope="col" className="pb-2 font-medium">Date</th>
                <th scope="col" className="pb-2 font-medium">Activity</th>
                <th scope="col" className="pb-2 text-right font-medium">Time</th>
                <th scope="col" className="pb-2 text-right font-medium">Avg HR</th>
                <th scope="col" className="pb-2 text-right font-medium">Energy</th>
                <th scope="col" className="pb-2 text-right font-medium">Strain</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((w) => (
                <tr key={w.source + w.external_id} className="border-t border-[var(--separator)]">
                  <td className="py-2 text-[var(--label-2)]">{longDay(w.day)}</td>
                  <td className="py-2 text-[var(--label)]">{w.activity}</td>
                  <td className="tnum py-2 text-right text-[var(--label)]">{hm(w.duration_min)}</td>
                  <td className="tnum py-2 text-right text-[var(--label)]">{num(w.avg_hr, 0)}</td>
                  <td className="tnum py-2 text-right text-[var(--label)]">{num(w.energy_kcal, 0)}</td>
                  <td className="tnum py-2 text-right text-[var(--label)]">{num(w.strain, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
