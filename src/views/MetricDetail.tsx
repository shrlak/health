import { useMemo, useState } from 'react'
import { Card, Empty, Segmented, SectionTitle } from '../components/ui'
import { AreaTrend, SimpleBars, TrendChart } from '../components/charts/Charts'
import { ChartCard, type ChartRow } from '../components/charts/ChartCard'
import { Link } from '../lib/router'
import { useTheme } from '../lib/theme'
import { longDay } from '../lib/format'
import { mean, median, rolling, stdev } from '../lib/analytics'
import {
  CATEGORY_SECTION, METRIC_BY_KEY, METRICS, metricSlot,
} from '../lib/metrics'
import type { Derived } from './common'
// The same vocabulary as the header control, so switching pages does not
// switch what the buttons mean.
import { ALL_RANGE, RANGES } from './common'

/**
 * One page serving every metric, driven by the registry.
 *
 * Shows the current value, the distribution behind it, the full history at a
 * chosen range, and what the number means -- rather than a chart on its own,
 * which tells you the shape but not whether it is good.
 */
export function MetricDetail({ d, metricKey }: { d: Derived; metricKey: string }) {
  const { palette } = useTheme()
  const [range, setRange] = useState<string>('30')

  const def = METRIC_BY_KEY.get(metricKey)

  const series = useMemo(() => (def ? def.series(d) : new Map<string, number>()), [def, d])

  const days = useMemo(() => {
    if (range === ALL_RANGE) return d.axis
    return d.axis.slice(-(Number(range) + 1))
  }, [d.axis, range])

  const rows = useMemo<ChartRow[]>(() => {
    const base = days.map((day) => ({ day, value: series.get(day) ?? null }))
    // A trailing mean makes the trend readable through day-to-day noise.
    const roll = rolling(base, 7)
    return base.map((r, i) => ({ day: r.day, value: r.value, avg: roll[i].value }))
  }, [days, series])

  const stats = useMemo(() => {
    const values = days
      .map((day) => series.get(day))
      .filter((v): v is number => v !== undefined)
    return {
      n: values.length,
      mean: mean(values),
      median: median(values),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      sd: stdev(values),
    }
  }, [days, series])

  const latest = useMemo(() => {
    for (let i = d.axis.length - 1; i >= 0; i--) {
      const v = series.get(d.axis[i])
      if (v !== undefined) return { day: d.axis[i], value: v }
    }
    return null
  }, [d.axis, series])

  if (!def) {
    return (
      <div className="space-y-4">
        <Empty
          title="Unknown metric"
          body="That link does not match anything this dashboard tracks."
        />
        <Link to="/" className="t-body block text-center font-medium text-[var(--tint)]">
          Back to summary
        </Link>
      </div>
    )
  }

  if (!series.size) {
    return (
      <div className="space-y-4">
        <Empty
          title={`No ${def.label.toLowerCase()} data`}
          body={`${def.description} Source: ${def.source}. Import an export containing it to see this page.`}
        />
        <Link to="/" className="t-body block text-center font-medium text-[var(--tint)]">
          Back to summary
        </Link>
      </div>
    )
  }

  const color = palette.series[metricSlot(def.category)]
  const section = CATEGORY_SECTION[def.category]

  const valueSeries = { key: 'value', label: def.label, color, format: def.format }
  const avgSeries = {
    key: 'avg', label: '7-day average', color: palette.series[4], format: def.format,
  }
  // The legend and the table must describe exactly what the chart draws: only
  // the line form overlays the rolling average.
  const drawn = def.chart === 'line' ? [valueSeries, avgSeries] : [valueSeries]

  // Related metrics from the same category make a natural next tap.
  const related = METRICS.filter((m) => m.category === def.category && m.key !== def.key)
    .filter((m) => m.series(d).size > 0)
    .slice(0, 4)

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ headline */}
      <section>
        <Card glass>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="t-caption font-semibold tracking-wide uppercase" style={{ color }}>
                Latest
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="tnum t-large-title text-[var(--label)]">
                  {latest ? def.format(latest.value) : '--'}
                </span>
              </div>
              {latest && (
                <p className="t-footnote mt-0.5 text-[var(--label-2)]">{longDay(latest.day)}</p>
              )}
            </div>

            <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-right">
              <Stat label="Average" value={stats.mean === null ? '--' : def.format(stats.mean)} />
              <Stat label="Low" value={stats.min === null ? '--' : def.format(stats.min)} />
              <Stat label="High" value={stats.max === null ? '--' : def.format(stats.max)} />
            </dl>
          </div>
        </Card>
      </section>

      {/* --------------------------------------------------- chart */}
      <section>
        <ChartCard
          title={def.longLabel ?? def.label}
          accent={color}
          hint={`${stats.n} ${stats.n === 1 ? 'day' : 'days'} with data in this range.`}
          rows={rows}
          series={drawn}
          right={
            <Segmented
              size="sm"
              ariaLabel="Date range"
              value={range}
              onChange={setRange}
              options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            />
          }
        >
          {def.chart === 'bar' ? (
            <SimpleBars
              rows={rows}
              series={drawn}
              yTickFormatter={def.formatAxis}
              guides={def.goal ? [{ value: def.goal.value, label: def.goal.label }] : undefined}
              height={240}
            />
          ) : def.chart === 'area' ? (
            <AreaTrend rows={rows} series={drawn} yTickFormatter={def.formatAxis} height={240} />
          ) : (
            <TrendChart
              rows={rows}
              series={drawn}
              yTickFormatter={def.formatAxis}
              guides={def.goal ? [{ value: def.goal.value, label: def.goal.label }] : undefined}
              height={240}
            />
          )}
        </ChartCard>
      </section>

      {/* ---------------------------------------------- statistics */}
      <section>
        <SectionTitle>Statistics</SectionTitle>
        <Card>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-3">
            <Row label="Days with data" value={String(stats.n)} />
            <Row label="Average" value={stats.mean === null ? '--' : def.format(stats.mean)} />
            <Row label="Median" value={stats.median === null ? '--' : def.format(stats.median)} />
            <Row label="Lowest" value={stats.min === null ? '--' : def.format(stats.min)} />
            <Row label="Highest" value={stats.max === null ? '--' : def.format(stats.max)} />
            <Row
              label="Variability"
              value={stats.sd === null ? '--' : `± ${def.format(stats.sd)}`}
            />
          </dl>
        </Card>
      </section>

      {/* -------------------------------------------------- about */}
      <section>
        <SectionTitle>About this measure</SectionTitle>
        <Card>
          <p className="t-subhead text-[var(--label-2)]">{def.description}</p>
          <dl className="mt-4 space-y-2">
            <div className="flex gap-3">
              <dt className="t-footnote w-24 shrink-0 text-[var(--label-3)]">Source</dt>
              <dd className="t-footnote text-[var(--label-2)]">{def.source}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="t-footnote w-24 shrink-0 text-[var(--label-3)]">Per day</dt>
              <dd className="t-footnote text-[var(--label-2)]">
                {def.perDay
                  ?? (def.agg === 'sum' ? 'Values across the day are added together'
                    : def.agg === 'max' ? 'The highest reading of the day is kept'
                    : 'Readings during the day are averaged')}
              </dd>
            </div>
            {def.goal && (
              <div className="flex gap-3">
                <dt className="t-footnote w-24 shrink-0 text-[var(--label-3)]">Reference</dt>
                <dd className="t-footnote text-[var(--label-2)]">
                  {def.goal.label}, drawn on the chart
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </section>

      {/* ------------------------------------------------- related */}
      {related.length > 0 && (
        <section>
          <SectionTitle>Related</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((m) => (
              <Link
                key={m.key}
                to={`/metric/${m.key}`}
                className="panel rounded-[var(--r-tile)] px-3.5 py-3"
              >
                <span
                  className="t-footnote font-semibold"
                  style={{ color: palette.series[metricSlot(m.category)] }}
                >
                  {m.label}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <Link
          to={section.path}
          className="panel flex items-center justify-between rounded-[var(--r-card)] px-4 py-3.5"
        >
          <span className="t-body text-[var(--tint)]">
            See everything in {section.label}
          </span>
          <svg
            width={18} height={18} viewBox="0 0 24 24" fill="none"
            stroke="var(--label-3)" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-caption-2 text-[var(--label-3)]">{label}</dt>
      <dd className="tnum t-subhead font-semibold text-[var(--label)]">{value}</dd>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-footnote text-[var(--label-3)]">{label}</dt>
      <dd className="tnum t-body mt-0.5 text-[var(--label)]">{value}</dd>
    </div>
  )
}
