import { supabase } from './supabase'
import type { ParsedPayload, ParseProgress, Source } from './types'
import type { WorkerRequest, WorkerResponse } from '../workers/parse.worker'

/** Postgres caps parameters per statement, and mobile Safari is unhappy with
 *  very large request bodies, so writes go up in batches. */
const BATCH = 500

function rowsIn(p: ParsedPayload): number {
  return p.dailyMetrics.length + p.sleep.length + p.recovery.length +
    p.cycles.length + p.workouts.length
}

function dayRange(p: ParsedPayload): { start: string | null; end: string | null } {
  let start: string | null = null
  let end: string | null = null
  const visit = (day: string) => {
    if (start === null || day < start) start = day
    if (end === null || day > end) end = day
  }
  p.dailyMetrics.forEach((d) => visit(d.day))
  p.sleep.forEach((d) => visit(d.day))
  p.recovery.forEach((d) => visit(d.day))
  p.cycles.forEach((d) => visit(d.day))
  p.workouts.forEach((d) => visit(d.day))
  return { start, end }
}

/** Run the file through the parser worker. Parsing a multi-gigabyte Apple
 *  Health export on the main thread would freeze the tab for minutes. */
export function parseInWorker(
  kind: 'apple' | 'whoop',
  file: File,
  onProgress: (p: ParseProgress) => void,
): Promise<ParsedPayload> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') onProgress(msg.progress)
      else if (msg.type === 'done') { worker.terminate(); resolve(msg.payload) }
      else { worker.terminate(); reject(new Error(msg.message)) }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'The import worker crashed.'))
    }

    const req: WorkerRequest = { kind, file } as WorkerRequest
    worker.postMessage(req)
  })
}

async function upsertAll<T extends object>(
  table: string,
  rows: T[],
  conflict: string,
  userId: string,
  onProgress: (done: number, total: number) => void,
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => ({ ...r, user_id: userId }))
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflict })
    if (error) throw new Error(`Saving ${table} failed: ${error.message}`)
    onProgress(Math.min(i + BATCH, rows.length), rows.length)
  }
}

export async function uploadPayload(
  payload: ParsedPayload,
  source: Source,
  filename: string,
  userId: string,
  onProgress: (p: ParseProgress) => void,
): Promise<number> {
  const total = rowsIn(payload)
  const range = dayRange(payload)

  const { data: imp, error: impErr } = await supabase
    .from('imports')
    .insert({
      user_id: userId,
      source,
      filename,
      status: 'running',
      range_start: range.start,
      range_end: range.end,
    })
    .select('id')
    .single()
  if (impErr) throw new Error(`Could not start the import: ${impErr.message}`)

  let written = 0
  const tick = (label: string) => (done: number) => {
    onProgress({
      phase: `Saving ${label}`,
      ratio: total ? Math.min(1, (written + done) / total) : null,
      detail: `${(written + done).toLocaleString()} of ${total.toLocaleString()} rows`,
    })
  }

  try {
    await upsertAll('daily_metrics', payload.dailyMetrics, 'user_id,day,metric,source', userId, tick('daily metrics'))
    written += payload.dailyMetrics.length
    await upsertAll('sleep_sessions', payload.sleep, 'user_id,source,external_id', userId, tick('sleep'))
    written += payload.sleep.length
    await upsertAll('recovery', payload.recovery, 'user_id,day,source', userId, tick('recovery'))
    written += payload.recovery.length
    await upsertAll('cycles', payload.cycles, 'user_id,day,source', userId, tick('strain'))
    written += payload.cycles.length
    await upsertAll('workouts', payload.workouts, 'user_id,source,external_id', userId, tick('workouts'))
    written += payload.workouts.length

    await supabase.from('imports').update({
      status: 'complete',
      rows_imported: total,
      completed_at: new Date().toISOString(),
    }).eq('id', imp.id)

    return total
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase.from('imports').update({
      status: 'error',
      error: message,
      rows_imported: written,
      completed_at: new Date().toISOString(),
    }).eq('id', imp.id)
    throw err
  }
}
