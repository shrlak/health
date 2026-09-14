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

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', choice)
  }, [choice])

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
