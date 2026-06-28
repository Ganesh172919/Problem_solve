/**
 * Serialize unknown error values into readable strings.
 * Unlike String(err), this handles Error objects, plain strings,
 * and arbitrary objects without producing "[object Object]".
 */
export function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err === null || err === undefined) return 'Unknown error';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
