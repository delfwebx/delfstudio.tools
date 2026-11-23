// Image Cropper by Delf Studio: turns a cropped canvas into a small file.
// Same approach as the Image Optimiser: redraw with the browser's canvas, then encode.

export class JobError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const QUALITY = { light: 0.9, balanced: 0.8, maximum: 0.6 };
const MIME = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };
const MAX_TRIES = 6;
const CLOSE_ENOUGH = 0.93;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const encode = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    try { return await createImageBitmap(file); } catch (err2) { throw new JobError('decode'); }
  }
}

async function draw(source, w, h, background) {
  let from = source;
  let resized = null;
  if (w < source.width && h < source.height) {
    try {
      resized = await createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      if (resized.width === w && resized.height === h) from = resized;
    } catch (err) { resized = null; }
  }
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new JobError('toobig');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(from, 0, 0, w, h);
  if (resized) resized.close();
  return canvas;
}

async function mustEncode(canvas, type, quality) {
  const blob = await encode(canvas, type, quality);
  if (!blob || blob.size < 32) throw new JobError('toobig');
  return blob;
}

export function fit(w, h, maxSide) {
  const longest = Math.max(w, h);
  if (!maxSide || longest <= maxSide) return [w, h];
  const s = maxSide / longest;
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

async function toTarget(source, w, h, type, background, target, lockSize) {
  const lossy = type !== 'image/png';
  const canvas = await draw(source, w, h, background);
  let reference;
  if (lossy) {
    const top = await mustEncode(canvas, type, 0.95);
    if (top.size <= target) return { blob: top, width: w, height: h, outcome: 'maxed' };
    const low = await mustEncode(canvas, type, 0.4);
    if (low.size <= target) {
      let best = low, lo = 0.4, hi = 0.95;
      for (let i = 0; i < MAX_TRIES && best.size < target * CLOSE_ENOUGH; i++) {
        const mid = (lo + hi) / 2;
        const blob = await mustEncode(canvas, type, mid);
        if (blob.size <= target) { lo = mid; if (blob.size > best.size) best = blob; } else hi = mid;
      }
      return { blob: best, width: w, height: h, outcome: 'hit' };
    }
    if (lockSize) return { blob: low, width: w, height: h, outcome: 'floor' };
    reference = await mustEncode(canvas, type, 0.7);
  } else {
    reference = await mustEncode(canvas, type);
    if (reference.size <= target) return { blob: reference, width: w, height: h, outcome: 'maxed' };
    if (lockSize) return { blob: reference, width: w, height: h, outcome: 'floor' };
  }
  // Quality alone is not enough, so make the picture itself smaller, a step at a time.
  let cw = w, ch = h, current = reference;
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(0.92, Math.sqrt(target / current.size) * 0.94);
    const nw = Math.max(16, Math.round(cw * scale));
    const nh = Math.max(16, Math.round(ch * scale));
    if (nw === cw && nh === ch) break;
    cw = nw; ch = nh;
    current = await mustEncode(await draw(source, cw, ch, background), type, lossy ? 0.7 : undefined);
    if (current.size <= target) return { blob: current, width: cw, height: ch, outcome: 'shrunk' };
  }
  return { blob: current, width: cw, height: ch, outcome: 'floor' };
}

// source: a canvas holding the cropped (and masked) picture.
// s: { level, targetBytes, format, background, outWidth, outHeight, maxSide }
export async function exportCanvas(source, s) {
  const exact = s.outWidth > 0 && s.outHeight > 0;
  const [w, h] = exact ? [s.outWidth, s.outHeight] : fit(source.width, source.height, s.maxSide);

  let format = s.format in MIME ? s.format : 'jpeg';
  let type = MIME[format];
  let webpFallback = false;
  if (format === 'webp') {
    let probe = null;
    try {
      const tiny = makeCanvas(2, 2);
      tiny.getContext('2d').fillRect(0, 0, 2, 2);
      probe = await encode(tiny, type, 0.8);
    } catch (err) { probe = null; }
    if (!probe || probe.type !== type) { format = 'jpeg'; type = MIME.jpeg; webpFallback = true; }
  }
  const background = format === 'jpeg' ? (s.background || '#ffffff') : null;

  let result;
  if (s.level === 'target') {
    result = await toTarget(source, w, h, type, background, s.targetBytes, exact);
  } else {
    const canvas = await draw(source, w, h, background);
    const blob = await mustEncode(canvas, type, format === 'png' ? undefined : (QUALITY[s.level] || QUALITY.balanced));
    result = { blob, width: w, height: h, outcome: 'preset' };
  }
  return { ...result, format, webpFallback };
}
