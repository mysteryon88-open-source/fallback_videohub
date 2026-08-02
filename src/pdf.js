const encoder = new TextEncoder();

export function buildPdf(jpegBytes, imageWidth, imageHeight, pageWidthMm, pageHeightMm) {
  const pageWidth = points(pageWidthMm);
  const pageHeight = points(pageHeightMm);
  const content = bytes(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);
  const objects = [
    object(1, bytes("<< /Type /Catalog /Pages 2 0 R >>")),
    object(2, bytes("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")),
    object(3, bytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)),
    streamObject(4, `/Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpegBytes),
    streamObject(5, "", content)
  ];
  const header = concat(bytes("%PDF-1.4\n%"), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), bytes("\n"));
  const offsets = [];
  let offset = header.length;
  for (const entry of objects) {
    offsets.push(offset);
    offset += entry.length;
  }
  const xrefOffset = offset;
  const xref = bytes(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(value => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}`);
  const trailer = bytes(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return concat(header, ...objects, xref, trailer);
}

function object(number, body) {
  return concat(bytes(`${number} 0 obj\n`), body, bytes("\nendobj\n"));
}

function streamObject(number, dictionary, data) {
  return object(number, concat(bytes(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, bytes("\nendstream")));
}

function points(mm) {
  return String(Number((mm * 72 / 25.4).toFixed(3)));
}

function bytes(value) {
  return encoder.encode(value);
}

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
