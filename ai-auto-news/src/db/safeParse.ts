/**
 * Safe JSON parse helper — returns fallback on corrupt/invalid data
 * instead of throwing and crashing the request.
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
