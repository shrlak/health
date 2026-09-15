import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { useTheme } from '../../lib/theme'
import { longDay, shortDay } from '../../lib/format'
import type { ChartRow, SeriesDef } from './ChartCard'

const AXIS_FONT = 11

/** Right gutter reserved for reference-line labels, so a guide never prints
 *  on top of the data it is meant to annotate. */
const GUIDE_GUTTER = 62

function useAxisProps() {
  const { palette } = useTheme()
  return {
    tick: { fill: palette.axis, fontSize: AXIS_FONT },
    axisLine: { stroke: palette.grid },
    tickLine: false,
  } as const
}

/** Shared tooltip. Values wear text tokens; the series colour appears only as
 *  the swatch beside each row. */
function Panel({
  label, items,
}: {
  label: string
  items: Array<{ key: string; label: string; color: string; text: string }>
}) {
  return (
    <div className="glass rounded-[12px] px-3 py-2 ring-1 ring-[var(--separator)]">
      <div className="t-caption mb-1 font-semibold text-[var(--label-2)]">{label}</div>
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.key} className="t-caption flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: i.color }} />
            <span className="text-[var(--label-3)]">{i.label}</span>
            <span className="tnum ml-auto font-medium text-[var(--label)]">{i.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function makeTooltip(series: SeriesDef[]) {
  return function ChartTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload?.length) return null
    const items = payload
      .filter((p) => typeof p.value === 'number')
      .map((p) => {
        const def = series.find((s) => s.key === p.dataKey)
        return {
          key: String(p.dataKey),
          label: def?.label ?? String(p.name ?? ''),
          color: def?.color ?? (p.color as string),
          text: def ? def.format(p.value as number) : String(p.value),
        }
      })
    if (!items.length) return null
    const raw = String(label)
    return <Panel label={/^\d{4}-\d{2}-\d{2}$/.test(raw) ? longDay(raw) : raw} items={items} />
  }
}

interface BaseProps {
  rows: ChartRow[]
  series: SeriesDef[]
  height?: number
  yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax']
  yTickFormatter?: (v: number) => string
  /** Horizontal guides, e.g. a sleep-need line or the recovery bands. */
  guides?: Array<{ value: number; label: string; color?: string; dashed?: boolean }>
  /** Set for a categorical x-axis (weekday names, activity labels), whose
   *  values are not dates and must not go through the date formatter. */
  categorical?: boolean
}

/** Line chart for change over time. Two-pixel strokes, recessive grid, no
 *  marker on every point -- dots appear on hover via the active shape. */
export function TrendChart({
  rows, series, height = 220, yDomain, yTickFormatter, guides, categorical,
}: BaseProps) {
  const { palette } = useTheme()
  const axis = useAxisProps()
  const Tip = makeTooltip(series)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: GUIDE_GUTTER, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={palette.grid} strokeDasharray="0" vertical={false} />
        <XAxis dataKey="day" tickFormatter={categorical ? undefined : shortDay} minTickGap={categorical ? 0 : 28} interval={categorical ? 0 : undefined} {...axis} />
        <YAxis domain={yDomain ?? ['auto', 'auto']} tickFormatter={yTickFormatter} width={48} {...axis} />
        <Tooltip content={Tip} cursor={{ stroke: palette.axis, strokeWidth: 1 }} />
        {guides?.map((g) => (
          <ReferenceLine
            key={g.label}
            y={g.value}
            stroke={g.color ?? palette.axis}
            strokeDasharray={g.dashed === false ? undefined : '4 4'}
            strokeWidth={1}
            label={{ value: g.label, position: 'right', fill: palette.axis, fontSize: 10 }}
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Area chart for a single magnitude over time. */
export function AreaTrend({ rows, series, height = 200, yTickFormatter, categorical }: BaseProps) {
  const { palette } = useTheme()
  const axis = useAxisProps()
  const Tip = makeTooltip(series)
  const s = series[0]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: GUIDE_GUTTER, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={palette.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={categorical ? undefined : shortDay} minTickGap={categorical ? 0 : 28} interval={categorical ? 0 : undefined} {...axis} />
        <YAxis tickFormatter={yTickFormatter} width={48} {...axis} />
        <Tooltip content={Tip} cursor={{ stroke: palette.axis, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey={s.key}
          stroke={s.color}
          strokeWidth={2}
          fill={`url(#fill-${s.key})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/**
 * Stacked bars for composition over time (sleep stages, heart-rate zones).
 * Each segment carries a one-pixel stroke in the surface colour, which reads
 * as the required two-pixel gap between adjacent fills.
 */
export function StackedBars({ rows, series, height = 240, yTickFormatter, categorical }: BaseProps) {
  const { palette } = useTheme()
  const axis = useAxisProps()
  const Tip = makeTooltip(series)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: GUIDE_GUTTER, bottom: 0, left: -12 }} barCategoryGap="18%">
        <CartesianGrid stroke={palette.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={categorical ? undefined : shortDay} minTickGap={categorical ? 0 : 28} interval={categorical ? 0 : undefined} {...axis} />
        <YAxis tickFormatter={yTickFormatter} width={48} {...axis} />
        <Tooltip content={Tip} cursor={{ fill: palette.grid, fillOpacity: 0.5 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="a"
            fill={s.color}
            stroke={palette.surface}
            strokeWidth={1}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Single-measure bars, optionally coloured per bar by a status band. */
export function SimpleBars({
  rows, series, height = 200, yTickFormatter, colorFor, guides, categorical,
}: BaseProps & { colorFor?: (row: ChartRow) => string }) {
  const { palette } = useTheme()
  const axis = useAxisProps()
  const Tip = makeTooltip(series)
  const s = series[0]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: GUIDE_GUTTER, bottom: 0, left: -12 }} barCategoryGap="16%">
        <CartesianGrid stroke={palette.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={categorical ? undefined : shortDay} minTickGap={categorical ? 0 : 28} interval={categorical ? 0 : undefined} {...axis} />
        <YAxis tickFormatter={yTickFormatter} width={48} {...axis} />
        <Tooltip content={Tip} cursor={{ fill: palette.grid, fillOpacity: 0.5 }} />
        {guides?.map((g) => (
          <ReferenceLine
            key={g.label}
            y={g.value}
            stroke={g.color ?? palette.axis}
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{ value: g.label, position: 'right', fill: palette.axis, fontSize: 10 }}
          />
        ))}
        <Bar dataKey={s.key} radius={[4, 4, 0, 0]} isAnimationActive={false} fill={s.color}>
          {colorFor && rows.map((r) => <Cell key={r.day} fill={colorFor(r)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Horizontal bars for ranked categories (workout types, weekday means). */
export function RankedBars({
  rows, series, height = 240, labelKey = 'label', formatValue,
}: {
  rows: Array<Record<string, number | string | null>>
  series: SeriesDef[]
  height?: number
  labelKey?: string
  formatValue: (v: number) => string
}) {
  const { palette } = useTheme()
  const axis = useAxisProps()
  const s = series[0]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={palette.grid} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey={labelKey}
          width={96}
          {...axis}
          tick={{ fill: palette.axis, fontSize: AXIS_FONT }}
        />
        <Tooltip
          cursor={{ fill: palette.grid, fillOpacity: 0.5 }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length) return null
            const p = payload[0]
            if (typeof p.value !== 'number') return null
            const row = p.payload as Record<string, unknown>
            return (
              <Panel
                label={String(row?.[labelKey] ?? '')}
                items={[{
                  key: s.key, label: s.label, color: s.color,
                  text: formatValue(p.value),
                }]}
              />
            )
          }}
        />
        <Bar dataKey={s.key} fill={s.color} radius={[0, 4, 4, 0]} isAnimationActive={false} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Scatter for the relationship between two measures. */
export function Relationship({
  points, xLabel, yLabel, xFormat, yFormat, color, height = 240,
}: {
  points: Array<{ x: number; y: number; day: string }>
  xLabel: string
  yLabel: string
  xFormat: (v: number) => string
  yFormat: (v: number) => string
  color: string
  height?: number
}) {
  const { palette } = useTheme()
  const axis = useAxisProps()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: -8 }}>
        <CartesianGrid stroke={palette.grid} />
        <XAxis
          type="number" dataKey="x" name={xLabel} domain={['dataMin', 'dataMax']}
          tickFormatter={xFormat} {...axis}
          label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: palette.axis, fontSize: 10 }}
        />
        <YAxis
          type="number" dataKey="y" name={yLabel} domain={['dataMin', 'dataMax']}
          tickFormatter={yFormat} width={48} {...axis}
        />
        <ZAxis range={[36, 36]} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: palette.axis }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as { x: number; y: number; day: string }
            return (
              <Panel
                label={longDay(p.day)}
                items={[
                  { key: 'x', label: xLabel, color, text: xFormat(p.x) },
                  { key: 'y', label: yLabel, color, text: yFormat(p.y) },
                ]}
              />
            )
          }}
        />
        <Scatter
          data={points}
          fill={color}
          fillOpacity={0.65}
          stroke={palette.surface}
          strokeWidth={1}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
