export type JpegInfo = {
  width: number;
  height: number;
  orientation: number;
};

/** Read JPEG size and EXIF orientation without decoding the pixels. */
export function readJpegInfo(buffer: ArrayBuffer): JpegInfo {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) {
    return { width: 0, height: 0, orientation: 1 };
  }

  let offset = 2;
  let orientation = 1;

  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const size = view.getUint16(offset + 2);
    if (size < 2 || offset + 2 + size > view.byteLength) break;

    if (marker === 0xe1) {
      const fromExif = readExifOrientation(view, offset + 4, size - 2);
      if (fromExif) orientation = fromExif;
    }

    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
        orientation,
      };
    }

    offset += 2 + size;
  }

  return { width: 0, height: 0, orientation };
}

export async function readJpegInfoFromBlob(blob: Blob): Promise<JpegInfo> {
  return readJpegInfo(await blob.arrayBuffer());
}

function readExifOrientation(view: DataView, start: number, length: number): number | null {
  if (length < 14) return null;
  if (view.getUint32(start) !== 0x45786966) return null; // "Exif"
  const tiff = start + 6;
  const endian = view.getUint16(tiff);
  const little = endian === 0x4949;
  if (!little && endian !== 0x4d4d) return null;
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  if (u16(tiff + 2) !== 0x002a) return null;
  let ifd = tiff + u32(tiff + 4);
  const end = start + length;
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  ifd += 2;
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return null;
}

export function orientedSize(width: number, height: number, orientation: number) {
  if (orientation >= 5 && orientation <= 8) return { width: height, height: width };
  return { width, height };
}

/**
 * Map a point in the upright (post-EXIF) image to raw JPEG pixels.
 * Coordinates are continuous: x in [0, orientedWidth], y in [0, orientedHeight].
 */
export function orientedToRaw(
  x: number,
  y: number,
  rawWidth: number,
  rawHeight: number,
  orientation: number,
) {
  switch (orientation) {
    case 2:
      return { x: rawWidth - x, y };
    case 3:
      return { x: rawWidth - x, y: rawHeight - y };
    case 4:
      return { x, y: rawHeight - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: y, y: rawHeight - x };
    case 7:
      return { x: rawWidth - y, y: rawHeight - x };
    case 8:
      return { x: rawWidth - y, y: x };
    default:
      return { x, y };
  }
}
