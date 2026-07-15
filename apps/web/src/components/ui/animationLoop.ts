export type AnimationCallback = () => void;

export function scheduleNextAnimationFrame(
  requestFrame: (callback: FrameRequestCallback) => number,
  getCallback: () => AnimationCallback,
): number {
  return requestFrame(() => getCallback()());
}
