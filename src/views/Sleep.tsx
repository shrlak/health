import { useMemo } from 'react'
import { ChartCard } from '../components/charts/ChartCard'
import { Relationship, SimpleBars, StackedBars, TrendChart } from '../components/charts/Charts'
import { Card, Empty, SectionTitle, StatTile } from '../components/ui'
import { hm, hourOfDay, num, WEEKDAY_NAMES } from '../lib/format'
import { byWeekday, consistencyStats, splitByDaytimeSleep, type ShiftSplit } from '../lib/analytics'
import { useTheme } from '../lib/theme'
import type { Derived } from './common'
import { recentMean, rowsFrom } from './common'

export function Sleep({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const rows = useMemo(() => rowsFrom(d.axis, {
    rem: (day) => d.sleepByDay.get(day)?.rem_min ?? null,
    deep: (day) => d.sleepByDay.get(day)?.deep_min ?? null,
    light: (day) => d.sleepByDay.get(day)?.light_min ?? null,
    awake: (day) => d.sleepByDay.get(day)?.awake_min ?? null,
    asleep: (day) => d.sleepByDay.get(day)?.asleep_min ?? null,
    efficiency: (day) => d.sleepByDay.get(day)?.efficiency_pct ?? null,
    debt: (day) => d.sleepByDay.get(day)?.debt_min ?? null,
    performance: (day) => d.sleepByDay.get(day)?.performance_pct ?? null,
  }), [d])

  const sessions = useMemo(
    () => d.axis.map((day) => d.sleepByDay.get(day)).filter((s) => !!s),
    [d],
  )

  const consistency = useMemo(() => consistencyStats(sessions.slice(-60)), [sessions])
  const split = useMemo(
    () => splitByDaytimeSleep(
      new Map(sessions.map((s) => [s.day, s])),
      d.recoveries,
    ),
    [sessions, d.recoveries],
  )

  const timing = useMemo(
    () => sessions.map((s) => ({
      day: s.day,
      // Unwrap bedtimes past midnight onto a continuous evening axis, so a
      // 00:30 bedtime plots just after 23:30 instead of a day away from it.
      x: (() => { const h = hourOfDay(s.started_at); return h < 12 ? h + 24 : h })(),
      y: hourOfDay(s.ended_at),
    })),
    [sessions],
  )

  const weekday = useMemo(
    () => byWeekday(
      sessions.map((s) => ({ day: s.day, row: s })),
      (s) => s.asleep_min,
    ).map((b) => ({ day: WEEKDAY_NAMES[b.weekday], asleep: b.value })),
    [sessions],
  )

  const weekdayRows = weekday.map((w) => ({ day: w.day, asleep: w.asleep }))
  const weekdaySeries = [
    { key: 'asleep', label: 'Asleep', color: palette.series[6], format: hm },
  ]

  if (!sessions.length) {
    return <Empty title="No sleep data" body="Connect Whoop to see sleep here." />
  }

  // Deepest first, so the ramp reads as depth of sleep rather than as four
  // unrelated categories.
  const stageSeries = [
    { key: 'deep', label: 'Deep', color: palette.sleepStages[0], format: hm },
    { key: 'rem', label: 'REM', color: palette.sleepStages[1], format: hm },
    { key: 'light', label: 'Light', color: palette.sleepStages[2], format: hm },
    { key: 'awake', label: 'Awake', color: palette.sleepStages[3], format: hm },
  ]

  const avgSleep = recentMean(rows, 'asleep', 30)
  const avgEff = recentMean(rows, 'efficiency', 30)
  const avgDebt = recentMean(rows, 'debt', 30)
  const avgPerf = recentMean(rows, 'performance', 30)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Asleep, 30-day average" value={hm(avgSleep)} color="var(--series-7)" />
        <StatTile label="Efficiency, 30-day average" value={num(avgEff, 0)} unit="%" color="var(--series-7)" />
        <StatTile
          label="Bedtime consistency"
          color="var(--series-7)"
          value={consistency.bedtimeStdevH === null ? '--' : `+/- ${hm(consistency.bedtimeStdevH * 60)}`}
          sub={`Spread across the last ${consistency.n} nights`}
        />
        {avgPerf !== null
          ? <StatTile label="Sleep performance" value={num(avgPerf, 0)} unit="%" color="var(--series-7)" sub="Whoop: asleep vs needed" />
          : <StatTile label="Sleep debt" value={hm(avgDebt)} color="var(--series-7)" sub="Whoop 30-day average" />}
      </div>

      <ShiftComparison split={split} />

      <ChartCard
        title="Sleep stages"
        accent="var(--series-7)"
        hint="Each bar is one night, split by stage. Naps are excluded, so a day sleep after a night shift does not double-count."
        rows={rows}
        series={stageSeries}
      >
        <StackedBars
          rows={rows}
          series={stageSeries}
          yTickFormatter={(v) => `${Math.round(v / 60)}h`}
          height={260}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Time asleep"
          accent="var(--series-7)"
          hint="Dashed line marks eight hours."
          rows={rows}
          series={[{ key: 'asleep', label: 'Asleep', color: palette.series[6], format: hm }]}
        >
          <TrendChart
            rows={rows}
            series={[{ key: 'asleep', label: 'Asleep', color: palette.series[6], format: hm }]}
            yTickFormatter={(v) => `${Math.round(v / 60)}h`}
            guides={[{ value: 480, label: '8h' }]}
          />
        </ChartCard>

        <ChartCard
          title="Sleep efficiency"
          accent="var(--series-7)"
          hint="Share of time in bed actually spent asleep."
          rows={rows}
          series={[{ key: 'efficiency', label: 'Efficiency', color: palette.series[6], format: (v) => `${v.toFixed(0)}%` }]}
        >
          <TrendChart
            rows={rows}
            series={[{ key: 'efficiency', label: 'Efficiency', color: palette.series[6], format: (v) => `${v.toFixed(0)}%` }]}
            yDomain={[50, 100]}
            yTickFormatter={(v) => `${v}%`}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="When you sleep"
          accent="var(--series-7)"
          hint="Each dot is one night: when you fell asleep against when you woke. A tight cluster means a stable schedule."
          rows={[]}
          series={[]}
        >
          <Relationship
            points={timing}
            xLabel="Fell asleep"
            yLabel="Woke"
            color={palette.series[6]}
            xFormat={(v) => `${String(Math.floor(v % 24)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`}
            yFormat={(v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`}
          />
        </ChartCard>

        <ChartCard
          title="Sleep by day of week"
          accent="var(--series-7)"
          hint="Average time asleep, grouped by weekday. Bars rather than a line, because weekdays are categories and nothing happens between them."
          rows={weekdayRows}
          series={weekdaySeries}
        >
          <SimpleBars
            rows={weekdayRows}
            series={weekdaySeries}
            categorical
            yTickFormatter={(v) => `${(v / 60).toFixed(1)}h`}
          />
        </ChartCard>
      </div>
    </div>
  )
}

/**
 * The overnight-shift view.
 *
 * Nights are classified by where the *midpoint* of the sleep falls: a session
 * centred between 09:00 and 20:00 is daytime sleep, which is what recovering
 * from an overnight shift looks like in the data. Nothing has to be logged by
 * hand -- the split is inferred from the timing the wearable already recorded.
 */
function ShiftComparison({ split }: { split: { day: ShiftSplit; night: ShiftSplit } }) {
  const { palette } = useTheme()
  const { day, night } = split

  if (day.days.length < 3) return null

  const rows: Array<{ label: string; day: string; night: string; delta: string | null }> = [
    {
      label: 'Time asleep',
      day: hm(day.sleepMin),
      night: hm(night.sleepMin),
      delta: day.sleepMin !== null && night.sleepMin !== null
        ? `${day.sleepMin >= night.sleepMin ? '+' : '-'}${hm(Math.abs(day.sleepMin - night.sleepMin))}`
        : null,
    },
    {
      label: 'Sleep efficiency',
      day: num(day.efficiency, 0, '%'),
      night: num(night.efficiency, 0, '%'),
      delta: day.efficiency !== null && night.efficiency !== null
        ? `${day.efficiency >= night.efficiency ? '+' : ''}${(day.efficiency - night.efficiency).toFixed(1)} pts`
        : null,
    },
    {
      label: 'REM share',
      day: num(day.remPct, 1, '%'),
      night: num(night.remPct, 1, '%'),
      delta: day.remPct !== null && night.remPct !== null
        ? `${day.remPct >= night.remPct ? '+' : ''}${(day.remPct - night.remPct).toFixed(1)} pts`
        : null,
    },
    {
      label: 'Deep share',
      day: num(day.deepPct, 1, '%'),
      night: num(night.deepPct, 1, '%'),
      delta: day.deepPct !== null && night.deepPct !== null
        ? `${day.deepPct >= night.deepPct ? '+' : ''}${(day.deepPct - night.deepPct).toFixed(1)} pts`
        : null,
    },
    {
      label: 'Recovery next day',
      day: num(day.recovery, 0, '%'),
      night: num(night.recovery, 0, '%'),
      delta: day.recovery !== null && night.recovery !== null
        ? `${day.recovery >= night.recovery ? '+' : ''}${(day.recovery - night.recovery).toFixed(1)} pts`
        : null,
    },
    {
      label: 'HRV',
      day: num(day.hrv, 0, ' ms'),
      night: num(night.hrv, 0, ' ms'),
      delta: day.hrv !== null && night.hrv !== null
        ? `${day.hrv >= night.hrv ? '+' : ''}${(day.hrv - night.hrv).toFixed(0)} ms`
        : null,
    },
    {
      label: 'Resting heart rate',
      day: num(day.restingHr, 0, ' bpm'),
      night: num(night.restingHr, 0, ' bpm'),
      delta: day.restingHr !== null && night.restingHr !== null
        ? `${day.restingHr >= night.restingHr ? '+' : ''}${(day.restingHr - night.restingHr).toFixed(0)} bpm`
        : null,
    },
  ]

  return (
    <Card>
      <SectionTitle hint="Nights are sorted automatically by when you actually slept -- a sleep centred between 09:00 and 20:00 counts as daytime recovery sleep after an overnight shift.">
        Daytime sleep vs normal nights
      </SectionTitle>

      <div className="overflow-x-auto">
        <table className="t-subhead w-full min-w-[420px] text-left">
          <thead>
            <tr className="t-caption text-[var(--label-3)]">
              <th scope="col" className="pb-2 font-medium">Measure</th>
              <th scope="col" className="pb-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: palette.series[3] }} />
                  Daytime sleep ({day.days.length})
                </span>
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: palette.series[6] }} />
                  Normal nights ({night.days.length})
                </span>
              </th>
              <th scope="col" className="pb-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-[var(--separator)]">
                <th scope="row" className="py-2 font-normal text-[var(--label-2)]">{r.label}</th>
                <td className="tnum py-2 text-right text-[var(--label)]">{r.day}</td>
                <td className="tnum py-2 text-right text-[var(--label)]">{r.night}</td>
                <td className="tnum py-2 text-right text-[var(--label-2)]">{r.delta ?? '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
