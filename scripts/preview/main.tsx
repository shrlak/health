/**
 * Local render harness. Mounts every view against synthetic data so the
 * layout, palette and dark mode can be checked without a Supabase session.
 * Not part of the app bundle -- built only by `npm run preview:harness`.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, useTheme } from '../../src/lib/theme'
import { RouterProvider, useRouter } from '../../src/lib/router'
import { Home } from '../../src/views/Home'
import { Insights } from '../../src/views/Insights'
import { Longevity } from '../../src/views/Longevity'
import { Sleep } from '../../src/views/Sleep'
import { Recovery } from '../../src/views/Recovery'
import { Strain } from '../../src/views/Strain'
import { MetricDetail } from '../../src/views/MetricDetail'
import { useDerived } from '../../src/views/common'
import type { HealthData } from '../../src/lib/analytics'
import type { Cycle, DailyMetric, Recovery as Rec, SleepSession, Workout } from '../../src/lib/types'
import '../../src/index.css'

/** Deterministic pseudo-random so screenshots are stable between runs. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function build(days: number): HealthData {
  const r = rng(42)
  const dailyMetrics: DailyMetric[] = []
  const sleep: SleepSession[] = []
  const recovery: Rec[] = []
  const cycles: Cycle[] = []
  const workouts: Workout[] = []

  const today = new Date()
  for (let i = days; i >= 0; i--) {
    const dt = new Date(today)
    dt.setDate(dt.getDate() - i)
    const day = dt.toISOString().slice(0, 10)

    // Every fifth day is an overnight shift, so the shift comparison has data.
    const nightShift = i % 5 === 0

    const asleep = Math.round((nightShift ? 320 : 430) + r() * 90)
    const rem = Math.round(asleep * (0.18 + r() * 0.06))
    const deep = Math.round(asleep * (0.14 + r() * 0.05))
    const light = asleep - rem - deep
    const awake = Math.round(15 + r() * 30)
    const inBed = asleep + awake

    const startHour = nightShift ? 9 : 23
    const start = new Date(dt)
    start.setHours(startHour, Math.round(r() * 50), 0, 0)
    if (!nightShift) start.setDate(start.getDate() - 1)
    const end = new Date(start.getTime() + inBed * 60000)

    sleep.push({
      source: 'whoop_csv', external_id: `s-${day}`, day,
      started_at: start.toISOString(), ended_at: end.toISOString(), is_nap: false,
      duration_min: inBed, asleep_min: asleep, rem_min: rem, deep_min: deep,
      light_min: light, awake_min: awake, latency_min: Math.round(5 + r() * 20),
      efficiency_pct: Math.round((asleep / inBed) * 1000) / 10,
      disturbances: Math.round(r() * 8),
      respiratory_rate: Math.round((14 + r() * 2) * 10) / 10,
      performance_pct: Math.round(60 + r() * 38),
      need_min: 500, debt_min: Math.round(r() * 200),
    })

    recovery.push({
      day, source: 'whoop_csv',
      recovery_pct: Math.round((nightShift ? 32 : 58) + r() * 35),
      hrv_ms: Math.round((nightShift ? 62 : 86) + r() * 30),
      resting_hr: Math.round((nightShift ? 58 : 51) + r() * 6),
      spo2_pct: Math.round((95 + r() * 3) * 10) / 10,
      skin_temp_c: Math.round((33 + r() * 1.5) * 10) / 10,
      respiratory_rate: Math.round((14 + r() * 2) * 10) / 10,
    })

    cycles.push({
      day, source: 'whoop_csv',
      strain: Math.round((7 + r() * 11) * 10) / 10,
      avg_hr: Math.round(70 + r() * 20),
      max_hr: Math.round(150 + r() * 35),
      kilojoules: Math.round((2000 + r() * 1400) * 4.184),
    })


    if (r() > 0.45) {
      const dur = Math.round(25 + r() * 70)
      const wStart = new Date(dt)
      wStart.setHours(17, 0, 0, 0)
      const names = ['Running', 'Weightlifting', 'Cycling', 'Swimming', 'Functional Strength Training']
      workouts.push({
        source: 'whoop_csv', external_id: `w-${day}`, day,
        started_at: wStart.toISOString(),
        ended_at: new Date(wStart.getTime() + dur * 60000).toISOString(),
        activity: names[Math.floor(r() * names.length)],
        duration_min: dur,
        energy_kcal: Math.round(dur * (6 + r() * 5)),
        distance_km: Math.round(r() * 10 * 100) / 100,
        avg_hr: Math.round(120 + r() * 30),
        max_hr: Math.round(160 + r() * 25),
        strain: Math.round((6 + r() * 9) * 10) / 10,
        zone_1_min: Math.round(dur * 0.2), zone_2_min: Math.round(dur * 0.3),
        zone_3_min: Math.round(dur * 0.25), zone_4_min: Math.round(dur * 0.17),
        zone_5_min: Math.round(dur * 0.08),
      })
    }
  }

  return { dailyMetrics, sleep, recovery, cycles, workouts }
}

const DATA = build(120)

const SHORTCUTS = [
  ['home', '/'],
  ['insights', '/insights'],
  ['longevity', '/longevity'],
  ['sleep', '/sleep'],
  ['recovery', '/heart'],
  ['strain', '/move'],
] as const

/** Mirrors the real app's routing so navigation can be exercised end to end,
 *  without needing a Supabase session. */
function Harness() {
  const { choice, setChoice } = useTheme()
  const { route, navigate } = useRouter()
  const d = useDerived(DATA, 120)

  const isMetric = route.segments[0] === 'metric'
  const metricKey = isMetric ? route.segments[1] ?? '' : ''

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-4 py-4 sm:px-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {SHORTCUTS.map(([name, path]) => (
          <button
            key={name}
            data-view={name}
            onClick={() => navigate(path)}
            className={
              't-footnote rounded-[var(--r-pill)] px-3.5 py-1.5 font-medium capitalize ' +
              (route.path === path
                ? 'bg-[var(--tint)] text-white'
                : 'bg-[var(--fill)] text-[var(--label-2)]')
            }
          >
            {name}
          </button>
        ))}
        <button
          data-toggle-theme
          onClick={() => setChoice(choice === 'dark' ? 'light' : 'dark')}
          className="t-footnote ml-auto rounded-[var(--r-pill)] bg-[var(--fill)] px-3.5 py-1.5 font-medium text-[var(--label-2)]"
        >
          {choice === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      {isMetric ? <MetricDetail d={d} metricKey={metricKey} />
        : route.path === '/' ? <Home d={d} />
        : route.path === '/insights' ? <Insights d={d} />
        : route.path === '/longevity' ? <Longevity d={d} />
        : route.path === '/sleep' ? <Sleep d={d} />
        : route.path === '/heart' ? <Recovery d={d} />
        : route.path === '/move' ? <Strain d={d} />
        : <p className="t-body">No route.</p>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider>
        <Harness />
      </RouterProvider>
    </ThemeProvider>
  </StrictMode>,
)
