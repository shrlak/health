/// <reference lib="webworker" />
import { parseAppleHealthZip } from '../parsers/appleHealth'
import { parseWhoopExport } from '../parsers/whoop'
import type { ParsedPayload, ParseProgress } from '../lib/types'

export type WorkerRequest =
  | { kind: 'apple'; file: File }
  | { kind: 'whoop'; file: File }

export type WorkerResponse =
  | { type: 'progress'; progress: ParseProgress }
  | { type: 'done'; payload: ParsedPayload }
  | { type: 'error'; message: string }

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg)

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  const onProgress = (progress: ParseProgress) => post({ type: 'progress', progress })

  try {
    const payload = req.kind === 'apple'
      ? await parseAppleHealthZip(req.file, onProgress)
      : await parseWhoopExport(req.file, req.file.name, onProgress)
    post({ type: 'done', payload })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
