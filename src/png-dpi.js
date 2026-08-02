const PNG_SIGNATURE_LENGTH = 8;

export function setPngDpi(source, dpi) {
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  writeUint32(data, 0, pixelsPerMeter);
  writeUint32(data, 4, pixelsPerMeter);
  data[8] = 1;
  const physicalSize = makeChunk("pHYs", data);

  const parts = [source.slice(0, PNG_SIGNATURE_LENGTH)];
  let offset = PNG_SIGNATURE_LENGTH;
  let inserted = false;
  while (offset + 12 <= source.length) {
    const length = readUint32(source, offset);
    const end = offset + 12 + length;
    if (end > source.length) throw new Error("INVALID_PNG");
    const type = String.fromCharCode(...source.slice(offset + 4, offset + 8));
    if (type === "pHYs") {
      if (!inserted) parts.push(physicalSize);
      inserted = true;
    } else {
      parts.push(source.slice(offset, end));
      if (type === "IHDR" && !inserted) {
        parts.push(physicalSize);
        inserted = true;
      }
    }
    offset = end;
  }
  return concat(parts);
}

export function setJpegDpi(source, dpi) {
  const density = Math.round(Number(dpi));
  if (!Number.isFinite(density) || density < 1 || density > 0xffff) throw new Error("INVALID_DPI");
  if (source[0] !== 0xff || source[1] !== 0xd8) throw new Error("INVALID_JPEG");

  const result = source.slice();
  let offset = 2;
  while (offset + 4 <= result.length && result[offset] === 0xff) {
    const marker = result[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (result[offset + 2] << 8) | result[offset + 3];
    if (length < 2 || offset + 2 + length > result.length) throw new Error("INVALID_JPEG");
    if (marker === 0xe0 && length >= 16 && isJfif(result, offset + 4)) {
      result[offset + 11] = 1;
      writeUint16(result, offset + 12, density);
      writeUint16(result, offset + 14, density);
      return result;
    }
    offset += 2 + length;
  }

  const header = Uint8Array.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
    0x01, density >>> 8, density & 255, density >>> 8, density & 255,
    0x00, 0x00
  ]);
  return concat([source.slice(0, 2), header, source.slice(2)]);
}

function makeChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concat([typeBytes, data])));
  return chunk;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 255;
  bytes[offset + 1] = value & 255;
}

function isJfif(bytes, offset) {
  return bytes[offset] === 0x4a && bytes[offset + 1] === 0x46 && bytes[offset + 2] === 0x49
    && bytes[offset + 3] === 0x46 && bytes[offset + 4] === 0;
}

function concat(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
