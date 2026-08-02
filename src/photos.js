export const MAX_PHOTOS = 12;

export function getPhotoSelectionError(selectedCount, acceptedCount, totalCount) {
  if (acceptedCount < 1 || acceptedCount !== selectedCount) return "needPhotos";
  return totalCount > MAX_PHOTOS ? "photoLimit" : null;
}

export function moveItem(items, fromIndex, toIndex) {
  const copy = [...items];
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= copy.length || toIndex < 0 || toIndex >= copy.length) return copy;
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item);
  return copy;
}

export function removeItem(items, index) {
  const copy = [...items];
  if (index >= 0 && index < copy.length) copy.splice(index, 1);
  return copy;
}

export async function createPhoto(file) {
  return {
    source: await loadOrientedImage(file),
    edit: { rotation: 0, flipX: false, flipY: false }
  };
}

export function disposePhotos(photos) {
  for (const photo of photos) {
    if (typeof photo.source.close === "function") photo.source.close();
  }
}

export function editPhoto(photo, action) {
  if (action === "rotateLeft") photo.edit.rotation = (photo.edit.rotation + 270) % 360;
  if (action === "rotateRight") photo.edit.rotation = (photo.edit.rotation + 90) % 360;
  if (action === "flipHorizontal") photo.edit.flipX = !photo.edit.flipX;
  if (action === "flipVertical") photo.edit.flipY = !photo.edit.flipY;
}

async function loadOrientedImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {}
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("IMAGE_DECODE_FAILED")); };
    image.src = url;
  });
}
