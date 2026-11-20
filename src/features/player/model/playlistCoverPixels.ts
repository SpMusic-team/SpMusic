import type { PlaylistCoverImage } from './playerUiViewModel'

type CoverPixels = Readonly<{
  width: number
  height: number
  stride: number
  pixels: Uint8ClampedArray
}>

export function playlistCoverImageFromPixels(pixels: CoverPixels): PlaylistCoverImage {
  // A 24-bit BMP keeps the resident object-URL window compact without creating
  // an ImageBitmap or one GPU-backed 2D canvas per playlist card. At the 40
  // visible-card limit plus the current dock track, the encoded upper bound is
  // about 8.5 MiB when the persistent first-track hero uses a 512 px thumbnail.
  const rowStride = Math.ceil((pixels.width * 3) / 4) * 4
  const pixelBytes = rowStride * pixels.height
  const headerBytes = 54
  const encoded = new Uint8Array(headerBytes + pixelBytes)
  const header = new DataView(encoded.buffer)
  encoded[0] = 0x42
  encoded[1] = 0x4d
  header.setUint32(2, encoded.byteLength, true)
  header.setUint32(10, headerBytes, true)
  header.setUint32(14, 40, true)
  header.setInt32(18, pixels.width, true)
  header.setInt32(22, pixels.height, true)
  header.setUint16(26, 1, true)
  header.setUint16(28, 24, true)
  header.setUint32(34, pixelBytes, true)
  header.setInt32(38, 2835, true)
  header.setInt32(42, 2835, true)
  for (let sourceY = 0; sourceY < pixels.height; sourceY += 1) {
    const targetRow = headerBytes + (pixels.height - 1 - sourceY) * rowStride
    const sourceRow = sourceY * pixels.stride
    for (let x = 0; x < pixels.width; x += 1) {
      const sourceOffset = sourceRow + x * 4
      const targetOffset = targetRow + x * 3
      encoded[targetOffset] = pixels.pixels[sourceOffset + 2]
      encoded[targetOffset + 1] = pixels.pixels[sourceOffset + 1]
      encoded[targetOffset + 2] = pixels.pixels[sourceOffset]
    }
  }
  const src = URL.createObjectURL(new Blob([encoded], { type: 'image/bmp' }))
  return { src, width: pixels.width, height: pixels.height, encodedBytes: encoded.byteLength }
}
