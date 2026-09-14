import { useMemo } from 'react'
import { Card, Empty, Meter, Ring, SectionTitle } from '../components/ui'
import { useTheme } from '../lib/theme'
import { CATEGORY_SLOT, computeCategories, scoreLabel, type CategoryScore } from '../lib/wellness'
import type { Derived } from './common'

/**
 * The Longevity tab.
 *
 * Reported to show "how well you're doing" across heart health, sleep, mental
 * wellbeing, movement health, metabolic health, hearing and nutrition. Each
 * category here is scored from the inputs actually present in your data, and
 * every card lists which ones those were -- a score whose basis is hidden is
 * not worth acting on.
 */
export function Longevity({ d }: { d: Derived }) {
  const { palette } = useTheme()

  const categories = useMemo(() => computeCategories({
    days: d.axis,
    sleepByDay: d.sleepByDay,
    recoveries: d.recoveries,
    cycles: d.cycles,
    metric: d.metric,
  }), [d])

  const scored = categories.filter((c) => c.score !== null)
  const unscored = categories.filter((c) => c.score === null)

  const overall = scored.length
    ? Math.round(scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length)
    : null

  if (!d.hasAny) {
    return (
      <Empty
        title="Nothing to score yet"
        body="Import an Apple Health or Whoop export and each category will be scored from the data it contains."
      />
    )
  }

  const toneFor = (score: number) =>
    score >= 65 ? palette.good : score >= 50 ? palette.warning : palette.critical

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle hint="Each score blends measured values against healthy reference ranges and your own baseline. They are a way to see change over time, not a medical assessment.">
          Overall
        </SectionTitle>
        <Card glass>
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-7">
            <Ring
              value={overall ?? 0}
              max={100}
              color={overall === null ? palette.axis : toneFor(overall)}
              size={132}
              stroke={14}
            >
              <span className="tnum text-[36px] leading-none font-bold text-[var(--label)]">
                {overall ?? '--'}
              </span>
              <span className="t-caption-2 mt-1 text-[var(--label-3)]">out of 100</span>
            </Ring>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h3 className="t-title-2 text-[var(--label)]">
                {overall === null ? 'Not enough data' : scoreLabel(overall)}
              </h3>
              <p className="t-subhead mt-1.5 text-[var(--label-2)]">
                {scored.length
                  ? `Averaged across the ${scored.length} ${scored.length === 1 ? 'category' : 'categories'} your data can support.`
                  : 'No category has enough data to score yet.'}
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Categories</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {scored.map((c) => (
            <CategoryCard
              key={c.key}
              c={c}
              dot={palette.series[CATEGORY_SLOT[c.key]]}
              meter={toneFor(c.score ?? 0)}
            />
          ))}
        </div>
      </section>

      {unscored.length > 0 && (
        <section>
          <SectionTitle hint="These need data your exports do not contain yet.">
            Not scored
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {unscored.map((c) => (
              <Card key={c.key}>
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full opacity-40"
                    style={{ background: palette.series[CATEGORY_SLOT[c.key]] }}
                  />
                  <h3 className="t-headline text-[var(--label-2)]">{c.label}</h3>
                </div>
                <p className="t-footnote mt-1.5 text-[var(--label-3)]">{c.summary}</p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function CategoryCard({
  c, dot, meter,
}: {
  c: CategoryScore
  /** Category identity, sitting immediately beside its own name. */
  dot: string
  /** Score band. With seven categories on screen at once no eight-hue set can
   *  clear the all-pairs separation floors, so the bar -- the part that
   *  actually gets compared across cards -- encodes the score instead. */
  meter: string
}) {
  const score = c.score ?? 0

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
          <h3 className="t-headline text-[var(--label)]">{c.label}</h3>
        </div>
        <div className="text-right">
          <div className="tnum t-title-3 text-[var(--label)]">{score}</div>
          {/* The band is spelled out, so the reading never depends on colour. */}
          <div className="t-caption-2 text-[var(--label-3)]">{scoreLabel(score)}</div>
        </div>
      </div>

      <div className="mt-3">
        <Meter value={score} color={meter} label={`${c.label} score`} />
      </div>

      <p className="t-footnote mt-3 text-[var(--label-2)]">{c.summary}</p>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {c.inputs.map((i) => (
          <li key={i} className="t-caption text-[var(--label-3)]">{i}</li>
        ))}
      </ul>
    </Card>
  )
}
