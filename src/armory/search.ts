/** lowercase, without spaces and punctuation: "T-90 M" and "t90m" match */
export function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.·'’/()（）]+/g, '')
}
