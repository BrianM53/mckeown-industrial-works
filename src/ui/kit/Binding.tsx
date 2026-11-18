import { Keycap } from './Keycap'

/** Pointer gestures ("Drag with mouse", "Mouse wheel", "Pinch") are not keys: they get a flat chip, not a keycap. */
const GESTURE = /^(drag|mouse|wheel|scroll|click|right[- ]click|tap|pinch|swipe)\b/i

export function isPointerGesture(text: string): boolean {
  return GESTURE.test(text.trim())
}

/** One control binding from content/controls.ts: a keycap for keys, a flat chip for mouse/touch gestures. */
export function Binding({ text, size = 'sm' }: { text: string; size?: 'sm' | 'md' }) {
  if (isPointerGesture(text)) return <span className={`miw-gesture miw-gesture--${size}`}>{text}</span>
  return <Keycap size={size}>{text}</Keycap>
}
