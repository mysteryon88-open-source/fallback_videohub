import test from "node:test";
import assert from "node:assert/strict";

import * as layout from "../src/layout.js";
import * as photoUtils from "../src/photos.js";
import { buildPdf } from "../src/pdf.js";
import * as dpiMetadata from "../src/png-dpi.js";

const { buildSheetPlan, getCutMarkSegments, resolvePaper } = layout;
const { moveItem } = photoUtils;
const { setPngDpi } = dpiMetadata;

test("resolvePaper applies orientation to predefined paper and rejects custom sizes", () => {
  assert.deepEqual(resolvePaper("10x15", "portrait"), { widthMm: 100, heightMm: 150 });
  assert.deepEqual(resolvePaper("a4", "landscape"), { widthMm: 297, heightMm: 210 });
  assert.throws(() => resolvePaper("custom", "portrait"), error => error.message === "INVALID_PAPER");
});

test("photo lookup returns the clicked cell and ignores gaps", () => {
  const cells = [
    { x: 10, y: 20, width: 30, height: 40, photoIndex: 2 },
    { x: 50, y: 20, width: 30, height: 40, photoIndex: 0 }
  ];

  assert.equal(layout.getPhotoIndexAtPoint?.(cells, 15, 25), 2);
  assert.equal(layout.getPhotoIndexAtPoint?.(cells, 45, 25), -1);
  assert.equal(layout.getPhotoIndexAtPoint?.(cells, 80, 60), 0);
});

test("viewport point maps to a photo in the scaled canvas content box", () => {
  const cells = [
    { x: 0, y: 0, width: 100, height: 100, photoIndex: 0 },
    { x: 200, y: 200, width: 100, height: 100, photoIndex: 1 }
  ];
  const viewport = { left: 100, top: 200 };
  const canvas = {
    clientLeft: 10,
    clientTop: 10,
    clientWidth: 300,
    clientHeight: 400,
    width: 600,
    height: 800
  };

  assert.equal(layout.getPhotoIndexFromViewportPoint?.(cells, viewport, canvas, { x: 235, y: 335 }), 1);
  assert.equal(layout.getPhotoIndexFromViewportPoint?.(cells, viewport, canvas, { x: 100, y: 200 }), -1);
});

test("custom grid repeats one photo across every cell", () => {
  const plan = buildSheetPlan({
    paper: { widthMm: 150, heightMm: 100 },
    dpi: 300,
    marginMm: 5,
    gapMm: 2,
    gridMode: "custom",
    columns: 3,
    rows: 2,
    photoCount: 1
  });

  assert.equal(plan.cells.length, 6);
  assert.deepEqual(plan.cells.map(cell => cell.photoIndex), [0, 0, 0, 0, 0, 0]);
});

test("custom grid preserves photo order and leaves unused slots empty", () => {
  const plan = buildSheetPlan({
    paper: { widthMm: 150, heightMm: 100 },
    dpi: 300,
    marginMm: 4,
    gapMm: 2,
    gridMode: "custom",
    columns: 3,
    rows: 2,
    photoCount: 4
  });

  assert.deepEqual(plan.cells.map(cell => cell.photoIndex), [0, 1, 2, 3]);
});

test("custom grid rejects fewer slots than selected photos", () => {
  assert.throws(() => buildSheetPlan({
    paper: { widthMm: 100, heightMm: 150 },
    dpi: 300,
    marginMm: 2,
    gapMm: 2,
    gridMode: "custom",
    columns: 2,
    rows: 2,
    photoCount: 5
  }), error => error.message === "GRID_TOO_SMALL");
});

test("automatic layout fits twelve photos in either paper orientation", () => {
  const createPlan = paper => buildSheetPlan({
    paper,
    dpi: 300,
    marginMm: 5,
    gapMm: 2,
    gridMode: "auto",
    columns: 1,
    rows: 1,
    photoCount: 12
  });

  const landscape = createPlan({ widthMm: 150, heightMm: 100 });
  const portrait = createPlan({ widthMm: 100, heightMm: 150 });

  assert.deepEqual([landscape.columns, landscape.rows, landscape.cells.length], [4, 3, 12]);
  assert.deepEqual([portrait.columns, portrait.rows, portrait.cells.length], [3, 4, 12]);
});

test("custom grid defaults to the current sheet dimensions", () => {
  const getDefaults = layout.getCustomGridDefaults;

  assert.deepEqual(getDefaults?.({ columns: 4, rows: 3 }, 2, 2), { columns: 4, rows: 3 });
  assert.deepEqual(getDefaults?.(null, 2, 2), { columns: 2, rows: 2 });
});

test("cut marks create two outward segments at every cell corner", () => {
  const segments = getCutMarkSegments([{ x: 10, y: 20, width: 30, height: 40 }], 3);

  assert.equal(segments.length, 8);
  assert.deepEqual(segments[0], [7, 20, 10, 20]);
  assert.deepEqual(segments[7], [40, 60, 40, 63]);
});

test("moveItem returns a reordered copy without mutating the source", () => {
  const source = ["a", "b", "c", "d"];

  assert.deepEqual(moveItem(source, 2, 0), ["c", "a", "b", "d"]);
  assert.deepEqual(source, ["a", "b", "c", "d"]);
});

test("removeItem removes one photo without mutating the source", () => {
  const source = ["a", "b", "c"];

  assert.deepEqual(photoUtils.removeItem?.(source, 1), ["a", "c"]);
  assert.deepEqual(photoUtils.removeItem?.(source, 9), source);
  assert.deepEqual(source, ["a", "b", "c"]);
});

test("photo selection accepts twelve images and rejects the thirteenth", () => {
  const getError = photoUtils.getPhotoSelectionError;

  assert.equal(getError?.(12, 12, 12), null);
  assert.equal(getError?.(13, 13, 13), "photoLimit");
  assert.equal(getError?.(1, 0, 0), "needPhotos");
});

test("buildPdf creates a one-page PDF whose xref offset is valid", () => {
  const bytes = buildPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 1200, 1800, 100, 150);
  const text = new TextDecoder("latin1").decode(bytes);
  const startXref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);

  assert.equal(text.slice(0, 8), "%PDF-1.4");
  assert.match(text, /\/MediaBox \[0 0 283\.465 425\.197\]/);
  assert.match(text, /\/Subtype \/Image/);
  assert.equal(text.slice(startXref, startXref + 4), "xref");
});

test("setPngDpi inserts a 300 DPI pHYs chunk after IHDR", () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const result = setPngDpi(png, 300);
  const type = new TextDecoder().decode(result.slice(37, 41));
  const ppm = new DataView(result.buffer, result.byteOffset + 41, 4).getUint32(0);

  assert.equal(type, "pHYs");
  assert.equal(ppm, 11811);
});

test("setJpegDpi writes 300 DPI into JFIF density fields", () => {
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xd9
  ]);

  const result = dpiMetadata.setJpegDpi?.(jpeg, 300);

  assert.ok(result, "setJpegDpi must be exported");
  assert.equal(result[13], 1);
  assert.deepEqual([...result.slice(14, 18)], [0x01, 0x2c, 0x01, 0x2c]);
  assert.equal(jpeg[13], 0);
});
