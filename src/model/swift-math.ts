/**
 * Swift's `.rounded()`: to the nearest integer, halves away from zero (`Math.round` rounds halves up).
 */
export function swiftRound(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** `CGFloat.ulpOfOne`, the smallest positive step after 1. */
export const ULP_OF_ONE = Number.EPSILON;
