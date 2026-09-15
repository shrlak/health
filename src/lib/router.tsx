import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'

/**
 * A small hash router.
 *
 * Hash routing rather than history routing because this deploys to GitHub
 * Pages, which serves static files with no SPA rewrite: `/health/sleep` would
 * 404 on refresh or on a shared link, while `#/sleep` always resolves to
 * index.html and is handled here.
 *
 * Small enough not to warrant a dependency, and it keeps the landing page's
 * bundle down, which is the whole point of splitting the detail pages out.
 */

export interface Route {
  /** Path without the leading "#" or any query, always starting with "/". */
  path: string
  /** Path split into non-empty segments. */
  segments: string[]
  /** Parsed query string, for OAuth callbacks that return state in the hash. */
  query: URLSearchParams
}

interface Ctx {
  route: Route
  navigate: (to: string, opts?: { replace?: boolean }) => void
  back: () => void
  /** True once the user has navigated within the app, so a Back control knows
   *  whether returning would leave the site. */
  canGoBack: boolean
}

const RouterContext = createContext<Ctx | null>(null)

function read(): Route {
  const raw = window.location.hash.replace(/^#/, '')
  const withSlash = raw.startsWith('/') ? raw : '/' + raw
  // Split the query off, so a callback like "#/connections?whoop=connected"
  // still matches the /connections route.
  const q = withSlash.indexOf('?')
  const path = q === -1 ? withSlash : withSlash.slice(0, q)
  const query = new URLSearchParams(q === -1 ? '' : withSlash.slice(q + 1))
  return { path, segments: path.split('/').filter(Boolean), query }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => {
    // Normalise a bare URL to "#/" so the first entry is a real route.
    if (!window.location.hash) window.history.replaceState(null, '', '#/')
    return read()
  })
  const depth = useRef(0)

  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const target = to.startsWith('/') ? to : '/' + to
    const current = window.location.hash.replace(/^#/, '')
    if (target === (current.startsWith('/') ? current : '/' + current)) return
    if (opts?.replace) {
      window.history.replaceState(null, '', '#' + target)
      setRoute(read())
    } else {
      depth.current += 1
      window.location.hash = target
    }
  }, [])

  const back = useCallback(() => {
    if (depth.current > 0) { depth.current -= 1; window.history.back() }
    else navigate('/', { replace: true })
  }, [navigate])

  const value = useMemo<Ctx>(
    () => ({ route, navigate, back, canGoBack: depth.current > 0 }),
    [route, navigate, back],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): Ctx {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider')
  return ctx
}

/**
 * An anchor that navigates in-app. It stays a real <a href> so the link can be
 * opened in a new tab, copied, or read by assistive technology as a link --
 * things a div with onClick cannot do.
 */
export function Link({
  to, children, className, ariaLabel, onNavigate,
}: {
  to: string
  children: ReactNode
  className?: string
  ariaLabel?: string
  onNavigate?: () => void
}) {
  const { navigate } = useRouter()
  return (
    <a
      href={'#' + (to.startsWith('/') ? to : '/' + to)}
      aria-label={ariaLabel}
      className={className}
      onClick={(e) => {
        // Let the browser handle modified clicks (new tab, new window).
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
        onNavigate?.()
      }}
    >
      {children}
    </a>
  )
}

/** Send focus and scroll to the top of the page on every route change, so a
 *  new page starts at its beginning for keyboard and screen-reader users
 *  rather than keeping the previous page's scroll position. */
export function useScrollReset(path: string, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    window.scrollTo(0, 0)
    const el = ref.current
    if (el) {
      el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
      el.removeAttribute('tabindex')
    }
  }, [path, ref])
}
