/** Up to two initials for an avatar circle. Pure. "Operator" gives "O", "Mia Chen" gives "MC". */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._@-]+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  const first = words[0];
  if (first === undefined) return '?';
  const lead = (word: string): string => {
    const letter = Array.from(word).find((char) => /[\p{L}\p{N}]/u.test(char));
    return (letter ?? '').toLocaleUpperCase('en-AU');
  };
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return lead(first) + (last === undefined ? '' : lead(last));
}
