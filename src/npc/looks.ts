/**
 * NPC worker looks (WorkerModel geometry is built once per distinct look and
 * cached, so the roster reuses a handful). Module-level constants: WorkerModel
 * memoizes on the look object's identity.
 *
 * None of these may resemble the visitor (white hard hat + orange stripe, lime vest).
 */
import type { WorkerLook } from '@/world/WorkerModel'
import { PALETTE } from '@/world/palette'

type Look = Partial<WorkerLook>

/** Visitor intake: teal hard hat, cream vest, tablet, glasses. */
export const LOOK_GREETER: Look = {
  helmet: '#5E8C87',
  helmetStripe: '#EAE3D2',
  vest: '#E8DFC9',
  stripe: '#5E8C87',
  shirt: '#4F6E78',
  pants: '#30353D',
  skin: '#8A5A3C',
  boots: '#2C2420',
  gloves: '#5E8C87',
  accessory: 'tablet',
  face: 'glasses',
}

/** Production uniform A (yellow hat, orange vest, wrench). */
export const LOOK_LINE_A: Look = {
  helmet: PALETTE.hazard,
  vest: PALETTE.safety,
  stripe: '#D8DCD6',
  shirt: '#5B4A3A',
  pants: '#2F3B44',
  skin: '#C99A76',
  boots: '#3A2A1F',
  gloves: '#6B4A2E',
  accessory: 'wrench',
}

/** Production uniform B (yellow hat, orange vest, beard, bare hands). */
export const LOOK_LINE_B: Look = {
  helmet: PALETTE.hazard,
  vest: '#DD6F2C',
  stripe: '#D8DCD6',
  shirt: '#3F5568',
  pants: '#33302B',
  skin: '#A8714F',
  boots: '#2E241C',
  gloves: '#8A6A45',
  accessory: 'none',
  face: 'beard',
}

/** Quality control: white hat, yellow vest, clipboard, glasses. */
export const LOOK_QC: Look = {
  helmet: '#ECEAE2',
  helmetStripe: PALETTE.hazard,
  vest: PALETTE.hazard,
  stripe: '#EDEFEA',
  shirt: '#6E7F82',
  pants: '#2B3238',
  skin: '#E0B48F',
  boots: '#3A2A1F',
  gloves: '#C9C0AE',
  accessory: 'clipboard',
  face: 'glasses',
}

/** Tower crew chief: orange hat with a black ridge, black vest with yellow stripes, mustache, tablet. */
export const LOOK_CHIEF: Look = {
  helmet: PALETTE.safety,
  helmetStripe: PALETTE.charcoal,
  vest: '#2A2F31',
  stripe: PALETTE.hazard,
  shirt: '#7A3B2E',
  pants: '#2A2F35',
  skin: '#6E4630',
  boots: '#2B2018',
  gloves: '#3B3B3B',
  accessory: 'tablet',
  face: 'mustache',
}

/** The exhausted forklift driver, Employee of the Month: blue hat, orange vest, coffee, mustache. */
export const LOOK_DRIVER: Look = {
  helmet: PALETTE.signalBlue,
  vest: PALETTE.safety,
  stripe: '#D8DCD6',
  shirt: '#4A3B30',
  pants: '#3D4652',
  skin: '#D3A27D',
  boots: '#2B2018',
  gloves: '#4A4038',
  accessory: 'mug',
  face: 'mustache',
}

/** Control-room operator: teal hat, cream vest, headset. */
export const LOOK_OPERATOR: Look = {
  helmet: PALETTE.teal,
  vest: '#2F4E5C',
  stripe: '#B8D4CF',
  shirt: '#E1D8C4',
  pants: '#2A3036',
  skin: '#C48E6A',
  boots: '#2C2420',
  gloves: '#2F4E5C',
  accessory: 'headset',
}

/** Radio DJ: red hat, black vest with red stripes, headset, beard. */
export const LOOK_DJ: Look = {
  helmet: '#C8553D',
  helmetStripe: '#1E2224',
  vest: '#1F2326',
  stripe: '#E06A4E',
  shirt: '#E9B63F',
  pants: '#2F2A35',
  skin: '#9C6644',
  boots: '#1D1A17',
  gloves: '#1F2326',
  accessory: 'headset',
  face: 'beard',
}

/** Sysadmin: blue hat, slate vest, tablet, glasses. */
export const LOOK_SYSADMIN: Look = {
  helmet: '#4F86A8',
  helmetStripe: '#9FD0EA',
  vest: '#3A4C5A',
  stripe: '#9FD0EA',
  shirt: '#272B2F',
  pants: '#3A3F4A',
  skin: '#F0C8A4',
  boots: '#22201D',
  gloves: '#3A4C5A',
  accessory: 'tablet',
  face: 'glasses',
}

/** R&D scientist: white hat with a violet band, lab-coat white vest, clipboard, glasses. */
export const LOOK_SCIENTIST: Look = {
  helmet: '#F1EFE8',
  helmetStripe: '#8C6BB1',
  vest: '#EEEAE0',
  stripe: '#8C6BB1',
  shirt: '#E4DED0',
  pants: '#4B4F5C',
  skin: '#B88262',
  boots: '#2B2522',
  gloves: '#D9D2C4',
  accessory: 'clipboard',
  face: 'glasses',
}

/** Break-room regulars (mugs). */
export const LOOK_LOUNGER_A: Look = {
  helmet: PALETTE.hazard,
  vest: '#E2722F',
  stripe: '#D8DCD6',
  shirt: '#6F4A6E',
  pants: '#2F3B44',
  skin: '#B57A55',
  boots: '#3A2A1F',
  gloves: '#8A6A45',
  accessory: 'mug',
}

export const LOOK_LOUNGER_B: Look = {
  helmet: '#6BA368',
  vest: PALETTE.hazard,
  stripe: '#EDEFEA',
  shirt: '#3E5A44',
  pants: '#3A3530',
  skin: '#E3B18F',
  boots: '#2E241C',
  gloves: '#6B4A2E',
  accessory: 'mug',
  face: 'beard',
}
