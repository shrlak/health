import { useMemo } from 'react'
import { Card, Empty, List, ListRow, Meter, Ring, SectionTitle, StatTile } from '../components/ui'
import { hm, longDay, num } from '../lib/format'
import { useTheme } from '../lib/theme'
import {
  BAND_BLURB, BAND_LABEL, buildInsights, CATEGORY_SLOT, computeReadiness,
} from '../lib/wellness'
import type { Derived } from './common'
import { latest, recentMean, rowsFrom } from './common'

/**
 * The Insights tab.
 *
 * Mirrors the structure reported for Apple's redesigned Health app: a daily
 * readiness score on a 0-10 scale labelled Recover / Pace Yourself / Ready /
 * Go For It, over a feed of timely observations.
 */
export function Insights({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const scoreInput = useMemo(() => ({
    days: d.axis,
    sleepByDay: d.sleepByDay,
    recoveries: d.recoveries,
    cycles: d.cycles,
    metric: d.metric,
  }), [d])

  const readiness = useMemo(() => computeReadiness(d.axis, d.sleepByDay, d.recoveries), [d])
  const insights = useMemo(() => buildInsights(scoreInput), [scoreInput])

  const rows = useMemo(() => {
    const steps = d.metric('steps')
    return rowsFrom(d.axis, {
      asleep: (day) => d.sleepByDay.get(day)?.asleep_min ?? null,
      recovery: (day) => d.recoveries.get(day)?.recovery_pct ?? null,
      strain: (day) => d.cycles.get(day)?.strain ?? null,
      steps: (day) => steps.get(day) ?? null,
      hrv: (day) => d.recoveries.get(day)?.hrv_ms ?? null,
    })
  }, [d])

  if (!d.hasAny) {
    return (
      <Empty
        title="Nothing here yet"
        body="Import an Apple Health or Whoop export from the Import tab and your insights will appear here."
      />
    )
  }

  const ringColor =
    readiness.band === 'go' || readiness.band === 'ready' ? palette.good :
    readiness.band === 'pace' ? palette.warning :
    readiness.band === 'recover' ? palette.critical :
    palette.axis

  const sleep7 = recentMean(rows, 'asleep', 7)
  const sleep28 = recentMean(rows, 'asleep', 28)
  const strain7 = recentMean(rows, 'strain', 7)
  const strain28 = recentMean(rows, 'strain', 28)
  const steps7 = recentMean(rows, 'steps', 7)
  const steps28 = recentMean(rows, 'steps', 28)
  const hrv7 = recentMean(rows, 'hrv', 7)
  const hrv28 = recentMean(rows, 'hrv', 28)
  const lastSteps = latest(rows, 'steps')

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------- readiness */}
      <section>
        <SectionTitle hint={readiness.day ? longDay(readiness.day) : undefined}>
          Readiness
        </SectionTitle>
        <Card glass>
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
            <Ring
              value={readiness.score ?? 0}
              max={10}
              color={ringColor}
              size={148}
              stroke={15}
            >
              <span className="tnum text-[40px] leading-none font-bold text-[var(--label)]">
                {readiness.score === null ? '--' : readiness.score.toFixed(1)}
              </span>
              <span className="t-caption-2 mt-1 text-[var(--label-3)]">out of 10</span>
            </Ring>

            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h3 className="t-title-2 text-[var(--label)]">
                {readiness.band ? BAND_LABEL[readiness.band] : 'Not enough data'}
              </h3>
              <p className="t-subhead mt-1.5 text-[var(--label-2)]">
                {readiness.band
                  ? BAND_BLURB[readiness.band]
                  : 'Import a Whoop export, or an Apple Health export with sleep data, to get a readiness score.'}
              </p>

              {/* What actually went into the number. A score you cannot
                  inspect is a score you cannot act on. */}
              <ul className="mt-4 space-y-2.5">
                {readiness.contributions.map((c) => (
                  <li
                    key={c.label}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[9rem_minmax(5rem,1fr)_auto]"
                  >
                    <span className="t-footnote text-left text-[var(--label-2)]">{c.label}</span>
                    <span className="order-3 sm:order-none">
                      {c.value === null
                        ? <span className="t-caption text-[var(--label-3)]">no data</span>
                        : <Meter value={c.value * 100} color={ringColor} label={c.label} />}
                    </span>
                    <span className="t-caption text-right whitespace-nowrap text-[var(--label-3)]">
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </section>

      {/* ---------------------------------------------------- today */}
      <section>
        <SectionTitle>Recent averages</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Sleep"
            value={hm(sleep7)}
            color="var(--series-7)"
            delta={sleep7 !== null && sleep28 !== null ? (sleep7 - sleep28) / 60 : null}
            deltaLabel="h vs 28-day"
            sub="7-day average"
          />
          <StatTile
            label="HRV"
            value={num(hrv7, 0)}
            unit="ms"
            color="var(--series-1)"
            delta={hrv7 !== null && hrv28 !== null ? hrv7 - hrv28 : null}
            deltaLabel="vs 28-day"
            sub="7-day average"
          />
          <StatTile
            label="Strain"
            value={num(strain7, 1)}
            color="var(--series-3)"
            delta={strain7 !== null && strain28 !== null ? strain7 - strain28 : null}
            deltaLabel="vs 28-day"
            sub="7-day average"
          />
          <StatTile
            label="Steps"
            value={num(steps7, 0)}
            color="var(--series-6)"
            delta={steps7 !== null && steps28 !== null ? (steps7 - steps28) / 1000 : null}
            deltaLabel="k vs 28-day"
            sub={lastSteps ? `${num(lastSteps.value, 0)} latest` : '7-day average'}
          />
        </div>
      </section>

      {/* ------------------------------------------------- the feed */}
      <section>
        <SectionTitle hint="Comparisons drawn from your own data over the last week against the three before it.">
          Highlights
        </SectionTitle>
        {insights.length ? (
          <List>
            {insights.map((i) => (
              <ListRow
                key={i.headline}
                leading={
                  <span
                    aria-hidden
                    className="mt-0.5 h-8 w-1.5 shrink-0 self-start rounded-full"
                    style={{ background: palette.series[CATEGORY_SLOT[i.category]] }}
                  />
                }
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="t-headline">{i.headline}</span>
                    {i.tone !== 'neutral' && (
                      <span
                        className="t-caption-2 rounded-[var(--r-pill)] px-2 py-0.5"
                        style={{
                          color: i.tone === 'good' ? 'var(--good)' : 'var(--warning)',
                          background: 'var(--fill-2)',
                        }}
                      >
                        {/* Tone carries a word, not just a colour. */}
                        {i.tone === 'good' ? 'Improving' : 'Watch'}
                      </span>
                    )}
                  </span>
                }
                subtitle={i.body}
              />
            ))}
          </List>
        ) : (
          <Card>
            <p className="t-subhead text-[var(--label-2)]">
              Nothing stands out this week. Highlights appear once there are four weeks of data to
              compare against.
            </p>
          </Card>
        )}
      </section>
    </div>
  )
}
