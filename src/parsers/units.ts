/** Apple Health exports in the user's locale units, so the same metric can
 *  arrive as mi or km, lb or kg, degF or degC. Everything is normalised on the
 *  way in so the dashboard never has to ask which export it came from. */

export type Kind = 'distance_km' | 'mass_kg' | 'temp_c' | 'energy_kcal' | 'raw'

export function convert(value: number, unit: string | undefined, kind: Kind): number {
  if (!unit || kind === 'raw') return value
  const u = unit.trim().toLowerCase()

  switch (kind) {
    case 'distance_km':
      if (u === 'mi') return value * 1.609344
      if (u === 'm') return value / 1000
      if (u === 'ft') return value * 0.0003048
      if (u === 'yd') return value * 0.0009144
      return value // km
    case 'mass_kg':
      if (u === 'lb') return value * 0.45359237
      if (u === 'st') return value * 6.35029318
      if (u === 'g') return value / 1000
      return value // kg
    case 'temp_c':
      if (u === 'degf' || u === '°f') return (value - 32) * 5 / 9
      if (u === 'k') return value - 273.15
      return value // degC
    case 'energy_kcal':
      if (u === 'kj') return value / 4.184
      if (u === 'j') return value / 4184
      return value // kcal / Cal
  }
}

/** Apple writes fractional percentages (0.97) for SpO2; Whoop writes 97. */
export function asPercent(value: number): number {
  return value <= 1.0001 ? value * 100 : value
}
