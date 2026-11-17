/**
 * Art-direction palette (spec §2). Guidelines, not a straitjacket — but prefer
 * these so the world reads as one place.
 */
export const PALETTE = {
  charcoal: '#252B2B',
  gunmetal: '#465356',
  concrete: '#85857D',
  rust: '#A95E39',
  hazard: '#E9B63F',
  safety: '#E57D35',
  furnace: '#FFB05A',
  teal: '#638C88',
  cream: '#EAE3D2',
  // supporting tones
  soot: '#1A1E1F',
  steel: '#7D8A8C',
  steelLight: '#A9B4B3',
  oil: '#2F3536',
  brick: '#7A4A36',
  asphalt: '#3A3F3F',
  paintWhite: '#D9D4C5',
  signalRed: '#D9483B',
  signalGreen: '#5DBB63',
  signalBlue: '#4F86A8',
  glass: '#9CC3C9',
  skyTop: '#6F8E95',
  skyHorizon: '#E8B987',
  fog: '#B79A82',
} as const

export type PaletteKey = keyof typeof PALETTE
