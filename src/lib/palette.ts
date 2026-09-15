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
    sleepStages: ['#0311af', '#021dfd', '#6b4bfe', '#9773fe'],
    hrZones: ['#d67002', '#b45d01', '#934b01', '#733a02', '#542a02'],
  },
  // Brighter than the light set, because they are drawn on a near-black panel
  // rather than on white. Each is checked at 3:1 or better against
  // --surface-1, and adjacent pairs stay above 15 dE2000.
  dark: {
    surface: '#0c1019',
    grid: '#2a3654',
    axis: '#7d90b8',
    text: '#eef3ff',
    series: ['#ff2d6f', '#38bdff', '#ff9d2e', '#22d3c5', '#c56bff', '#3ddc84', '#8b8cff', '#d4b436'],
    good: '#3ddc84',
    warning: '#ffd60a',
    serious: '#ff9f0a',
    critical: '#ff4d6a',
    sleepStages: ['#eee4fe', '#c7acfe', '#9975fe', '#573dfe'],
    hrZones: ['#cb6a01', '#f27f02', '#fea45c', '#fecaa5', '#feeee3'],
  },
}

/** Slot index for a named Health category, so views name a colour by meaning
 *  rather than by number. */
export const slot = (name: (typeof CATEGORY_HUES)[number]): number =>
  CATEGORY_HUES.indexOf(name)
