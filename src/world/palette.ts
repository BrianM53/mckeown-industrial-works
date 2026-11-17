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

/**
 * Environment tones (lighting, sky, paint, interiors). Added by the environment
 * module; other modules may use them for consistency.
 */
export const ENV_PALETTE = {
  sun: '#FFD3A2',
  skyZenith: '#5C8590',
  skyMid: '#A8B9B1',
  skyHorizon: '#EFC08F',
  haze: '#CDA986',
  hemiSky: '#A6BEBF',
  hemiGround: '#76604B',
  ambient: '#BFA98F',
  nightZenith: '#0E1522',
  nightHorizon: '#2A3346',
  nightHaze: '#262D3B',
  moon: '#7F93B8',
  laneWhite: '#E9E3D3',
  laneYellow: '#E9B63F',
  walkway: '#4D7A5B',
  asphalt: '#3D4241',
  lotAsphalt: '#454948',
  windowWarm: '#FFCB8C',
  lampWarm: '#FFE4B5',
  emergency: '#FF2A1C',
  wood: '#9A6B43',
  woodDark: '#664530',
  foliage: '#557F3D',
  terracotta: '#B5643C',
  rubber: '#1C1F20',
  glassTint: '#8FB4B8',
} as const
