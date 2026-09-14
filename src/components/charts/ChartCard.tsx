import { useState, type ReactNode } from 'react'
import { Segmented } from '../ui'
import { shortDay } from '../../lib/format'

export interface SeriesDef {
  key: string
  label: string
  color: string
  /** Rendered in the tooltip and the table. */
  format: (v: number) => string
}

export interface ChartRow {
  day: string
  [key: string]: number | string | null
}

/**
 * Frame shared by every chart: title, legend, and a chart/table toggle.
 *
 * The table view is not decorative. It is the screen-reader path to the
 * numbers and the documented relief for any palette slot that runs close to
 * the contrast floor, so every chart carries one.
 */
export function ChartCard({
  title, hint, series, rows, children, right, accent,
}: {
  title: string
  hint?: string
  series: SeriesDef[]
  rows: ChartRow[]
  children: ReactNode
  right?: ReactNode
  /** Category colour for the title rule, matching the Health app. */
  accent?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  return (
    <section className="rounded-[var(--r-card)] bg-[var(--surface-1)] p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {accent && (
            <span
              aria-hidden
              className="mt-1 h-4 w-1 shrink-0 rounded-full"
              style={{ background: accent }}
            />
          )}
          <div className="min-w-0">
            <h3 className="t-headline text-[var(--label)]">{title}</h3>
            {hint && <p className="t-footnote mt-0.5 text-[var(--label-2)]">{hint}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          <Segmented
            size="sm"
            ariaLabel={`${title} view`}
            value={view}
            onChange={setView}
            options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]}
          />
        </div>
      </header>

      {/* A legend is always present for two or more series, so identity is
          never carried by colour alone. */}
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((s) => (
            <li key={s.key} className="t-caption flex items-center gap-1.5 text-[var(--label-2)]">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {view === 'chart' ? children : <DataTable series={series} rows={rows} />}
    </section>
  )
}

function DataTable({ series, rows }: { series: SeriesDef[]; rows: ChartRow[] }) {
  const withData = rows.filter((r) => series.some((s) => typeof r[s.key] === 'number'))
  const recent = withData.slice(-60).reverse()

  if (!recent.length) {
    return (
      <p className="t-footnote py-8 text-center text-[var(--label-3)]">
        No values in this range.
      </p>
    )
  }

  return (
    <div className="max-h-80 overflow-auto rounded-[var(--r-tile)] bg-[var(--surface-2)]">
      <table className="t-caption w-full text-left">
        <thead className="sticky top-0 bg-[var(--surface-2)]">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold text-[var(--label-2)]">Day</th>
            {series.map((s) => (
              <th key={s.key} scope="col" className="px-3 py-2 text-right font-semibold text-[var(--label-2)]">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.day} className="border-t border-[var(--separator)]">
              <th scope="row" className="px-3 py-1.5 font-normal text-[var(--label-2)]">
                {/^\d{4}-\d{2}-\d{2}$/.test(r.day) ? shortDay(r.day) : r.day}
              </th>
              {series.map((s) => {
                const v = r[s.key]
                return (
                  <td key={s.key} className="tnum px-3 py-1.5 text-right text-[var(--label)]">
                    {typeof v === 'number' ? s.format(v) : '--'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
