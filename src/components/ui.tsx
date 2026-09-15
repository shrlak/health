import type { ReactNode } from 'react'

/** A panel: the app's basic container, drawn as a lit surface with a gradient
 *  edge rather than a flat rectangle. `glass` is the translucent variant, for
 *  the one or two places that sit over something. */
export function Card({
  children, className = '', glass = false,
}: {
  children: ReactNode
  className?: string
  glass?: boolean
}) {
  return (
    <div
      className={
        (glass ? 'glass ' : 'panel ') +
        'rounded-[var(--r-card)] p-4 sm:p-5 ' + className
      }
    >
      {children}
    </div>
  )
}

/** Section heading: a title over the group, not inside it, with a short rule
 *  running out from it so the page reads as a stack of instruments. */
export function SectionTitle({
  children, hint, action,
}: {
  children: ReactNode
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h2 className="t-title-3 text-[var(--label)]">{children}</h2>
          <span
            aria-hidden
            className="h-px min-w-6 flex-1 bg-gradient-to-r from-[var(--separator)] to-transparent"
          />
        </div>
        {hint && <p className="t-footnote mt-0.5 text-[var(--label-2)]">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * A ring gauge, the Health app's signature reading. The value is always
 * printed in the middle, so the ring is reinforcement rather than the only
 * way to read the number.
 */
export function Ring({
  value, max, color, size = 140, stroke = 14, children, trackColor,
}: {
  value: number
  max: number
  color: string
  size?: number
  stroke?: number
  children?: ReactNode
  trackColor?: string
}) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value / max))

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={trackColor ?? 'var(--fill)'}
          strokeWidth={stroke}
        />
        {/* A blurred copy under the arc, so the ring reads as lit rather than
            printed. The sharp arc above it carries the actual value. */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * pct} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity={0.55}
          style={{ filter: 'blur(7px)' }}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * pct} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  )
}

/** A horizontal score meter for the Longevity categories. */
export function Meter({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill)]"
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }}
      />
    </div>
  )
}

/**
 * A metric tile. One number with its comparison -- the form heuristic says a
 * single value is a stat tile, not a chart.
 */
export function StatTile({
  label, value, unit, delta, deltaLabel, color, sub,
}: {
  label: string
  value: string
  unit?: string
  delta?: number | null
  deltaLabel?: string
  /** Category colour for the label, matching the Health app's coloured headings. */
  color?: string
  sub?: string
}) {
  const showDelta = delta !== null && delta !== undefined && Number.isFinite(delta)
  const up = showDelta && delta! > 0
  const flat = showDelta && Math.abs(delta!) < 0.05

  return (
    <div className="panel rounded-[var(--r-tile)] p-3.5">
      {/* The category colour is a mark beside the label rather than the label
          itself: at this size a coloured 13px word is the first thing to fail
          a contrast check, and the dot carries the same information. */}
      <div className="flex items-center gap-1.5">
        {color && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: color, boxShadow: `0 0 8px ${color}` }}
          />
        )}
        <div className="t-eyebrow text-[var(--label-2)]">{label}</div>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum t-title-1 text-[var(--label)]">{value}</span>
        {unit && <span className="t-subhead text-[var(--label-2)]">{unit}</span>}
      </div>
      {showDelta && (
        <div className="t-caption mt-0.5 flex items-center gap-1 text-[var(--label-2)]">
          {/* Direction rides on the glyph and sign, never on colour alone. */}
          <span className="tnum">
            {flat ? '→' : up ? '↑' : '↓'} {Math.abs(delta!).toFixed(1)}
          </span>
          {deltaLabel && <span className="text-[var(--label-3)]">{deltaLabel}</span>}
        </div>
      )}
      {sub && <div className="t-caption mt-0.5 text-[var(--label-3)]">{sub}</div>}
    </div>
  )
}

/** An inset grouped list, as used throughout Settings and Health. */
export function List({ children }: { children: ReactNode }) {
  return (
    <div className="panel overflow-hidden rounded-[var(--r-card)]">
      {children}
    </div>
  )
}

export function ListRow({
  leading, title, subtitle, trailing, onClick,
}: {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
}) {
  const inner = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="t-body text-[var(--label)]">{title}</div>
        {subtitle && <div className="t-footnote mt-0.5 text-[var(--label-2)]">{subtitle}</div>}
      </div>
      {trailing}
    </>
  )

  const cls =
    'flex w-full items-center gap-3 px-4 py-3 text-left ' +
    'border-b border-[var(--separator)] last:border-b-0'

  return onClick
    ? <button type="button" onClick={onClick} className={cls + ' active:bg-[var(--fill-2)]'}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel rounded-[var(--r-card)] p-10 text-center">
      <p className="t-headline text-[var(--label)]">{title}</p>
      <p className="t-subhead mx-auto mt-1.5 max-w-md text-[var(--label-2)]">{body}</p>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="t-subhead flex items-center gap-2 text-[var(--label-2)]">
      <span
        aria-hidden
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--fill)] border-t-[var(--tint)]"
      />
      {label}
    </div>
  )
}

/** iOS segmented control. */
export function Segmented<T extends string>({
  options, value, onChange, ariaLabel, size = 'md',
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  ariaLabel: string
  size?: 'sm' | 'md'
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-[10px] bg-[var(--fill-2)] p-[2px]"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={
              'rounded-[8px] font-medium transition-colors ' +
              (size === 'sm' ? 't-caption px-2.5 py-1 ' : 't-footnote px-3 py-1.5 ') +
              (active
                ? 'bg-[var(--surface-1)] text-[var(--label)] shadow-[0_0_0_1px_var(--separator),0_0_14px_var(--glow)]'
                : 'text-[var(--label-2)]')
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
