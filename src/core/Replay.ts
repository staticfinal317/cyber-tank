import type { ReplayFrame } from './types';

/** Returns a bounded replay whose first retained frame always starts at t=0. */
export function rebaseReplayFrames(frames: readonly ReplayFrame[], limit = 3600): ReplayFrame[] {
  const retained = frames.slice(-Math.max(1, limit));
  const origin = retained[0]?.t ?? 0;
  return retained.map((frame) => ({ ...frame, t: Math.max(0, frame.t - origin) }));
}
