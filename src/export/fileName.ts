/** A card name usable as a file name: keeps Chinese and other letters, drops
 *  only what file systems refuse. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
}
