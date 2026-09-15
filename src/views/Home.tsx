import { useMemo } from 'react'
import { Card, Empty, Meter, Ring, SectionTitle } from '../components/ui'
import { Sparkline } from '../components/Sparkline'
import { Link } from '../lib/router'
import { useTheme } from '../lib/theme'
import { longDay } from '../lib/format'
import { METRIC_BY_KEY, SUMMARY_ORDER, metricSlot, type MetricDef } from '../lib/metrics'
import {
  BAND_LABEL, buildInsights, CATEGORY_SLOT, computeCategories, computeReadiness, scoreLabel,
} from '../lib/wellness'
import { mean } from '../lib/analytics'
import type { Derived } from './common'

/**
 * The landing page.
 *
 * Everything important at a glance, and every tile is a link into a detail
 * page for that one measure -- the shape the Health app's Summary tab uses.
 *
 * The sparklines here are inline SVG rather than charts: sixteen of them would
 * otherwise force the chart library into the first paint, and the detail pages
 * load it lazily instead.
 */
export function Home({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const readiness = useMemo(
    () => computeReadiness(d.axis, d.sleepByDay, d.recoveries),
    [d],
  )

  const scoreInput = useMemo(() => ({
    days: d.axis,
    sleepByDay: d.sleepByDay,
    recoveries: d.recoveries,
    cycles: d.cycles,
    workouts: d.workouts,
  }), [d])

  const categories = useMemo(() => computeCategories(scoreInput), [scoreInput])
  const insights = useMemo(() => buildInsights(scoreInput).slice(0, 3), [scoreInput])

  // Only show a tile where there is something to show.
  const tiles = useMemo(() => {
    const out: Array<{ def: MetricDef; summary: Summary }> = []
    for (const key of SUMMARY_ORDER) {
      const def = METRIC_BY_KEY.get(key)
      if (!def) continue
      const summary = summarise(def, d)
      if (summary) out.push({ def, summary })
    }
    return out
  }, [d])

  if (!d.hasAny) {
    return (
      <Empty
        title="Nothing here yet"
        body="Connect Whoop on the Connections tab, and your summary will appear here."
      />
    )
  }

  const scored = categories.filter((c) => c.score !== null)
  const overall = scored.length
    ? Math.round(scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length)
    : null

  const ringColor =
    readiness.band === 'go' || readiness.band === 'ready' ? palette.good :
    readiness.band === 'pace' ? palette.warning :
    readiness.band === 'recover' ? palette.critical :
    palette.axis

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ readiness */}
      <section>
        <SectionTitle hint={readiness.day ? longDay(readiness.day) : undefined}>
          Today
        </SectionTitle>
        <Link
          to="/insights"
          className="block rounded-[var(--r-card)] transition-transform active:scale-[0.995]"
          ariaLabel={`Readiness ${readiness.score ?? 'unavailable'} out of 10. Open Insights.`}
        >
          <Card glass>
            <div className="flex items-center gap-4 sm:gap-6">
              <Ring value={readiness.score ?? 0} max={10} color={ringColor} size={104} stroke={12}>
                <span className="tnum text-[30px] leading-none font-bold text-[var(--label)]">
                  {readiness.score === null ? '--' : readiness.score.toFixed(1)}
                </span>
                <span className="t-caption-2 mt-0.5 text-[var(--label-3)]">of 10</span>
              </Ring>

              <div className="min-w-0 flex-1">
                <div className="t-caption font-semibold tracking-wide text-[var(--label-3)] uppercase">
                  Readiness
                </div>
                <h3 className="t-title-2 mt-0.5 text-[var(--label)]">
                  {readiness.band ? BAND_LABEL[readiness.band] : 'Not enough data'}
                </h3>
                <p className="t-footnote mt-1 text-[var(--label-2)]">
                  {readiness.contributions.filter((c) => c.value !== null).length} of{' '}
                  {readiness.contributions.length} signals available
                </p>
              </div>

              <Chevron />
            </div>
          </Card>
        </Link>
      </section>

      {/* --------------------------------------------------- metrics */}
      <section>
        <SectionTitle hint="Last 30 days. Tap any card for the full history.">
          Your health
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(({ def, summary }) => (
            <MetricTile
              key={def.key}
              def={def}
              summary={summary}
              color={palette.series[metricSlot(def.category)]}
            />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- longevity */}
      {scored.length > 0 && (
        <section>
          <SectionTitle>Longevity</SectionTitle>
          <Link to="/longevity" className="block rounded-[var(--r-card)]">
            <Card>
              <div className="flex items-center gap-4">
                <Ring
                  value={overall ?? 0}
                  max={100}
                  color={overall === null ? palette.axis
                    : overall >= 65 ? palette.good
                    : overall >= 50 ? palette.warning
                    : palette.critical}
                  size={72}
                  stroke={9}
                >
                  <span className="tnum text-[22px] leading-none font-bold text-[var(--label)]">
                    {overall ?? '--'}
                  </span>
                </Ring>
                <div className="min-w-0 flex-1">
                  <h3 className="t-headline text-[var(--label)]">
                    {overall === null ? 'Not enough data' : scoreLabel(overall)}
                  </h3>
                  <p className="t-footnote mt-0.5 text-[var(--label-2)]">
                    Across {scored.length} {scored.length === 1 ? 'category' : 'categories'}
                  </p>
                </div>
                <Chevron />
              </div>

              <ul className="mt-4 space-y-2.5">
                {scored.slice(0, 4).map((c) => (
                  <li key={c.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
                    <span className="t-footnote flex items-center gap-2 text-[var(--label-2)]">
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: palette.series[CATEGORY_SLOT[c.key]] }}
                      />
                      <span className="truncate">{c.label}</span>
                    </span>
                    <Meter
                      value={c.score ?? 0}
                      color={(c.score ?? 0) >= 65 ? palette.good
                        : (c.score ?? 0) >= 50 ? palette.warning
                        : palette.critical}
                      label={`${c.label} score`}
                    />
                    <span className="tnum t-footnote w-7 text-right text-[var(--label)]">
                      {c.score}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </Link>
        </section>
      )}

      {/* ------------------------------------------------ highlights */}
      {insights.length > 0 && (
        <section>
          <SectionTitle>Highlights</SectionTitle>
          <Link to="/insights" className="block rounded-[var(--r-card)]">
            <Card>
              <ul className="space-y-3.5">
                {insights.map((i) => (
                  <li key={i.headline} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-1 h-full min-h-8 w-1 shrink-0 rounded-full"
                      style={{ background: palette.series[CATEGORY_SLOT[i.category]] }}
                    />
                    <div className="min-w-0">
                      <div className="t-subhead font-semibold text-[var(--label)]">{i.headline}</div>
                      <p className="t-footnote mt-0.5 text-[var(--label-2)]">{i.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </Link>
        </section>
      )}

      {/* ---------------------------------------------------- browse */}
      <section>
        <SectionTitle>Browse</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BrowseTile to="/sleep" label="Sleep" color={palette.series[6]} />
          <BrowseTile to="/heart" label="Heart" color={palette.series[0]} />
          <BrowseTile to="/move" label="Move" color={palette.series[2]} />
          <BrowseTile to="/connections" label="Auto sync" color={palette.series[3]} />
        </div>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ tiles

interface Summary {
  latest: number
  latestDay: string
  /** Mean of the last 7 days present, and of the 21 before those. */
  recent: number | null
  prior: number | null
  spark: Array<number | null>
}

/** Reduce a metric to what a tile needs, or null if there is nothing to show. */
function summarise(def: MetricDef, d: Derived): Summary | null {
  const series = def.series(d)
  if (!series.size) return null

  const window = d.axis.slice(-30)
  const spark = window.map((day) => series.get(day) ?? null)

  let latest: number | null = null
  let latestDay = ''
  for (let i = d.axis.length - 1; i >= 0; i--) {
    const v = series.get(d.axis[i])
    if (v !== undefined) { latest = v; latestDay = d.axis[i]; break }
  }
  if (latest === null) return null

  const valuesIn = (days: string[]) =>
    days.map((day) => series.get(day)).filter((v): v is number => v !== undefined)

  return {
    latest,
    latestDay,
    recent: mean(valuesIn(d.axis.slice(-7))),
    prior: mean(valuesIn(d.axis.slice(-28, -7))),
    spark,
  }
}

function MetricTile({
  def, summary, color,
}: {
  def: MetricDef
  summary: Summary
  color: string
}) {
  const { recent, prior } = summary
  const delta = recent !== null && prior !== null ? recent - prior : null
  // "Better" only decides the wording; the arrow always points the way the
  // number actually moved.
  const improving =
    delta === null || def.better === 'neither' ? null
      : def.better === 'higher' ? delta > 0 : delta < 0

  const pct = delta !== null && prior ? (delta / Math.abs(prior)) * 100 : null

  return (
    <Link
      to={`/metric/${def.key}`}
      className="panel block rounded-[var(--r-tile)] p-3.5 transition-transform active:scale-[0.98]"
      ariaLabel={`${def.label}, ${def.format(summary.latest)}. Open details.`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="t-footnote font-semibold" style={{ color }}>{def.label}</span>
        <Chevron small />
      </div>

      <div className="mt-1 flex items-baseline gap-1">
        <span className="tnum t-title-2 text-[var(--label)]">
          {def.formatShort(summary.latest)}
        </span>
        <span className="t-caption text-[var(--label-3)]">{def.unit}</span>
      </div>

      <div className="mt-2">
        <Sparkline values={summary.spark} color={color} kind={def.chart === 'bar' ? 'bar' : 'line'} />
      </div>

      {pct !== null && Math.abs(pct) >= 1 ? (
        <div className="t-caption mt-1.5 flex items-center gap-1 text-[var(--label-2)]">
          <span className="tnum">
            {delta! > 0 ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}%
          </span>
          <span className="text-[var(--label-3)]">vs prior 3 weeks</span>
          {improving !== null && (
            <span className="sr-only">{improving ? 'improving' : 'worsening'}</span>
          )}
        </div>
      ) : (
        <div className="t-caption mt-1.5 text-[var(--label-3)]">Steady</div>
      )}
    </Link>
  )
}

function BrowseTile({ to, label, color }: { to: string; label: string; color: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-[var(--r-tile)] bg-[var(--surface-1)] px-4 py-3.5"
    >
      <span className="flex items-center gap-2.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="t-body text-[var(--label)]">{label}</span>
      </span>
      <Chevron />
    </Link>
  )
}

function Chevron({ small = false }: { small?: boolean }) {
  const s = small ? 14 : 18
  return (
    <svg
      width={s} height={s} viewBox="0 0 24 24" fill="none"
      stroke="var(--label-3)" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className="shrink-0"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}
