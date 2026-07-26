/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * `catch` binds `unknown`, but non-`Error` values (strings, driver objects)
 * can be thrown too, so the message has to be recovered defensively.
 */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
