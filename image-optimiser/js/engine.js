// Image Optimiser by Delf Studio: the part that does the work.
// Used inside a worker when the browser allows it, and on the page itself otherwise.

const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

export class JobError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const QUALITY = { light: 0.9, balanced: 0.8, maximum: 0.6 };
const MIME = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };
const MAX_TRIES = 6;       // quality steps tried when aiming for a file size
const CLOSE_ENOUGH = 0.93; // this close under the target is good enough

function makeCanvas(w, h) {
  if (hasOffscreen) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function encode(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(file) {
  try {
    // from-image turns phone photos the right way up.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    try { return await createImageBitmap(file); } catch (err2) { throw new JobError('decode'); }
  }
}

async function draw(bitmap, w, h, background) {
  let source = bitmap;
  let resized = null;
  if (w < bitmap.width || h < bitmap.height) {
    // The browser's own high-quality resize gives cleaner results on big reductions.
    try {
      resized = await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      if (resized.width === w && resized.height === h) source = resized;
    } catch (err) { resized = null; }
  }
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new JobError('toobig');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  if (resized) resized.close();
  return canvas;
}

function hasTransparency(bitmap) {
  try {
    const c = makeCanvas(48, 48);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 48, 48);
    const data = ctx.getImageData(0, 0, 48, 48).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  } catch (err) { /* treat as opaque */ }
  return false;
}

function fit(w, h, maxSide) {
  const longest = Math.max(w, h);
  if (!maxSide || longest <= maxSide) return [w, h];
  const s = maxSide / longest;
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

async function mustEncode(canvas, type, quality) {
  const blob = await encode(canvas, type, quality);
  if (!blob || blob.size < 32) throw new JobError('toobig');
  return blob;
}

async function toTarget(bitmap, w, h, type, background, target, progress) {
  let attempt = 0;
  const lossy = type !== 'image/png';
  const canvas = await draw(bitmap, w, h, background);
  const tryAt = (q) => { progress(++attempt); return mustEncode(canvas, type, q); };

  let reference;
  if (lossy) {
    const top = await tryAt(0.95);
    if (top.size <= target) return { blob: top, width: w, height: h, outcome: 'maxed' };
    const low = await tryAt(0.4);
    if (low.size <= target) {
      let best = low;
      let lo = 0.4;
      let hi = 0.95;
      for (let i = 0; i < MAX_TRIES && best.size < target * CLOSE_ENOUGH; i++) {
        const mid = (lo + hi) / 2;
        const blob = await tryAt(mid);
        if (blob.size <= target) { lo = mid; if (blob.size > best.size) best = blob; } else hi = mid;
      }
      return { blob: best, width: w, height: h, outcome: 'hit' };
    }
    reference = await tryAt(0.7);
  } else {
    reference = await tryAt();
    if (reference.size <= target) return { blob: reference, width: w, height: h, outcome: 'maxed' };
  }

  // Quality alone is not enough, so make the picture itself smaller, a step at a time.
  let cw = w;
  let ch = h;
  let current = reference;
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(0.92, Math.sqrt(target / current.size) * 0.94);
    const nw = Math.max(16, Math.round(cw * scale));
    const nh = Math.max(16, Math.round(ch * scale));
    if (nw === cw && nh === ch) break;
    cw = nw;
    ch = nh;
    progress(++attempt);
    current = await mustEncode(await draw(bitmap, cw, ch, background), type, lossy ? 0.7 : undefined);
    if (current.size <= target) return { blob: current, width: cw, height: ch, outcome: 'shrunk' };
  }
  return { blob: current, width: cw, height: ch, outcome: 'floor' };
}

// settings: { level: light|balanced|maximum|target, targetBytes, maxSide (0 keeps size), format: jpeg|webp|png }
export async function optimise(file, settings, progress = () => {}) {
  const bitmap = await decode(file);
  try {
    const srcWidth = bitmap.width;
    const srcHeight = bitmap.height;
    const [w, h] = fit(srcWidth, srcHeight, settings.maxSide);

    let format = settings.format in MIME ? settings.format : 'jpeg';
    let type = MIME[format];
    let webpFallback = false;
    if (format === 'webp') {
      // Some browsers cannot write WebP and quietly hand back a PNG instead.
      let probe = null;
      try {
        const tiny = makeCanvas(2, 2);
        tiny.getContext('2d').fillRect(0, 0, 2, 2);
        probe = await encode(tiny, type, 0.8);
      } catch (err) { probe = null; }
      if (!probe || probe.type !== type) { format = 'jpeg'; type = MIME.jpeg; webpFallback = true; }
    }
    const flattened = format === 'jpeg' && hasTransparency(bitmap);
    const background = format === 'jpeg' ? '#ffffff' : null;

    let result;
    if (settings.level === 'target') {
      result = await toTarget(bitmap, w, h, type, background, settings.targetBytes, progress);
    } else {
      const canvas = await draw(bitmap, w, h, background);
      const blob = await mustEncode(canvas, type, format === 'png' ? undefined : (QUALITY[settings.level] || QUALITY.balanced));
      result = { blob, width: w, height: h, outcome: 'preset' };
    }
    return { ...result, srcWidth, srcHeight, format, flattened, webpFallback };
  } finally {
    bitmap.close();
  }
}
