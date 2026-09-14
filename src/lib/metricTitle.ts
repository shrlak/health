import { METRIC_BY_KEY } from './metrics'

/** Page title for a metric route. Kept apart from the detail view so the app
 *  shell can title the page without eagerly importing that view, which would
 *  defeat the code splitting. */
export function metricTitle(key: string): string {
  const def = METRIC_BY_KEY.get(key)
  return def ? (def.longLabel ?? def.label) : 'Metric'
}
