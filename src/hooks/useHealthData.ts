import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emptyHealthData, type HealthData } from '../lib/analytics'
import type { ImportRecord } from '../lib/types'

/** PostgREST caps a response at 1000 rows by default; a few years of daily
 *  metrics is well past that, so every table is read through range paging. */
async function fetchAll<T>(table: string, columns: string, since: string | null): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns).order('day', { ascending: true })
    if (since) q = q.gte('day', since)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export function useHealthData(userId: string | null, since: string | null) {
  const [data, setData] = useState<HealthData>(emptyHealthData)
  const [imports, setImports] = useState<ImportRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!userId) { setData(emptyHealthData()); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const [dailyMetrics, sleep, recovery, cycles, workouts, imps] = await Promise.all([
        fetchAll<HealthData['dailyMetrics'][number]>('daily_metrics', 'day,metric,source,value,unit', since),
        fetchAll<HealthData['sleep'][number]>('sleep_sessions', '*', since),
        fetchAll<HealthData['recovery'][number]>('recovery', '*', since),
        fetchAll<HealthData['cycles'][number]>('cycles', '*', since),
        fetchAll<HealthData['workouts'][number]>('workouts', '*', since),
        supabase.from('imports').select('*').order('created_at', { ascending: false }).limit(20),
      ])
      setData({ dailyMetrics, sleep, recovery, cycles, workouts })
      setImports((imps.data ?? []) as ImportRecord[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [userId, since])

  useEffect(() => { void reload() }, [reload])

  return { data, imports, loading, error, reload }
}
