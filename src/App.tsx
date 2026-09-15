import { lazy, Suspense, useRef, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useHealthData } from './hooks/useHealthData'
import { Auth } from './components/Auth'
import { Home } from './views/Home'
import { useDerived, RANGES } from './views/common'
import { Segmented, Spinner } from './components/ui'
import { supabase, isConfigured } from './lib/supabase'
import { useTheme, type ThemeChoice } from './lib/theme'
import { daysAgoISO } from './lib/format'
import { Link, useRouter, useScrollReset } from './lib/router'
import { metricTitle } from './lib/metricTitle'

/**
 * Detail pages pull in the chart library, which is by far the largest thing in
 * the bundle. Loading them on demand keeps it off the landing page, which
 * draws its sparklines as inline SVG instead.
 */
const Insights = lazy(() => import('./views/Insights').then((m) => ({ default: m.Insights })))
const Longevity = lazy(() => import('./views/Longevity').then((m) => ({ default: m.Longevity })))
const Sleep = lazy(() => import('./views/Sleep').then((m) => ({ default: m.Sleep })))
const Recovery = lazy(() => import('./views/Recovery').then((m) => ({ default: m.Recovery })))
const Strain = lazy(() => import('./views/Strain').then((m) => ({ default: m.Strain })))
const Activity = lazy(() => import('./views/Activity').then((m) => ({ default: m.Activity })))
const MetricDetail = lazy(() =>
  import('./views/MetricDetail').then((m) => ({ default: m.MetricDetail })))
const ImportPanel = lazy(() =>
  import('./components/ImportPanel').then((m) => ({ default: m.ImportPanel })))
const Connections = lazy(() =>
  import('./views/Connections').then((m) => ({ default: m.Connections })))

interface TabDef { path: string; label: string; short: string; icon: string }

const TABS: TabDef[] = [
  { path: '/',          label: 'Summary',   short: 'Summary', icon: 'grid' },
  { path: '/insights',  label: 'Insights',  short: 'Insights', icon: 'sparkle' },
  { path: '/longevity', label: 'Longevity', short: 'Longevity', icon: 'leaf' },
  { path: '/sleep',     label: 'Sleep',     short: 'Sleep', icon: 'moon' },
  { path: '/heart',     label: 'Heart',     short: 'Heart', icon: 'heart' },
  { path: '/move',      label: 'Move',      short: 'Move', icon: 'flame' },
  { path: '/import',    label: 'Import',    short: 'Import', icon: 'arrow' },
  { path: '/connections', label: 'Connections', short: 'Sync', icon: 'link' },
]

export default function App() {
  const { session, loading: authLoading, user } = useAuth()
  const { route } = useRouter()
  const [range, setRange] = useState<string>('90')
  const mainRef = useRef<HTMLElement>(null)

  const since = range === '1825' ? null : daysAgoISO(Number(range))
  const { data, imports, loading, error, reload } = useHealthData(user?.id ?? null, since)
  const derived = useDerived(data, Number(range))

  useScrollReset(route.path, mainRef)

  if (!isConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="t-title-3">Supabase is not configured</h1>
          <p className="t-subhead mt-2 text-[var(--label-2)]">
            Copy <code className="rounded bg-[var(--fill)] px-1">.env.example</code> to{' '}
            <code className="rounded bg-[var(--fill)] px-1">.env</code>, fill in your project URL
            and publishable key, then restart the dev server.
          </p>
        </div>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading" />
      </div>
    )
  }

  if (!session) return <Auth />

  const isMetric = route.segments[0] === 'metric'
  const metricKey = isMetric ? route.segments[1] ?? '' : ''
  const tab = TABS.find((t) => t.path === route.path)
  const title = isMetric ? metricTitle(metricKey) : (tab?.label ?? 'Summary')

  return (
    <div className="min-h-screen">
      <Header
        title={title}
        email={user?.email ?? ''}
        range={range}
        onRange={setRange}
        onReload={reload}
        loading={loading}
        showBack={isMetric || !tab}
        currentPath={route.path}
      />

      <div className="mx-auto w-full max-w-5xl px-4 pb-28 sm:px-6 sm:pb-10">
        {error && (
          <p
            role="alert"
            className="t-footnote mb-4 rounded-[var(--r-tile)] bg-[var(--surface-1)] p-3 text-[var(--critical)]"
          >
            {error}
          </p>
        )}

        {loading && route.path !== '/import' ? (
          <div className="flex justify-center py-20"><Spinner label="Loading your data" /></div>
        ) : (
          <main ref={mainRef} className="outline-none">
            <Suspense
              fallback={
                <div className="flex justify-center py-20"><Spinner label="Loading" /></div>
              }
            >
              {isMetric ? <MetricDetail d={derived} metricKey={metricKey} />
                : route.path === '/' ? <Home d={derived} />
                : route.path === '/insights' ? <Insights d={derived} />
                : route.path === '/longevity' ? <Longevity d={derived} />
                : route.path === '/sleep' ? <Sleep d={derived} />
                : route.path === '/heart' ? <Recovery d={derived} />
                : route.path === '/move' ? <Move d={derived} />
                : route.path === '/connections' ? <Connections />
                : route.path === '/import' && user
                  ? <ImportPanel userId={user.id} imports={imports} onDone={reload} />
                  : <NotFound />}
            </Suspense>
          </main>
        )}
      </div>

      <TabBar currentPath={route.path} />
    </div>
  )
}

/** Move combines training load with everyday activity, the way the Health app
 *  groups Activity rather than splitting by which device recorded it. */
function Move({ d }: { d: ReturnType<typeof useDerived> }) {
  return (
    <div className="space-y-6">
      <Strain d={d} />
      <Activity d={d} />
    </div>
  )
}

function NotFound() {
  return (
    <div className="rounded-[var(--r-card)] bg-[var(--surface-1)] p-10 text-center">
      <p className="t-headline text-[var(--label)]">Page not found</p>
      <p className="t-subhead mx-auto mt-1.5 max-w-md text-[var(--label-2)]">
        That link does not match anything in this dashboard.
      </p>
      <Link to="/" className="t-body mt-4 inline-block font-medium text-[var(--tint)]">
        Back to summary
      </Link>
    </div>
  )
}

function Header({
  title, email, range, onRange, onReload, loading, showBack, currentPath,
}: {
  title: string
  email: string
  range: string
  onRange: (r: string) => void
  onReload: () => void
  loading: boolean
  showBack: boolean
  currentPath: string
}) {
  const { choice, setChoice } = useTheme()
  const { back } = useRouter()

  return (
    <header className="sticky top-0 z-20 mb-4 border-b border-[var(--separator)] bg-[var(--bg-grouped)]/85 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-5xl px-4 pt-3 pb-3 sm:px-6 sm:pt-4">
        {showBack && (
          <button
            onClick={back}
            className="t-subhead -ml-1 mb-1 flex items-center gap-0.5 font-medium text-[var(--tint)]"
          >
            <svg
              width={20} height={20} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5}
              strokeLinecap="round" strokeLinejoin="round" aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="t-large-title text-[var(--label)]">{title}</h1>
            {!showBack && <p className="t-caption truncate text-[var(--label-3)]">{email}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Date range"
              value={range}
              onChange={onRange}
              options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            />
            <Segmented
              ariaLabel="Appearance"
              value={choice}
              onChange={(c) => setChoice(c as ThemeChoice)}
              options={[
                { value: 'light' as const, label: 'Light' },
                { value: 'dark' as const, label: 'Dark' },
                { value: 'system' as const, label: 'Auto' },
              ]}
            />
            <button
              onClick={onReload}
              disabled={loading}
              className="t-footnote rounded-[var(--r-pill)] bg-[var(--fill)] px-3 py-1.5 font-medium text-[var(--tint)] disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              onClick={() => void supabase.auth.signOut()}
              className="t-footnote rounded-[var(--r-pill)] bg-[var(--fill)] px-3 py-1.5 font-medium text-[var(--label-2)]"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Wide screens get the tab row inline; phones use the glass tab bar. */}
        <nav aria-label="Sections" className="mt-3 hidden flex-wrap gap-1 sm:flex">
          {TABS.map((t) => (
            <Link
              key={t.path}
              to={t.path}
              className={
                't-footnote rounded-[var(--r-pill)] px-3.5 py-1.5 font-medium transition-colors ' +
                (currentPath === t.path
                  ? 'bg-[var(--tint)] text-white'
                  : 'text-[var(--label-2)] hover:bg-[var(--fill-2)]')
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}

/** iOS-style glass tab bar, floating clear of the home indicator. */
function TabBar({ currentPath }: { currentPath: string }) {
  // Six targets is already tight at 390px, so Longevity and Connections live
  // in the summary page's Browse row on phones rather than crowding this.
  const phoneTabs = TABS.filter((t) => t.path !== '/longevity' && t.path !== '/connections')

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="glass mx-3 mb-3 rounded-[26px] px-1 py-1">
        <ul className="flex">
          {phoneTabs.map((t) => {
            const active = currentPath === t.path
            return (
              <li key={t.path} className="flex-1">
                <Link
                  to={t.path}
                  className={
                    'flex w-full flex-col items-center gap-0.5 rounded-[20px] py-1.5 transition-colors ' +
                    (active ? 'text-[var(--tint)]' : 'text-[var(--label-3)]')
                  }
                >
                  <TabIcon name={t.icon} active={active} />
                  <span className="t-caption-2 font-medium">{t.short}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}

function TabIcon({ name, active }: { name: string; active: boolean }) {
  const common = {
    width: 22, height: 22, viewBox: '0 0 24 24',
    fill: active ? 'currentColor' : 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 0 : 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></svg>
    case 'sparkle':
      return <svg {...common}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></svg>
    case 'leaf':
      return <svg {...common}><path d="M4 20c0-8 5-14 16-14 0 9-5 14-11 14a5 5 0 01-5-5z" /><path d="M4 20c3-4 7-7 12-9" stroke="currentColor" strokeWidth="1.7" fill="none" /></svg>
    case 'moon':
      return <svg {...common}><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" /></svg>
    case 'heart':
      return <svg {...common}><path d="M12 20s-7-4.5-7-9.5A4 4 0 0112 8a4 4 0 017 2.5c0 5-7 9.5-7 9.5z" /></svg>
    case 'flame':
      return <svg {...common}><path d="M12 3s5 4.5 5 9a5 5 0 01-10 0c0-1.6.7-3 1.5-4 .3 1.2 1 2 1.8 2 0-2.5.9-5 1.7-7z" /></svg>
    case 'link':
      return <svg {...common} fill="none" strokeWidth={1.8}><path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1" /></svg>
    default:
      return <svg {...common}><path d="M12 4v11" /><path d="M8 11l4 4 4-4" /><path d="M5 20h14" /></svg>
  }
}
