import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { PALETTE, type Palette } from './palette'
import type { Resolved, ThemeChoice } from './themeTypes'

export type { Palette } from './palette'
export type { Resolved, ThemeChoice } from './themeTypes'

interface Ctx {
  choice: ThemeChoice
  resolved: Resolved
  palette: Palette
  setChoice: (c: ThemeChoice) => void
}

const ThemeContext = createContext<Ctx | null>(null)

/** Also read by the boot script in index.html, which stamps the theme before
 *  first paint. Change it in both places or the first frame flashes. */
const STORAGE_KEY = 'health-dashboard-theme'

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Private browsing can throw on access; the default is fine.
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored)
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: Resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice

  // Always stamp the *resolved* theme, never the choice: "system" is resolved
  // here rather than a second time in CSS, so the stylesheet carries one copy
  // of the dark palette instead of two that have to be kept in step. The boot
  // script in index.html writes the same attribute before first paint.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', resolved)

    // Keep the browser chrome on the same ground as the page. Reading the
    // token back rather than repeating the hex keeps this honest if the
    // palette moves, and means picking Light on a dark phone no longer
    // leaves a black status bar over a pale app.
    const meta = document.querySelector('meta[name="theme-color"]')
    const bg = getComputedStyle(root).getPropertyValue('--bg-grouped').trim()
    if (meta && bg) meta.setAttribute('content', bg)
  }, [resolved])

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c)
    try { localStorage.setItem(STORAGE_KEY, c) } catch { /* non-fatal */ }
  }, [])

  const value = useMemo<Ctx>(
    () => ({ choice, resolved, palette: PALETTE[resolved], setChoice }),
    [choice, resolved, setChoice],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
