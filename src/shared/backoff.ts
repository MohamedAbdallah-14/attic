export const MAX_ATTEMPTS = 3;

const SCHEDULE_MS = [60_000, 300_000, 900_000];

export function nextDelayMs(attempt: number): number | null {
  if (attempt < 1 || attempt > SCHEDULE_MS.length) return null;
  return SCHEDULE_MS[attempt - 1] ?? null;
}

export function shouldRetry(attemptsSoFar: number): boolean {
  return attemptsSoFar < MAX_ATTEMPTS;
}
