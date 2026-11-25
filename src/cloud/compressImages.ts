// Shrink embedded images before a card goes to the online library: imported
// portraits are 816×550 PNG data URLs (often 0.5–1 MB each), which would make
// the shared library slow to load. Large PNG/JPEG/BMP data URLs are re-encoded
// as WebP (transparency kept) when that is smaller; everything else is kept.

const MIN_CHARS = 150_000
const WEBP_QUALITY = 0.9

async function toWebp(dataUrl: string): Promise<string> {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0)
    const webp = canvas.toDataURL('image/webp', WEBP_QUALITY)
    return webp.startsWith('data:image/webp') && webp.length < dataUrl.length ? webp : dataUrl
  } catch {
    return dataUrl
  }
}

function shouldCompress(s: string): boolean {
  return s.length >= MIN_CHARS && /^data:image\/(png|jpeg|jpg|bmp);/i.test(s)
}

/** Deep copy of `value` with large embedded raster images re-encoded. */
export async function compressCardImages<T>(value: T): Promise<T> {
  if (typeof value === 'string') return (shouldCompress(value) ? await toWebp(value) : value) as T
  if (Array.isArray(value)) return (await Promise.all(value.map((v) => compressCardImages(v)))) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = await compressCardImages(v)
    return out as T
  }
  return value
}
