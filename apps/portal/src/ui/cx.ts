/** Joins class names, skipping anything falsy. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part) => typeof part === 'string' && part !== '').join(' ');
}
