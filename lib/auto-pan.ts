export const AUTO_PAN_SPEEDS = [
  { label: 'Slow', pixelsPerSecond: 14 },
  { label: 'Gentle', pixelsPerSecond: 28 },
  { label: 'Steady', pixelsPerSecond: 56 },
  { label: 'Brisk', pixelsPerSecond: 84 },
] as const;

export type AutoPanSpeed = (typeof AUTO_PAN_SPEEDS)[number]['pixelsPerSecond'];
export const DEFAULT_AUTO_PAN_NOTCH = 2;
