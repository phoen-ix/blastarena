/**
 * Safely extract an error message from an unknown caught value.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
