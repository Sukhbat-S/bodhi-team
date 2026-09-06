const SETTLE_TICKS = 240;
const SETTLE_TIME_MS = 6000;

/** Force-graph settings that move reduced-motion layout work before first paint. */
export function graphMotionSettings(reducedMotion: boolean) {
  return reducedMotion
    ? { warmupTicks: SETTLE_TICKS, cooldownTicks: 0, cooldownTime: 0 }
    : { warmupTicks: 20, cooldownTicks: SETTLE_TICKS, cooldownTime: SETTLE_TIME_MS };
}
