/** Read an image file scaled down to fit w×h (aspect kept, transparency
 *  kept) as a PNG data URL, or WebP when that is smaller. */
export async function readImageFit(file: File, w: number, h: number): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, w / img.naturalWidth, h / img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = canvas.toDataURL('image/png')
    const webp = canvas.toDataURL('image/webp', 0.92)
    return webp.startsWith('data:image/webp') && webp.length < png.length ? webp : png
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A unit's arsenal icon (the game's are 416×216 silhouettes). */
export function readIconFile(file: File): Promise<string> {
  return readImageFit(file, 416, 216)
}
