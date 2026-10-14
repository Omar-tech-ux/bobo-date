const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export function validatePhotoFile(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo. Export HEIC photos as JPEG first.')
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.')
}

export function scaledDimensions(width: number, height: number) {
  const scale = Math.min(1, 2560 / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function preparePhoto(file: File, signal: AbortSignal) {
  validatePhotoFile(file)
  signal.throwIfAborted()
  const url = URL.createObjectURL(file)
  const img = new Image()
  try {
    // Browser image decoding applies EXIF orientation before drawing to canvas.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('This photo could not be opened. Try exporting it as JPEG.'))
      img.src = url
    })
    signal.throwIfAborted()
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 60_000_000) {
      throw new Error('This photo is too large to process. Choose a smaller version.')
    }
    const dimensions = scaledDimensions(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    try {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Photo processing is unavailable in this browser.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', 0.88)
      })
      signal.throwIfAborted()
      if (blob.size > MAX_UPLOAD_BYTES) throw new Error('This photo is still too large. Choose a smaller version.')
      return { ...dimensions, blob }
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    img.src = ''
    URL.revokeObjectURL(url)
  }
}
