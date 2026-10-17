/**
 * Pure gesture maths for the mobile player (no DOM), so thresholds and direction rules are unit-tested.
 *
 * A drag starts undecided. Once the finger has travelled SLOP px it locks to the dominant axis and
 * stays locked for the rest of the gesture, so a vertical dismiss can never turn into a track change.
 * On release it commits when it travelled far enough (a share of the surface) or was flicked fast enough.
 */
export type Axis = "x" | "y";
export type Direction = "up" | "down" | "left" | "right";

/** Movement below this is a tap or jitter, never a gesture. */
export const SLOP_PX = 10;
/** The dominant axis must lead the other by this ratio to lock (diagonals stay undecided a little longer). */
export const AXIS_RATIO = 1.2;
/** Commit when the drag covers this share of the surface... */
export const COMMIT_FRACTION = 0.25;
/** ...or when it is a flick: fast enough (px/ms) and at least this far. */
export const FLICK_VELOCITY = 0.45;
export const FLICK_MIN_PX = 24;

export function lockAxis(dx: number, dy: number): Axis | null {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < SLOP_PX) return null;
  if (ax >= ay * AXIS_RATIO) return "x";
  if (ay >= ax * AXIS_RATIO) return "y";
  return null;
}

export function directionOf(axis: Axis, delta: number): Direction {
  return axis === "x" ? (delta < 0 ? "left" : "right") : delta < 0 ? "up" : "down";
}

/**
 * Whether a finished drag should commit. `delta` is signed travel on the locked axis, `size` the
 * surface length on that axis, `velocity` px/ms over the last few samples (signed like delta).
 * A flick against the drag direction cancels it (user changed their mind).
 */
export function shouldCommit(delta: number, size: number, velocity: number): boolean {
  if (delta === 0) return false;
  const sameWay = Math.sign(velocity) === Math.sign(delta) || velocity === 0;
  if (!sameWay && Math.abs(velocity) > FLICK_VELOCITY / 2) return false;
  if (Math.abs(delta) >= size * COMMIT_FRACTION) return true;
  return sameWay && Math.abs(velocity) >= FLICK_VELOCITY && Math.abs(delta) >= FLICK_MIN_PX;
}

/** Velocity from recent samples (last ~100 ms), robust to a single noisy event. */
export function velocityOf(samples: { t: number; v: number }[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  let first = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) { if (last.t - samples[i]!.t > windowMs) break; first = samples[i]!; }
  const dt = last.t - first.t;
  return dt > 0 ? (last.v - first.v) / dt : 0;
}

/** Rubber-band resistance past a limit (iOS-style overscroll feel). */
export function rubberBand(overshoot: number, dimension: number, c = 0.55): number {
  if (overshoot <= 0) return 0;
  return (1 - 1 / ((overshoot * c) / dimension + 1)) * dimension;
}
