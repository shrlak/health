import type { Resolved } from './themeTypes'

export interface Palette {
  /** The card surface charts are drawn on, which the validator measures against. */
  surface: string
  grid: string
  axis: string
  text: string
  /** The eight categorical slots, in the fixed order the palette validates in.
   *  Assigned by index and never cycled. */
  series: string[]
  good: string
  warning: string
  serious: string
  critical: string
  /** Sleep stages, deepest first. Ordinal, not categorical. */
  sleepStages: string[]
  /** Heart-rate zones 1 to 5. Ordinal, not categorical. */
  hrZones: string[]
}

/**
 * Sleep stages and heart-rate zones are *ordered*, so they take single-hue
 * ramps rather than categorical slots -- which is both the correct encoding
 * and the only one available: of the 70 four-colour subsets of the categorical
 * palette, none clears the all-pairs separation floors in both modes, and a
 * stacked bar puts every segment against every other.
 *
 * Light mode runs low->light, high->dark. Dark mode inverts, so the strongest
 * value is the brightest against the dark surface. Both directions validate
 * with `--ordinal`: monotone lightness, adjacent dL >= 0.06, single hue, and a
 * near-surface end still clearing 2:1.
 */

/**
 * Apple Health's category hues, stepped to pass the data-viz gates.
 *
 * Slot order follows the Health app's own categories -- heart, hearing, move,
 * respiratory, mental wellbeing, nutrition, sleep, metabolic -- so a series
 * keeps the colour a reader already associates with that part of the app.
 *
 * Raw iOS system colours fail on their own: they sit outside the lightness
 * band and most land under 3:1 on a white surface. Each hue was therefore
 * snapped to a step inside the band (light L 0.54, dark L 0.62) and the whole
 * set re-validated. Both modes now pass all five checks with no contrast
 * relief required:
 *
 *   light (on #FFFFFF): worst adjacent CVD dE 12.0, normal-vision dE 21.6
 *   dark  (on #1C1C1E): worst adjacent CVD dE 14.8, normal-vision dE 23.1
 *
 * Re-run `scripts/validate_palette.js` from the data-viz skill before changing
 * any value here -- the ordering is the colour-blind-safety mechanism, not a
 * cosmetic choice.
 */
export const CATEGORY_HUES = [
  'heart', 'hearing', 'move', 'respiratory', 'mental', 'nutrition', 'sleep', 'metabolic',
] as const

export const PALETTE: Record<Resolved, Palette> = {
  light: {
    surface: '#ffffff',
    grid: '#e5e5ea',
    axis: '#8e8e93',
    text: '#000000',
    series: ['#cd0441', '#006bd4', '#9b5f04', '#00889e', '#a104da', '#04862f', '#5945ff', '#836d00'],
    good: '#1f8b3a',
    warning: '#c2540a',
    serious: '#b4560f',
    critical: '#c5182b',
    sleepStages: ['#3b01c6', '#5124fe', '#6866ff', '#8992fe'],
    hrZones: ['#ed9409', '#c77c0c', '#a36403', '#804e05', '#5f3800'],
  },
  dark: {
    surface: '#1c1c1e',
    grid: '#3a3a3c',
    axis: '#98989f',
    text: '#ffffff',
    series: ['#f70550', '#0282fe', '#bb7304', '#0797ab', '#bf26ff', '#05a23b', '#6f70fe', '#9e8402'],
    good: '#30d158',
    warning: '#ffd60a',
    serious: '#ff9f0a',
    critical: '#ff453a',
    sleepStages: ['#9ba5fe', '#7c81ff', '#6157ff', '#4e00fc'],
    hrZones: ['#7d4b00', '#9b5f08', '#bb7309', '#dc890a', '#fe9e0a'],
  },
}

/** Slot index for a named Health category, so views name a colour by meaning
 *  rather than by number. */
export const slot = (name: (typeof CATEGORY_HUES)[number]): number =>
  CATEGORY_HUES.indexOf(name)
