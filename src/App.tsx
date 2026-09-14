import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useHealthData } from './hooks/useHealthData'
import { Auth } from './components/Auth'
import { ImportPanel } from './components/ImportPanel'
import { Insights } from './views/Insights'
import { Longevity } from './views/Longevity'
import { Sleep } from './views/Sleep'
import { Recovery } from './views/Recovery'
import { Strain } from './views/Strain'
import { Activity } from './views/Activity'
import { useDerived, RANGES } from './views/common'
import { Segmented, Spinner } from './components/ui'
import { supabase, isConfigured } from './lib/supabase'
import { useTheme, type ThemeChoice } from './lib/theme'
import { daysAgoISO } from './lib/format'

type Tab = 'insights' | 'longevity' | 'sleep' | 'heart' | 'move' | 'import'

/** Tabs follow the Health app's own categories rather than the shape of the
 *  underlying exports, so Recovery sits under Heart and training sits under
 *  Move alongside everyday activity. */
const TABS: Array<{ id: Tab; label: string; short: string; icon: string }> = [
  { id: 'insights',  label: 'Insights',  short: 'Insights',  icon: 'sparkle' },
  { id: 'longevity', label: 'Longevity', short: 'Longevity', icon: 'leaf' },
  { id: 'sleep',     label: 'Sleep',     short: 'Sleep',     icon: 'moon' },
  { id: 'heart',     label: 'Heart',     short: 'Heart',     icon: 'heart' },
  { id: 'move',      label: 'Move',      short: 'Move',      icon: 'flame' },
  { id: 'import',    label: 'Import',    short: 'Import',    icon: 'arrow' },
]

export default function App() {
  const { session, loading: authLoading, user } = useAuth()
  const [tab, setTab] = useState<Tab>('insights')
  const [range, setRange] = useState<string>('90')

  const since = range === '1825' ? null : daysAgoISO(Number(range))
  const { data, imports, loading, error, reload } = useHealthData(user?.id ?? null, since)
  const derived = useDerived(data, Number(range))

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

  const active = TABS.find((t) => t.id === tab)

  return (
    <div className="min-h-screen">
      <Header
        title={active?.label ?? ''}
        email={user?.email ?? ''}
        range={range}
        onRange={setRange}
        onReload={reload}
        loading={loading}
        tab={tab}
        onTab={setTab}
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

        {loading && tab !== 'import' ? (
          <div className="flex justify-center py-20"><Spinner label="Loading your data" /></div>
        ) : (
          <main>
            {tab === 'insights' && <Insights d={derived} />}
            {tab === 'longevity' && <Longevity d={derived} />}
            {tab === 'sleep' && <Sleep d={derived} />}
            {tab === 'heart' && <Recovery d={derived} />}
            {tab === 'move' && <Move d={derived} />}
            {tab === 'import' && user && (
              <ImportPanel userId={user.id} imports={imports} onDone={reload} />
            )}
          </main>
        )}
      </div>

      <TabBar tab={tab} onTab={setTab} />
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

function Header({
  title, email, range, onRange, onReload, loading, tab, onTab,
}: {
  title: string
  email: string
  range: string
  onRange: (r: string) => void
  onReload: () => void
  loading: boolean
  tab: Tab
  onTab: (t: Tab) => void
}) {
  const { choice, setChoice } = useTheme()

  return (
    <header className="sticky top-0 z-20 mb-4 border-b border-[var(--separator)] bg-[var(--bg-grouped)]/85 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="t-large-title text-[var(--label)]">{title}</h1>
            <p className="t-caption truncate text-[var(--label-3)]">{email}</p>
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
        <nav aria-label="Sections" className="mt-3 hidden gap-1 sm:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={
                't-footnote rounded-[var(--r-pill)] px-3.5 py-1.5 font-medium transition-colors ' +
                (tab === t.id
                  ? 'bg-[var(--tint)] text-white'
                  : 'text-[var(--label-2)] hover:bg-[var(--fill-2)]')
              }
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}

/** iOS-style glass tab bar, floating clear of the home indicator. */
function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="glass mx-3 mb-3 rounded-[26px] px-1 py-1">
        <ul className="flex">
          {TABS.map((t) => (
            <li key={t.id} className="flex-1">
              <button
                onClick={() => onTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={
                  'flex w-full flex-col items-center gap-0.5 rounded-[20px] py-1.5 transition-colors ' +
                  (tab === t.id ? 'text-[var(--tint)]' : 'text-[var(--label-3)]')
                }
              >
                <TabIcon name={t.icon} active={tab === t.id} />
                <span className="t-caption-2 font-medium">{t.short}</span>
              </button>
            </li>
          ))}
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
    default:
      return <svg {...common}><path d="M12 4v11" /><path d="M8 11l4 4 4-4" /><path d="M5 20h14" /></svg>
  }
}
