// Image handling in the browser: resize + convert to WebP (like the desktop app),
// keep new images until publish (IndexedDB, so a refresh doesn't lose them), and show previews.

import { RAW } from './github.js';

export const THUMB_MAX = 1280;
export const GALLERY_MAX = 1920;

/** Resize so the longest side is at most `maxSide`, and encode as WebP (JPEG if the browser can't). */
export async function convert(fileOrBlob, maxSide) {
  let bmp;
  try {
    bmp = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("This browser can't read that image. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  let blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
  return { blob, ext: blob.type === 'image/webp' ? 'webp' : 'jpg', width: canvas.width, height: canvas.height };
}

export async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}

// ------------------------------------------------------------------ pending uploads

/** repo path ("images/thumbnails/...") → Blob, for images added since the last publish */
export const pending = new Map();
const urls = new Map();

export function addPending(path, blob) {
  pending.set(path, blob);
  if (urls.has(path)) URL.revokeObjectURL(urls.get(path));
  urls.set(path, URL.createObjectURL(blob));
  idb('put', path, blob);
}

/** After publishing: nothing is pending any more, but keep showing the local copies until the
 *  site has redeployed (the live /images/... file can take a minute or two to appear). */
export function markPublished() {
  pending.clear();
  idb('clear');
}

export function clearPending() {
  pending.clear();
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
  idb('clear');
}

export async function restorePending() {
  const all = await idb('all');
  for (const { key, value } of all || []) addPending(key, value);
}

/** Remove pending images the data no longer points at (e.g. after undo or replace). */
export function prunePending(usedPaths) {
  for (const path of [...pending.keys()]) {
    if (!usedPaths.has(path)) {
      pending.delete(path);
      URL.revokeObjectURL(urls.get(path));
      urls.delete(path);
      idb('delete', path);
    }
  }
}

/** Repo path for a thumbnail or gallery value (handles "/images/..." values too). */
export function repoPath(kind, value) {
  if (!value) return '';
  return value.startsWith('/') ? value.slice(1) : `images/${kind}/${value}`;
}

/** Best URL to show an image: a pending upload, the live site, or GitHub (if not deployed yet). */
export function src(kind, value, version) {
  const path = repoPath(kind, value);
  if (!path) return '';
  // version (e.g. the project's "updated" time) skips a cached old copy after an image is replaced
  return urls.get(path) || `/${path}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

/** If an image isn't on the live site yet (just published), fall back to GitHub's copy. */
export function withFallback(img, kind, value) {
  img.onerror = () => {
    img.onerror = null;
    img.src = RAW + repoPath(kind, value);
  };
  return img;
}

// ------------------------------------------------------------------ tiny IndexedDB helper

function idb(op, key, value) {
  return new Promise(resolve => {
    let req;
    try {
      req = indexedDB.open('portfolio-admin', 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore('pending');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const tx = req.result.transaction('pending', op === 'all' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('pending');
      if (op === 'put') store.put(value, key);
      if (op === 'delete') store.delete(key);
      if (op === 'clear') store.clear();
      if (op === 'all') {
        const out = [];
        store.openCursor().onsuccess = e => {
          const c = e.target.result;
          if (c) {
            out.push({ key: c.key, value: c.value });
            c.continue();
          }
        };
        tx.oncomplete = () => resolve(out);
      } else {
        tx.oncomplete = () => resolve(true);
      }
      tx.onerror = () => resolve(null);
    };
  });
}
