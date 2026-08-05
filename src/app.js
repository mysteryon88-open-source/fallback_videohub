import { canvasToJpeg, canvasToPdfBlob, canvasToPng, createPrintController, downloadBlob } from "./export.js";
import { translate } from "./i18n.js";
import { buildSheetPlan, getCustomGridDefaults, getPhotoIndexFromViewportPoint, resolvePaper } from "./layout.js";
import { MAX_PHOTOS, createPhoto, disposePhotos, editPhoto, getPhotoSelectionError, moveItem, removeItem } from "./photos.js";
import { renderSheet } from "./renderer.js";

const RENDER_DELAY_MS = 90;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/x-ms-bmp"]);
const photoToolIcons = {
  rotateLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V3h5"/><path d="M4.5 8A8 8 0 1 1 7 18.5"/></svg>',
  rotateRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8V3h-5"/><path d="M19.5 8A8 8 0 1 0 17 18.5"/></svg>',
  flipHorizontal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M10 5 4 12l6 7V5Zm4 0 6 7-6 7V5Z"/></svg>',
  flipVertical: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M5 10l7-6 7 6H5Zm0 4 7 6 7-6H5Z"/></svg>',
  removePhoto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
  addPhotos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h10v14H4zM7 15l2-2 2 2 3-3"/><path d="M19 8v8M15 12h8"/></svg>',
  clearCanvas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'
};
const byId = id => document.getElementById(id);

const elements = {
  sidebar: document.querySelector(".sidebar"),
  canvas: byId("preview"),
  reorderTarget: byId("reorderTarget"),
  emptyPreview: byId("emptyPreview"),
  previewStage: document.querySelector(".preview-stage"),
  fileInput: byId("files"),
  replacePhotos: byId("replacePhotos"),
  addPhotos: byId("addPhotos"),
  drop: byId("drop"),
  photoMenu: byId("photoMenu"),
  status: byId("status"),
  exportFormat: byId("exportFormat"),
  saveFile: byId("saveFile"),
  print: byId("print"),
  language: byId("language"),
  theme: byId("theme"),
  paper: byId("paper"),
  orientation: byId("orientation"),
  dpi: byId("dpi"),
  gridMode: byId("gridMode"),
  customGridFields: byId("customGridFields"),
  columns: byId("columns"),
  rows: byId("rows"),
  margin: byId("margin"),
  marginValue: byId("marginValue"),
  gap: byId("gap"),
  gapValue: byId("gapValue"),
  cutMarks: byId("cutMarks")
};

const printController = createPrintController(byId("printImage"), byId("pageStyle"));
let locale = localStorage.getItem("locale") === "en" ? "en" : "ru";
let photos = [];
let selectedPhotoIndex = 0;
let lastPng = null;
let lastPlan = null;
let lastFilename = "photo-sheet";
let renderTimer = 0;
let renderVersion = 0;
let loadVersion = 0;
let fileInputMode = "replace";
let statusState = { key: null, values: {} };

bindEvents();
setTheme(localStorage.getItem("theme") === "dark" ? "dark" : "light");
setLocale(locale);
syncConditionalControls();
syncPhotoControls();

function bindEvents() {
  elements.language.addEventListener("click", () => setLocale(locale === "ru" ? "en" : "ru"));
  elements.theme.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !elements.photoMenu.hidden) closePhotoMenu();
  });
  bindCanvasReorder();

  elements.replacePhotos.addEventListener("click", () => openFilePicker("replace"));
  elements.addPhotos.addEventListener("click", () => openFilePicker("add"));
  elements.fileInput.addEventListener("change", () => {
    const files = [...elements.fileInput.files];
    elements.fileInput.value = "";
    if (files.length > 0) loadPhotos(files, fileInputMode);
  });
  bindFileDrop(elements.drop);
  bindFileDrop(elements.previewStage);

  for (const select of [elements.paper, elements.orientation, elements.dpi, elements.gridMode]) {
    select.addEventListener("change", () => {
      if (select === elements.gridMode && select.value === "custom") {
        const defaults = getCustomGridDefaults(lastPlan, Number(elements.columns.value), Number(elements.rows.value));
        elements.columns.value = String(defaults.columns);
        elements.rows.value = String(defaults.rows);
      }
      syncConditionalControls();
      scheduleRender();
    });
  }
  for (const input of [elements.columns, elements.rows]) {
    input.addEventListener("input", scheduleRender);
  }
  elements.cutMarks.addEventListener("change", scheduleRender);
  bindRange(elements.margin, elements.marginValue);
  bindRange(elements.gap, elements.gapValue);

  elements.photoMenu.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    event.stopPropagation();
    applySelectedPhotoAction(button.dataset.action);
    closePhotoMenu();
  });
  elements.previewStage.addEventListener("contextmenu", openPhotoMenu);
  elements.previewStage.addEventListener("keydown", event => {
    if (photos.length > 0 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      if (event.altKey) movePhoto(selectedPhotoIndex, selectedPhotoIndex + delta);
      else {
        selectedPhotoIndex = Math.max(0, Math.min(photos.length - 1, selectedPhotoIndex + delta));
        syncPhotoControls();
      }
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openPhotoMenu(event);
  });
  document.addEventListener("pointerdown", event => {
    if (!elements.photoMenu.contains(event.target)) closePhotoMenu();
  });
  window.addEventListener("resize", () => {
    closePhotoMenu();
    hideReorderTarget();
  });

  elements.saveFile.addEventListener("click", saveSelectedFile);
  elements.print.addEventListener("click", printSheet);
  window.addEventListener("beforeunload", () => {
    disposePhotos(photos);
    printController.cleanup();
  });
}

function openFilePicker(mode) {
  if (mode === "add" && photos.length >= MAX_PHOTOS) {
    showStatus("photoLimit");
    return;
  }
  fileInputMode = mode;
  elements.fileInput.click();
}

function bindFileDrop(target) {
  for (const eventName of ["dragenter", "dragover"]) {
    target.addEventListener(eventName, event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      target.classList.add("drag");
    });
  }
  target.addEventListener("dragleave", event => {
    if (!target.contains(event.relatedTarget)) target.classList.remove("drag");
  });
  target.addEventListener("drop", event => {
    event.preventDefault();
    target.classList.remove("drag");
    loadPhotos([...event.dataTransfer.files], "add");
  });
}

function bindRange(slider, numberInput) {
  const apply = value => Math.min(Number(slider.max), Math.max(Number(slider.min), Number(value)));
  slider.addEventListener("input", () => {
    numberInput.value = slider.value;
    scheduleRender();
  });
  numberInput.addEventListener("input", () => {
    if (numberInput.value === "" || !Number.isFinite(Number(numberInput.value))) return;
    slider.value = String(apply(numberInput.value));
    scheduleRender();
  });
  numberInput.addEventListener("change", () => {
    const value = apply(numberInput.value || slider.value);
    slider.value = String(value);
    numberInput.value = String(value);
    scheduleRender();
  });
}

async function loadPhotos(files, mode) {
  const version = ++loadVersion;
  const accepted = files.filter(isSupportedImage);
  const totalCount = mode === "add" ? photos.length + accepted.length : accepted.length;
  const selectionError = getPhotoSelectionError(files.length, accepted.length, totalCount);
  if (selectionError) {
    showStatus(selectionError);
    return;
  }

  clearTimeout(renderTimer);
  closePhotoMenu();
  renderVersion++;
  showStatus("loading");
  const results = await Promise.allSettled(accepted.map(createPhoto));
  const loaded = results.filter(result => result.status === "fulfilled").map(result => result.value);
  if (version !== loadVersion) {
    disposePhotos(loaded);
    return;
  }
  if (results.some(result => result.status === "rejected")) {
    disposePhotos(loaded);
    showStatus("error");
    return;
  }

  const nextPhotos = mode === "add" ? [...photos, ...loaded] : loaded;
  if (mode === "replace") disposePhotos(photos);
  photos = nextPhotos;
  selectedPhotoIndex = mode === "add" ? photos.length - loaded.length : 0;
  syncConditionalControls();
  syncPhotoControls();
  await renderSelection();
}

function isSupportedImage(file) {
  return supportedTypes.has(file.type) || /\.(jpe?g|png|webp|bmp)$/i.test(file.name);
}

function syncPhotoControls() {
  elements.addPhotos.hidden = photos.length === 0;
  elements.addPhotos.disabled = photos.length >= MAX_PHOTOS;
  elements.replacePhotos.textContent = t(photos.length === 0 ? "choosePhotos" : "replacePhotos");
  selectedPhotoIndex = Math.min(selectedPhotoIndex, Math.max(0, photos.length - 1));
  elements.sidebar.classList.toggle("has-photos", photos.length > 0);
  elements.canvas.classList.toggle("reorderable", photos.length > 1);
  const labelKey = photos.length > 1 ? "canvasReorderLabel" : photos.length === 1 ? "canvasPhotoLabel" : "previewLabel";
  elements.previewStage.setAttribute("aria-label", t(labelKey, {
    number: selectedPhotoIndex + 1,
    count: photos.length
  }));
}

function getCanvasPhotoIndex(event) {
  if (elements.canvas.hidden || !lastPlan) return -1;
  return getPhotoIndexFromViewportPoint(
    lastPlan.cells,
    elements.canvas.getBoundingClientRect(),
    elements.canvas,
    { x: event.clientX, y: event.clientY }
  );
}

function getPhotoCellViewportRect(photoIndex) {
  const cell = lastPlan?.cells.find(item => item.photoIndex === photoIndex);
  if (!cell || elements.canvas.hidden) return null;
  const bounds = elements.canvas.getBoundingClientRect();
  const scaleX = elements.canvas.clientWidth / elements.canvas.width;
  const scaleY = elements.canvas.clientHeight / elements.canvas.height;
  return {
    left: bounds.left + elements.canvas.clientLeft + cell.x * scaleX,
    top: bounds.top + elements.canvas.clientTop + cell.y * scaleY,
    width: cell.width * scaleX,
    height: cell.height * scaleY
  };
}

function showReorderTarget(photoIndex) {
  const rect = getPhotoCellViewportRect(photoIndex);
  elements.reorderTarget.hidden = !rect;
  if (!rect) return;
  Object.assign(elements.reorderTarget.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
}

function hideReorderTarget() {
  elements.reorderTarget.hidden = true;
}

function bindCanvasReorder() {
  let drag = null;

  elements.canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || photos.length === 0) return;
    const photoIndex = getCanvasPhotoIndex(event);
    if (photoIndex < 0) return;
    selectedPhotoIndex = photoIndex;
    syncPhotoControls();
    elements.previewStage.focus({ preventScroll: true });
    if (photos.length < 2) return;
    drag = {
      pointerId: event.pointerId,
      fromIndex: photoIndex,
      targetIndex: photoIndex,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
  });

  window.addEventListener("pointermove", event => {
    if (drag?.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.active = true;
    elements.canvas.classList.add("reordering");
    closePhotoMenu();
    drag.targetIndex = getCanvasPhotoIndex(event);
    showReorderTarget(drag.targetIndex);
    event.preventDefault();
  });

  window.addEventListener("pointerup", event => finishPhotoDrag(event, true));
  window.addEventListener("pointercancel", event => finishPhotoDrag(event, false));

  function finishPhotoDrag(event, shouldMove) {
    if (drag?.pointerId !== event.pointerId) return;
    const { active, fromIndex, targetIndex } = drag;
    drag = null;
    elements.canvas.classList.remove("reordering");
    hideReorderTarget();
    if (active && shouldMove && targetIndex >= 0) movePhoto(fromIndex, targetIndex);
  }
}

function applySelectedPhotoAction(action) {
  if (action === "addPhotos") return openFilePicker("add");
  if (action === "clearCanvas") return clearPhotos();
  if (action === "removePhoto") return removeSelectedPhoto();
  if (!photos[selectedPhotoIndex]) return;
  editPhoto(photos[selectedPhotoIndex], action);
  syncPhotoControls();
  scheduleRender();
}

function openPhotoMenu(event) {
  const photoIndex = event.type === "keydown" ? (photos.length > 0 ? selectedPhotoIndex : -1) : getCanvasPhotoIndex(event);
  event.preventDefault();
  if (photoIndex >= 0) {
    selectedPhotoIndex = photoIndex;
    syncPhotoControls();
  }
  renderPhotoMenu(photoIndex);
  elements.photoMenu.hidden = false;
  const cellBounds = getPhotoCellViewportRect(photoIndex);
  const stageBounds = elements.previewStage.getBoundingClientRect();
  const hasPointerPosition = Number.isFinite(event.clientX) && event.clientX > 0;
  const left = hasPointerPosition ? event.clientX : cellBounds?.left ?? stageBounds.left + 10;
  const top = hasPointerPosition ? event.clientY : cellBounds ? cellBounds.top + cellBounds.height : stageBounds.top + 10;
  elements.photoMenu.style.left = `${Math.max(10, Math.min(left, window.innerWidth - elements.photoMenu.offsetWidth - 10))}px`;
  elements.photoMenu.style.top = `${Math.max(10, Math.min(top, window.innerHeight - elements.photoMenu.offsetHeight - 10))}px`;
  if (event.type === "keydown") elements.photoMenu.querySelector("button")?.focus({ preventScroll: true });
}

function renderPhotoMenu(photoIndex) {
  const title = document.createElement("div");
  title.className = "photo-menu-title";
  title.textContent = photoIndex >= 0 ? t("photoNumber", { number: photoIndex + 1 }) : t("canvasActions");
  const createButton = action => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.classList.toggle("danger", action === "removePhoto" || action === "clearCanvas");
    button.disabled = (action === "addPhotos" && photos.length >= MAX_PHOTOS) || (action === "clearCanvas" && photos.length === 0);
    button.setAttribute("role", "menuitem");
    button.innerHTML = `${photoToolIcons[action]}<span>${t(action)}</span>`;
    return button;
  };
  const photoActions = photoIndex >= 0
    ? ["rotateLeft", "rotateRight", "flipHorizontal", "flipVertical", "removePhoto"].map(createButton)
    : [];
  const separator = document.createElement("div");
  separator.className = "photo-menu-separator";
  separator.setAttribute("role", "separator");
  elements.photoMenu.replaceChildren(
    title,
    ...photoActions,
    ...(photoActions.length > 0 ? [separator] : []),
    createButton("addPhotos"),
    createButton("clearCanvas")
  );
}

function closePhotoMenu() {
  elements.photoMenu.hidden = true;
}

function clearPhotos() {
  loadVersion++;
  clearTimeout(renderTimer);
  renderVersion++;
  disposePhotos(photos);
  photos = [];
  selectedPhotoIndex = 0;
  syncConditionalControls();
  syncPhotoControls();
  disableExports();
  elements.canvas.hidden = true;
  elements.emptyPreview.hidden = false;
  showStatus(null);
}

function removeSelectedPhoto() {
  const removed = photos[selectedPhotoIndex];
  if (!removed) return;
  clearTimeout(renderTimer);
  renderVersion++;
  photos = removeItem(photos, selectedPhotoIndex);
  disposePhotos([removed]);
  selectedPhotoIndex = Math.min(selectedPhotoIndex, Math.max(0, photos.length - 1));
  syncConditionalControls();
  syncPhotoControls();
  if (photos.length > 0) {
    renderSelection();
    return;
  }
  disableExports();
  elements.canvas.hidden = true;
  elements.emptyPreview.hidden = false;
  showStatus(null);
}

function movePhoto(fromIndex, toIndex) {
  if (fromIndex === toIndex || toIndex < 0 || toIndex >= photos.length) return;
  const selectedPhoto = photos[selectedPhotoIndex];
  photos = moveItem(photos, fromIndex, toIndex);
  selectedPhotoIndex = photos.indexOf(selectedPhoto);
  syncPhotoControls();
  scheduleRender();
}

function syncConditionalControls() {
  elements.customGridFields.hidden = elements.gridMode.value !== "custom";
  elements.previewStage.dataset.orientation = elements.orientation.value;
}

function scheduleRender() {
  clearTimeout(renderTimer);
  closePhotoMenu();
  if (photos.length === 0) return;
  renderVersion++;
  disableExports();
  showStatus("processing");
  renderTimer = setTimeout(renderSelection, RENDER_DELAY_MS);
}

async function renderSelection() {
  if (photos.length === 0) return;
  const version = ++renderVersion;
  let plan;
  disableExports();
  showStatus("processing");

  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    plan = readPlan();
    renderSheet(elements.canvas, photos, plan, elements.cutMarks.checked);
    const png = await canvasToPng(elements.canvas, plan.dpi);
    if (version !== renderVersion) return;

    lastPlan = plan;
    lastPng = png;
    lastFilename = buildFilename(plan);
    elements.canvas.hidden = false;
    elements.emptyPreview.hidden = true;
    elements.saveFile.disabled = false;
    elements.print.disabled = false;
    showStatus("ready", {
      width: plan.widthPx,
      height: plan.heightPx,
      columns: plan.columns,
      rows: plan.rows,
      copies: plan.cells.length
    });
  } catch (error) {
    if (version !== renderVersion) return;
    lastPng = null;
    elements.canvas.hidden = true;
    elements.emptyPreview.hidden = false;
    if (error?.message === "TOO_LARGE" && plan) {
      lastPlan = plan;
      lastFilename = buildFilename(plan);
      elements.canvas.width = 0;
      elements.canvas.height = 0;
      elements.saveFile.disabled = false;
      showStatus("tooLarge");
      return;
    }
    lastPlan = null;
    showStatus(errorMessageKey(error));
  }
}

function readPlan() {
  const paper = resolvePaper(elements.paper.value, elements.orientation.value);
  return buildSheetPlan({
    paper,
    dpi: Number(elements.dpi.value),
    marginMm: Number(elements.margin.value),
    gapMm: Number(elements.gap.value),
    gridMode: elements.gridMode.value,
    columns: Number(elements.columns.value),
    rows: Number(elements.rows.value),
    photoCount: photos.length
  });
}

function buildFilename(plan) {
  const contents = photos.length === 1 ? `${plan.cells.length}-copies` : `${photos.length}-photos`;
  return `${elements.paper.value}_${contents}_${plan.dpi}dpi`;
}

async function saveSelectedFile() {
  if (!lastPlan) return;
  elements.saveFile.disabled = true;
  const exportCanvas = lastPng ? elements.canvas : document.createElement("canvas");
  try {
    if (!lastPng) {
      showStatus("processing");
      await new Promise(resolve => requestAnimationFrame(resolve));
      renderSheet(exportCanvas, photos, lastPlan, elements.cutMarks.checked, Infinity);
    }
    const format = elements.exportFormat.value;
    const blob = format === "pdf"
      ? await canvasToPdfBlob(exportCanvas, lastPlan)
      : format === "jpg" ? await canvasToJpeg(exportCanvas, lastPlan.dpi) : lastPng ?? await canvasToPng(exportCanvas, lastPlan.dpi);
    downloadBlob(blob, `${lastFilename}.${format}`);
    if (!lastPng) showStatus("tooLarge");
  } catch {
    showStatus("error");
  } finally {
    if (!lastPng) {
      exportCanvas.width = 0;
      exportCanvas.height = 0;
    }
    elements.saveFile.disabled = !lastPlan;
  }
}

async function printSheet() {
  if (!lastPng || !lastPlan) return;
  elements.print.disabled = true;
  try {
    await printController.print(lastPng, lastPlan);
  } catch {
    showStatus("error");
  } finally {
    elements.print.disabled = !lastPlan;
  }
}

function disableExports() {
  lastPng = null;
  lastPlan = null;
  elements.saveFile.disabled = true;
  elements.print.disabled = true;
}

function errorMessageKey(error) {
  return {
    TOO_LARGE: "tooLarge",
    GRID_TOO_SMALL: "gridTooSmall",
    CELLS_DO_NOT_FIT: "cellsDoNotFit",
    INVALID_PAPER: "invalidPaper"
  }[error?.message] ?? "error";
}

function setLocale(nextLocale) {
  closePhotoMenu();
  locale = nextLocale;
  localStorage.setItem("locale", locale);
  document.documentElement.lang = locale;
  document.title = t("pageTitle");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  elements.language.textContent = locale === "ru" ? "EN" : "RU";
  elements.language.setAttribute("aria-label", t(locale === "ru" ? "switchEnglish" : "switchRussian"));
  elements.theme.setAttribute("aria-label", t(document.documentElement.dataset.theme === "dark" ? "lightTheme" : "darkTheme"));
  syncPhotoControls();
  renderStatus();
}

function setTheme(nextTheme) {
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("theme", nextTheme);
  elements.theme.textContent = nextTheme === "dark" ? "☀" : "☾";
  elements.theme.setAttribute("aria-label", t(nextTheme === "dark" ? "lightTheme" : "darkTheme"));
}

function showStatus(key, values = {}) {
  statusState = { key, values };
  renderStatus();
}

function renderStatus() {
  const isLimitError = statusState.key === "photoLimit";
  elements.status.textContent = statusState.key ? t(statusState.key, statusState.values) : "";
  elements.status.classList.toggle("status-error", isLimitError);
  elements.status.setAttribute("aria-live", isLimitError ? "assertive" : "polite");
}

function t(key, values) {
  return translate(locale, key, values);
}
