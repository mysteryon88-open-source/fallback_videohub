const PAPER_SIZES = {
  "9x13": [90, 130],
  "10x15": [100, 150],
  "13x18": [130, 180],
  "15x21": [150, 210],
  "20x30": [200, 300],
  a4: [210, 297],
  a3: [297, 420]
};

export function resolvePaper(paperId, orientation) {
  const dimensions = PAPER_SIZES[paperId];
  if (!dimensions) throw new Error("INVALID_PAPER");

  const [short, long] = [...dimensions].sort((a, b) => a - b);
  return orientation === "landscape"
    ? { widthMm: long, heightMm: short }
    : { widthMm: short, heightMm: long };
}

export function getPhotoIndexAtPoint(cells, x, y) {
  const cell = cells.find(item => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
  return cell?.photoIndex ?? -1;
}

export function getPhotoIndexFromViewportPoint(cells, viewport, canvas, point) {
  const left = viewport.left + canvas.clientLeft;
  const top = viewport.top + canvas.clientTop;
  if (
    canvas.clientWidth <= 0 || canvas.clientHeight <= 0 ||
    point.x < left || point.x > left + canvas.clientWidth ||
    point.y < top || point.y > top + canvas.clientHeight
  ) return -1;

  return getPhotoIndexAtPoint(
    cells,
    (point.x - left) * canvas.width / canvas.clientWidth,
    (point.y - top) * canvas.height / canvas.clientHeight
  );
}

export function getCustomGridDefaults(plan, columns, rows) {
  return plan ? { columns: plan.columns, rows: plan.rows } : { columns, rows };
}

export function buildSheetPlan({
  paper,
  dpi,
  marginMm,
  gapMm,
  gridMode,
  columns,
  rows,
  photoCount
}) {
  const scale = Number(dpi) / 25.4;
  const margin = Math.max(0, Number(marginMm));
  const gap = Math.max(0, Number(gapMm));
  const availableWidth = paper.widthMm - margin * 2;
  const availableHeight = paper.heightMm - margin * 2;
  if (!Number.isFinite(scale) || scale <= 0 || availableWidth <= 0 || availableHeight <= 0 || photoCount < 1) {
    throw new Error("INVALID_LAYOUT");
  }

  let grid;
  if (gridMode === "custom") {
    grid = [toGridSize(columns), toGridSize(rows)];
  } else {
    grid = getAutoGrid(photoCount, paper.widthMm > paper.heightMm);
  }

  const [columnCount, rowCount] = grid;
  if (columnCount < 1 || rowCount < 1) throw new Error("CELLS_DO_NOT_FIT");
  const slotCount = columnCount * rowCount;
  if (photoCount > 1 && slotCount < photoCount) throw new Error("GRID_TOO_SMALL");

  const cellWidthMm = (availableWidth - (columnCount - 1) * gap) / columnCount;
  const cellHeightMm = (availableHeight - (rowCount - 1) * gap) / rowCount;
  if (cellWidthMm <= 0 || cellHeightMm <= 0) throw new Error("CELLS_DO_NOT_FIT");
  const startXmm = margin;
  const startYmm = margin;

  const filledCellCount = photoCount === 1 ? slotCount : photoCount;
  const cells = Array.from({ length: filledCellCount }, (_, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const xMm = startXmm + column * (cellWidthMm + gap);
    const yMm = startYmm + row * (cellHeightMm + gap);
    return {
      x: xMm * scale,
      y: yMm * scale,
      width: cellWidthMm * scale,
      height: cellHeightMm * scale,
      photoIndex: photoCount === 1 ? 0 : index
    };
  });

  return {
    widthPx: Math.round(paper.widthMm * scale),
    heightPx: Math.round(paper.heightMm * scale),
    paperWidthMm: paper.widthMm,
    paperHeightMm: paper.heightMm,
    dpi: Number(dpi),
    columns: columnCount,
    rows: rowCount,
    cells,
    scale,
    marginMm: margin,
    gapMm: gap
  };
}

export function getCutMarkSegments(cells, length) {
  return cells.flatMap(({ x, y, width, height }) => {
    const right = x + width;
    const bottom = y + height;
    return [
      [x - length, y, x, y], [x, y - length, x, y],
      [right, y, right + length, y], [right, y - length, right, y],
      [x - length, bottom, x, bottom], [x, bottom, x, bottom + length],
      [right, bottom, right + length, bottom], [right, bottom, right, bottom + length]
    ];
  });
}

function getAutoGrid(count, landscape) {
  if (count === 1) return [1, 1];
  if (count === 2) return landscape ? [2, 1] : [1, 2];
  if (count <= 4) return [2, 2];
  if (count <= 6) return landscape ? [3, 2] : [2, 3];
  if (count <= 8) return landscape ? [4, 2] : [2, 4];
  if (count === 9) return [3, 3];
  return landscape ? [4, 3] : [3, 4];
}

function toGridSize(value) {
  const size = Math.trunc(Number(value));
  return Number.isFinite(size) ? size : 0;
}
