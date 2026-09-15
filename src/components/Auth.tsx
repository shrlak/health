import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function Auth() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) {
          setMessage('Check your email for a confirmation link, then sign in.')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const field =
    'mt-1.5 w-full rounded-[12px] bg-[var(--surface-2)] px-3.5 py-2.5 t-body ' +
    'text-[var(--label)] outline-none focus:ring-2 focus:ring-[var(--tint)]'

  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div
            aria-hidden
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[20px]"
            style={{ background: 'var(--series-1)' }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="white" aria-hidden>
              <path d="M12 20s-7-4.5-7-9.5A4 4 0 0112 8a4 4 0 017 2.5c0 5-7 9.5-7 9.5z" />
            </svg>
          </div>
          <h1 className="t-title-1 text-[var(--label)]">Health</h1>
          <p className="t-subhead mt-1 text-[var(--label-2)]">
            Your Whoop data, in one place.
          </p>
        </div>

        <form onSubmit={submit} className="panel rounded-[var(--r-card)] p-5">
          <label className="t-footnote block font-medium text-[var(--label-2)]" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />

          <label
            className="t-footnote mt-4 block font-medium text-[var(--label-2)]"
            htmlFor="password"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />

          <button
            type="submit"
            disabled={busy}
            className="t-headline mt-5 w-full rounded-[12px] bg-[var(--tint)] px-3 py-2.5 text-[var(--on-tint)] disabled:opacity-50"
          >
            {busy ? 'Working...' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>

          {error && (
            <p role="alert" className="t-footnote mt-3 text-[var(--critical)]">{error}</p>
          )}
          {message && (
            <p className="t-footnote mt-3 text-[var(--label-2)]">{message}</p>
          )}

          <button
            type="button"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null) }}
            className="t-footnote mt-4 w-full text-center font-medium text-[var(--tint)]"
          >
            {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        </form>

        <p className="t-caption mt-5 text-center text-[var(--label-3)]">
          Data is stored in your own Supabase project and is readable only by your account.
        </p>
      </div>
    </div>
  )
}
