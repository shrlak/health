/**
 * Inline-SVG sparklines for the summary grid.
 *
 * Hand-drawn rather than charted: the landing page shows sixteen of these, and
 * pulling the chart library in for them would cost roughly 700KB before the
 * page could paint. The detail pages load that library lazily instead.
 *
 * These carry no axes, labels or interaction by design -- a sparkline shows
 * shape, and the number beside it carries the value. They are marked
 * aria-hidden for that reason; the accessible value lives in the card text.
 */

interface Props {
  /** Values oldest-first. Nulls are gaps and break the line. */
  values: Array<number | null>
  color: string
  width?: number
  height?: number
  /** Draw as filled bars rather than a line. */
  kind?: 'line' | 'bar'
}

export function Sparkline({ values, color, width = 120, height = 34, kind = 'line' }: Props) {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (real.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden className="overflow-visible">
        <line
          x1={0} y1={height / 2} x2={width} y2={height / 2}
          stroke="var(--fill)" strokeWidth={2} strokeLinecap="round"
        />
      </svg>
    )
  }

  let min = Math.min(...real)
  let max = Math.max(...real)
  // A flat series would otherwise divide by zero and collapse to the baseline.
  if (max === min) { max = min + 1; min = min - 1 }

  const pad = 3
  const usable = height - pad * 2
  const x = (i: number) => (values.length === 1 ? 0 : (i / (values.length - 1)) * width)
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * usable

  if (kind === 'bar') {
    // Bars sit on the baseline, so the scale starts at zero where the data is
    // non-negative -- otherwise short bars would exaggerate small differences.
    const base = min < 0 ? min : 0
    const span = max - base || 1
    const slot = width / values.length
    const barW = Math.max(1.5, slot * 0.62)
    return (
      <svg width={width} height={height} aria-hidden className="overflow-visible">
        {values.map((v, i) => {
          if (v === null || !Number.isFinite(v)) return null
          const h = Math.max(1.5, ((v - base) / span) * usable)
          return (
            <rect
              key={i}
              x={i * slot + (slot - barW) / 2}
              y={height - pad - h}
              width={barW}
              height={h}
              rx={Math.min(1.5, barW / 2)}
              fill={color}
            />
          )
        })}
      </svg>
    )
  }

  // Break the path wherever data is missing, so a gap reads as a gap rather
  // than as a straight line through days that were never measured.
  const segments: string[] = []
  let current: string[] = []
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${current.length ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))

  const lastIndex = values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1)
  const lastValue = lastIndex >= 0 ? values[lastIndex] : null

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      {segments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {lastValue !== null && (
        <circle
          cx={x(lastIndex)}
          cy={y(lastValue)}
          r={2.75}
          fill={color}
          stroke="var(--surface-1)"
          strokeWidth={1.5}
        />
      )}
    </svg>
  )
}
