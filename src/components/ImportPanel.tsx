import { useRef, useState } from 'react'
import { parseInWorker, uploadPayload } from '../lib/ingest'
import type { ImportRecord, ParseProgress, Source } from '../lib/types'
import { longDay } from '../lib/format'
import { Card, SectionTitle, Spinner } from './ui'

interface Job {
  kind: 'apple' | 'whoop'
  progress: ParseProgress
}

export function ImportPanel({
  userId, imports, onDone,
}: {
  userId: string
  imports: ImportRecord[]
  onDone: () => void
}) {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const appleRef = useRef<HTMLInputElement>(null)
  const whoopRef = useRef<HTMLInputElement>(null)

  const run = async (kind: 'apple' | 'whoop', file: File) => {
    setError(null)
    setResult(null)
    setJob({ kind, progress: { phase: 'Starting', ratio: null } })
    try {
      const payload = await parseInWorker(kind, file, (progress) => setJob({ kind, progress }))
      const source: Source = kind === 'apple' ? 'apple_health' : 'whoop_csv'
      const rows = await uploadPayload(payload, source, file.name, userId, (progress) =>
        setJob({ kind, progress }),
      )
      setResult(`Imported ${rows.toLocaleString()} rows from ${file.name}.`)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setJob(null)
      if (appleRef.current) appleRef.current.value = ''
      if (whoopRef.current) whoopRef.current.value = ''
    }
  }

  const busy = job !== null

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint="Files are parsed in your browser. Only daily summaries are uploaded, never the raw sample stream.">
          Import data
        </SectionTitle>

        <div className="grid gap-3 sm:grid-cols-2">
          <ImportTile
            title="Apple Health"
            steps={[
              'Open Health on your iPhone',
              'Tap your photo, top right',
              'Scroll down, tap Export All Health Data',
              'Save the zip, then choose it here',
            ]}
            accept=".zip"
            inputRef={appleRef}
            disabled={busy}
            onPick={(f) => run('apple', f)}
          />
          <ImportTile
            title="Whoop"
            steps={[
              'Open Whoop, go to Settings',
              'Tap Data Export, then Download my data',
              'Whoop emails you a zip of CSVs',
              'Choose the zip (or a single CSV) here',
            ]}
            accept=".zip,.csv"
            inputRef={whoopRef}
            disabled={busy}
            onPick={(f) => run('whoop', f)}
          />
        </div>

        {job && (
          <div className="mt-4 rounded-[var(--r-tile)] bg-[var(--surface-2)] p-3.5">
            <Spinner label={job.progress.phase} />
            {job.progress.detail && (
              <p className="t-footnote mt-1 text-[var(--label-2)]">{job.progress.detail}</p>
            )}
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--fill)]">
              <div
                className="h-full rounded-full bg-[var(--tint)] transition-[width] duration-200"
                style={{ width: job.progress.ratio === null ? '35%' : `${Math.round(job.progress.ratio * 100)}%` }}
              />
            </div>
            <p className="t-caption mt-2 text-[var(--label-3)]">
              A large Apple Health export can take a few minutes. Keep this tab open.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="t-footnote mt-3 rounded-[var(--r-tile)] bg-[var(--surface-2)] p-3 text-[var(--critical)]">
            {error}
          </p>
        )}
        {result && (
          <p className="t-footnote mt-3 rounded-[var(--r-tile)] bg-[var(--surface-2)] p-3 text-[var(--good)]">{result}</p>
        )}
      </Card>

      {imports.length > 0 && (
        <Card>
          <SectionTitle>Recent imports</SectionTitle>
          <ul className="divide-y divide-[var(--separator)]">
            {imports.map((i) => (
              <li key={i.id} className="t-footnote flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="font-semibold text-[var(--label)]">
                  {i.source === 'apple_health' ? 'Apple Health' : 'Whoop'}
                </span>
                <span className="text-[var(--label-2)]">{i.filename}</span>
                <span
                  className={
                    'ml-auto rounded-[var(--r-pill)] px-2 py-0.5 ' +
                    (i.status === 'complete'
                      ? 'text-[var(--good)]'
                      : i.status === 'error'
                        ? 'text-[var(--critical)]'
                        : 'text-[var(--label-3)]')
                  }
                >
                  {i.status === 'complete'
                    ? `${i.rows_imported.toLocaleString()} rows`
                    : i.status === 'error' ? 'Failed' : 'Running'}
                </span>
                {i.range_start && i.range_end && (
                  <span className="w-full text-[var(--label-3)]">
                    {longDay(i.range_start)} to {longDay(i.range_end)}
                  </span>
                )}
                {i.error && <span className="w-full text-[var(--critical)]">{i.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function ImportTile({
  title, steps, accept, inputRef, disabled, onPick,
}: {
  title: string
  steps: string[]
  accept: string
  inputRef: React.RefObject<HTMLInputElement | null>
  disabled: boolean
  onPick: (f: File) => void
}) {
  return (
    <div className="rounded-[var(--r-tile)] bg-[var(--surface-2)] p-4">
      <h4 className="t-headline text-[var(--label)]">{title}</h4>
      <ol className="t-footnote mt-2 list-inside list-decimal space-y-0.5 text-[var(--label-2)]">
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="t-subhead mt-3.5 w-full rounded-[12px] bg-[var(--fill)] px-3 py-2.5 font-medium text-[var(--tint)] disabled:opacity-50"
      >
        Choose file
      </button>
    </div>
  )
}
