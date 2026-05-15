/** Test / short prologue clip. For the final 60s show video, change back to `51.0`. */
export const REACTION_CAPTURE_TIME_SECONDS = 34.0;

/**
 * Picks a capture timecode that fits the loaded video duration.
 * `captureTime = min(REACTION_CAPTURE_TIME_SECONDS, max(1, duration - 1))`
 */
export function getReactionCaptureTimeSeconds(videoDurationSeconds: number) {
  if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) {
    return REACTION_CAPTURE_TIME_SECONDS;
  }

  return Math.min(
    REACTION_CAPTURE_TIME_SECONDS,
    Math.max(1, videoDurationSeconds - 1)
  );
}
