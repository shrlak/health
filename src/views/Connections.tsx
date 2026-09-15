import { useCallback, useEffect, useState } from 'react'
import { Card, SectionTitle, Spinner } from '../components/ui'
import { supabase } from '../lib/supabase'
import { callFunction, INGEST_URL } from '../lib/functions'
import { useRouter } from '../lib/router'
import { longDay } from '../lib/format'

/**
 * Automatic data collection.
 *
 * The two sources are not symmetrical and the page says so rather than
 * implying otherwise: Whoop has a real API that this can pull from on a
 * schedule, while Apple exposes no cloud API at all, so an app on the phone has
 * to push instead.
 */

interface WhoopState {
  connected: boolean
  connected_at: string | null
  last_sync_at: string | null
  last_sync_status: string | null
  last_error: string | null
  rows_last_sync: number
}

interface TokenRow {
  id: string
  token_hint: string
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export function Connections() {
  const { route, navigate } = useRouter()
  const [whoop, setWhoop] = useState<WhoopState | null>(null)
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [freshToken, setFreshToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: w }, { data: t }] = await Promise.all([
        supabase.from('whoop_tokens')
          .select('connected_at, last_sync_at, last_sync_status, last_error, rows_last_sync')
          .maybeSingle(),
        supabase.from('ingest_tokens')
          .select('id, token_hint, label, created_at, last_used_at, revoked_at')
          .is('revoked_at', null)
          .order('created_at', { ascending: false }),
      ])
      setWhoop(w ? { connected: true, ...w } as WhoopState : {
        connected: false, connected_at: null, last_sync_at: null,
        last_sync_status: null, last_error: null, rows_last_sync: 0,
      })
      setTokens((t ?? []) as TokenRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // The Whoop callback redirects back here with its outcome in the query.
  const outcome = route.query.get('whoop')
  const reason = route.query.get('reason')
  useEffect(() => {
    if (!outcome) return

    if (outcome === 'connected') setNotice('Whoop connected. Your first sync can take a minute.')
    else if (outcome === 'denied') setError('Whoop authorization was declined.')
    else setError(`Whoop connection failed: ${reason ?? 'unknown error'}`)

    // Drop the parameters so a refresh does not repeat the message.
    navigate('/connections', { replace: true })
    void load()
  }, [outcome, reason, navigate, load])

  const connectWhoop = async () => {
    setBusy('connect'); setError(null)
    try {
      const { url } = await callFunction<{ url: string }>('whoop-connect', {
        body: { redirectTo: window.location.href },
      })
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const syncNow = async () => {
    setBusy('sync'); setError(null); setNotice(null)
    try {
      const r = await callFunction<{ synced: number; failed: number; errors?: string[] }>('whoop-sync')
      if (r.failed) setError(r.errors?.[0] ?? 'Sync failed.')
      else setNotice(`Synced ${r.synced.toLocaleString()} rows from Whoop.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const disconnectWhoop = async () => {
    if (!confirm('Disconnect Whoop? Data already synced stays; no new data will arrive.')) return
    setBusy('disconnect'); setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await supabase.from('whoop_tokens').delete().eq('user_id', user.id)
      setNotice('Whoop disconnected.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const mintToken = async () => {
    setBusy('token'); setError(null)
    try {
      const r = await callFunction<{ token: string }>('ingest-token', { body: { label: 'iPhone' } })
      setFreshToken(r.token)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const revokeToken = async (id: string) => {
    if (!confirm('Revoke this token? The iPhone using it will stop uploading.')) return
    setBusy(id)
    try {
      await callFunction('ingest-token', { method: 'DELETE', query: { id } })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner label="Loading connections" /></div>
  }

  return (
    <div className="space-y-6">
      {notice && (
        <p className="t-subhead rounded-[var(--r-tile)] bg-[var(--surface-1)] p-3.5 text-[var(--good)]">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="t-subhead rounded-[var(--r-tile)] bg-[var(--surface-1)] p-3.5 text-[var(--critical)]">
          {error}
        </p>
      )}

      {/* ---------------------------------------------------------- Whoop */}
      <section>
        <SectionTitle hint="Whoop has a developer API, so this pulls new data on its own every six hours.">
          Whoop
        </SectionTitle>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <StatusDot ok={whoop?.connected === true} error={whoop?.last_sync_status === 'error'} />
              <div>
                <div className="t-headline text-[var(--label)]">
                  {whoop?.connected ? 'Connected' : 'Not connected'}
                </div>
                <div className="t-footnote text-[var(--label-2)]">
                  {whoop?.connected
                    ? whoop.last_sync_at
                      ? `Last synced ${new Date(whoop.last_sync_at).toLocaleString()}` +
                        (whoop.rows_last_sync ? ` · ${whoop.rows_last_sync.toLocaleString()} rows` : '')
                      : 'Waiting for the first sync'
                    : 'Authorize once and recovery, sleep, strain and workouts arrive automatically.'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {whoop?.connected ? (
                <>
                  <button
                    onClick={syncNow}
                    disabled={busy !== null}
                    className="t-footnote rounded-[var(--r-pill)] bg-[var(--tint)] px-3.5 py-2 font-medium text-white disabled:opacity-50"
                  >
                    {busy === 'sync' ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button
                    onClick={disconnectWhoop}
                    disabled={busy !== null}
                    className="t-footnote rounded-[var(--r-pill)] bg-[var(--fill)] px-3.5 py-2 font-medium text-[var(--critical)] disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={connectWhoop}
                  disabled={busy !== null}
                  className="t-footnote rounded-[var(--r-pill)] bg-[var(--tint)] px-3.5 py-2 font-medium text-white disabled:opacity-50"
                >
                  {busy === 'connect' ? 'Opening Whoop…' : 'Connect Whoop'}
                </button>
              )}
            </div>
          </div>

          {whoop?.last_error && (
            <p className="t-footnote mt-3 rounded-[var(--r-tile)] bg-[var(--surface-2)] p-3 text-[var(--critical)]">
              Last sync error: {whoop.last_error}
            </p>
          )}
        </Card>
      </section>

      {/* --------------------------------------------------- Apple Health */}
      <section>
        <SectionTitle hint="Apple exposes no cloud API for Health data, so nothing can pull it. An app on your iPhone pushes it here instead.">
          Apple Health
        </SectionTitle>

        <Card>
          <h3 className="t-headline text-[var(--label)]">Push endpoint</h3>
          <p className="t-footnote mt-1 text-[var(--label-2)]">
            Create a token, then point an app on your iPhone at this URL. Anything that can POST
            JSON on a schedule works; Health Auto Export is the usual choice.
          </p>

          <Field label="URL" value={INGEST_URL} />

          {freshToken ? (
            <div className="mt-3">
              <Field label="Token" value={freshToken} mono />
              <p className="t-caption mt-1.5 text-[var(--warning)]">
                Copy this now. It is stored only as a hash, so it cannot be shown again.
              </p>
            </div>
          ) : (
            <button
              onClick={mintToken}
              disabled={busy !== null}
              className="t-footnote mt-3 rounded-[var(--r-pill)] bg-[var(--tint)] px-3.5 py-2 font-medium text-white disabled:opacity-50"
            >
              {busy === 'token' ? 'Creating…' : 'Create a token'}
            </button>
          )}

          {tokens.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--separator)]">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="t-subhead text-[var(--label)]">{t.label ?? 'Token'}</span>
                  <code className="t-caption rounded bg-[var(--fill)] px-1.5 py-0.5 text-[var(--label-2)]">
                    {t.token_hint}…
                  </code>
                  <span className="t-caption text-[var(--label-3)]">
                    {t.last_used_at
                      ? `Last used ${new Date(t.last_used_at).toLocaleString()}`
                      : `Created ${longDay(t.created_at.slice(0, 10))} · never used`}
                  </span>
                  <button
                    onClick={() => revokeToken(t.id)}
                    disabled={busy !== null}
                    className="t-caption ml-auto font-medium text-[var(--critical)] disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="mt-3">
          <Card>
            <h3 className="t-headline text-[var(--label)]">Setting up Health Auto Export</h3>
            <ol className="t-subhead mt-2 list-decimal space-y-1.5 pl-5 text-[var(--label-2)]">
              <li>Install <strong>Health Auto Export</strong> from the App Store and give it Health access.</li>
              <li>Go to <strong>Automations</strong> and add one, with type <strong>REST API</strong>.</li>
              <li>Set the URL to the endpoint above and the method to <strong>POST</strong>.</li>
              <li>
                Add a header named <code className="rounded bg-[var(--fill)] px-1">Authorization</code> with
                value <code className="rounded bg-[var(--fill)] px-1">Bearer YOUR_TOKEN</code>.
              </li>
              <li>Set format to <strong>JSON</strong> and aggregation to <strong>Daily</strong>.</li>
              <li>Choose the metrics you want, set the schedule, and turn the automation on.</li>
            </ol>
            <p className="t-footnote mt-3 text-[var(--label-3)]">
              Re-sending a day is safe: rows are keyed by day and source, so a repeated export
              updates what is there rather than duplicating it. The response names any metric it
              did not recognise, so a misconfigured export is visible rather than silent.
            </p>
          </Card>
        </div>

        <div className="mt-3">
          <Card>
            <h3 className="t-headline text-[var(--label)]">The honest limitation</h3>
            <p className="t-subhead mt-1.5 text-[var(--label-2)]">
              HealthKit data lives on your iPhone and Apple provides no server to read it from, so
              there is nothing for this dashboard to poll. Every "Apple Health integration" works
              the way this one does — something on the device sends the data out. The alternatives
              are a scheduled export app as above, an iOS Shortcut posting to the same endpoint, or
              continuing to upload the zip by hand on the Import tab.
            </p>
          </Card>
        </div>
      </section>
    </div>
  )
}

function StatusDot({ ok, error }: { ok: boolean; error?: boolean }) {
  const color = error ? 'var(--critical)' : ok ? 'var(--good)' : 'var(--label-3)'
  return (
    <span className="relative flex h-3 w-3 shrink-0">
      <span className="h-3 w-3 rounded-full" style={{ background: color }} aria-hidden />
    </span>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be refused; the value is selectable either way.
    }
  }

  return (
    <div className="mt-3">
      <div className="t-caption mb-1 font-semibold text-[var(--label-3)]">{label}</div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={
            't-footnote min-w-0 flex-1 rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-[var(--label)] ' +
            (mono ? 'font-mono' : '')
          }
        />
        <button
          onClick={copy}
          className="t-footnote shrink-0 rounded-[var(--r-pill)] bg-[var(--fill)] px-3 py-2 font-medium text-[var(--tint)]"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
