// Image Cropper by Delf Studio: page logic.
// Images are cropped and compressed in the browser. Nothing is uploaded.
import { decode, exportCanvas, makeCanvas, fit, JobError } from './engine.js';

const $ = (sel) => document.querySelector(sel);
const drop = $('#drop');
const work = $('#work');
const wrap = $('#wrap');
const stage = $('#stage');
const frame = $('#frame');
const hole = $('#hole');
const stageMsg = $('#stageMsg');
const info = $('#info');
const presetSel = $('#preset');
const customRow = $('#customRow');
const customW = $('#customW');
const customH = $('#customH');
const customHint = $('#customHint');
const shapeInputs = [...document.querySelectorAll('input[name="shape"]')];
const radiusRow = $('#radiusRow');
const radiusInput = $('#radius');
const outRow = $('#outRow');
const outSize = $('#outSize');
const outCustomRow = $('#outCustomRow');
const outCustom = $('#outCustom');
const levelSel = $('#level');
const targetRow = $('#targetRow');
const targetValue = $('#targetValue');
const targetUnit = $('#targetUnit');
const targetHint = $('#targetHint');
const formatSel = $('#format');
const bgRow = $('#bgRow');
const bgInput = $('#bg');
const formatNote = $('#formatNote');
const saveBtn = $('#save');
const skipBtn = $('#skip');
const list = $('#list');
const summary = $('#summary');
const downloadAllBtn = $('#downloadAll');
const renameBase = $('#renameBase');

const MAX_BYTES = 200 * 1024 * 1024;
const STAGE_MAX = 1400;       // longest side of the on-screen preview, in pixels
const CROP_MAX_AREA = 16e6;   // keeps the working canvas within what phones can handle
const EXT = { jpeg: 'jpg', webp: 'webp', png: 'png' };

let items = [];
let nextId = 1;
let current = null;   // the item open in the cropper
let bitmap = null;    // its decoded picture
let selectToken = 0;
let saving = false;
let reexportRun = 0;
let jpegChosenForShape = false;

/* ---------- helpers ---------- */

function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + units[u];
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cleanName = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
const baseOf = (filename) => filename.replace(/\.[^.]+$/, '');
const shape = () => (shapeInputs.find((i) => i.checked) || {}).value || 'rect';

/* ---------- settings ---------- */

let lastPreset = { key: 'free', ratio: null, exact: null };
function preset() {
  const v = presetSel.value;
  let p = null;
  if (v === 'free') p = { key: v, ratio: null, exact: null };
  else if (v === 'custom') {
    const w = parseInt(customW.value, 10);
    const h = parseInt(customH.value, 10);
    const ok = w >= 16 && w <= 10000 && h >= 16 && h <= 10000;
    customHint.hidden = ok;
    if (ok) p = { key: 'custom:' + w + ':' + h, ratio: w / h, exact: { w, h } };
  } else {
    const [kind, a, b] = v.split(':');
    const w = Number(a), h = Number(b);
    p = { key: v, ratio: w / h, exact: kind === 's' ? { w, h } : null };
  }
  if (v !== 'custom') customHint.hidden = true;
  if (p) lastPreset = p;
  return lastPreset;
}

function encodeSettings() {
  const level = levelSel.value;
  let targetBytes = 0;
  if (level === 'target') {
    const v = parseFloat(String(targetValue.value).replace(',', '.'));
    targetBytes = isFinite(v) && v > 0 ? Math.round(v * (targetUnit.value === 'MB' ? 1024 * 1024 : 1024)) : null;
  }
  targetHint.hidden = targetBytes !== null;
  let maxSide = 0;
  if (outSize.value === 'custom') {
    const px = parseInt(outCustom.value, 10);
    maxSide = px >= 16 && px <= 20000 ? px : 0;
  } else maxSide = Number(outSize.value) || 0;
  if (targetBytes === null) return null;
  return { level, targetBytes, format: formatSel.value, background: bgInput.value, maxSide };
}

function syncControls() {
  const p = preset();
  const s = shape();
  customRow.hidden = presetSel.value !== 'custom';
  radiusRow.hidden = s !== 'rounded';
  outRow.hidden = !!p.exact;
  outCustomRow.hidden = outSize.value !== 'custom';
  targetRow.hidden = levelSel.value !== 'target';
  const shaped = s !== 'rect';
  const f = formatSel.value;
  bgRow.hidden = !(shaped && f === 'jpeg');
  let note = '';
  if (shaped && f === 'jpeg') note = 'JPEG cannot be see-through, so the area outside the shape is filled with this colour. Choose PNG or WebP to keep it see-through.';
  else if (f === 'png') note = 'PNG keeps every detail, so the compression level does not apply and files are larger. WebP is smaller if the place you are posting accepts it.';
  else if (f === 'webp') note = 'WebP works on websites and most apps. Some older email programs cannot show it.';
  formatNote.textContent = note;
  formatNote.hidden = !note;
}

/* ---------- geometry ---------- */

function orientedSize(item, bmp) {
  return item.rot % 180 ? [bmp.height, bmp.width] : [bmp.width, bmp.height];
}

// Applies rotation and flips so later drawing happens in "what you see" coordinates.
function orient(ctx, bw, bh, rot, flipH, flipV) {
  const W = rot % 180 ? bh : bw;
  const H = rot % 180 ? bw : bh;
  ctx.translate(W / 2, H / 2);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-bw / 2, -bh / 2);
}

function defaultRect(W, H, ratio) {
  if (!ratio) return { x: 0, y: 0, w: W, h: H };
  let w = W, h = W / ratio;
  if (h > H) { h = H; w = H * ratio; }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function ensureRect(item) {
  const [W, H] = orientedSize(item, bitmap);
  const p = preset();
  const key = p.ratio ? p.ratio.toFixed(5) : 'free';
  const dims = W + 'x' + H;
  if (!item.rect || item.rectDims !== dims || (key !== 'free' && item.rectKey !== key)) item.rect = defaultRect(W, H, p.ratio);
  item.rectKey = key;
  item.rectDims = dims;
}

function resizeRect(handle, dx, dy, s, W, H, ratio) {
  const MIN = Math.max(16, Math.min(W, H) * 0.04);
  let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
  if (!ratio) {
    if (handle.includes('w')) x1 = clamp(x1 + dx, 0, x2 - MIN);
    if (handle.includes('e')) x2 = clamp(x2 + dx, x1 + MIN, W);
    if (handle.includes('n')) y1 = clamp(y1 + dy, 0, y2 - MIN);
    if (handle.includes('s')) y2 = clamp(y2 + dy, y1 + MIN, H);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  // Fixed shape: the opposite corner stays put and the frame grows from it.
  const west = handle.includes('w');
  const north = handle.includes('n');
  const ax = west ? x2 : x1;
  const ay = north ? y2 : y1;
  let w = Math.max(s.w + (west ? -dx : dx), (s.h + (north ? -dy : dy)) * ratio);
  const maxW = west ? ax : W - ax;
  const maxH = north ? ay : H - ay;
  w = Math.max(w, MIN, MIN * ratio);
  w = Math.min(w, maxW, maxH * ratio);
  const h = w / ratio;
  return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
}

function outputSize(rect, exact, maxSide) {
  if (exact) return [exact.w, exact.h];
  const cap = Math.min(1, Math.sqrt(CROP_MAX_AREA / (rect.w * rect.h)));
  return fit(Math.max(1, Math.round(rect.w * cap)), Math.max(1, Math.round(rect.h * cap)), maxSide);
}

/* ---------- stage ---------- */

function drawStage() {
  const [W, H] = orientedSize(current, bitmap);
  const k = Math.min(1, STAGE_MAX / Math.max(W, H));
  stage.width = Math.max(1, Math.round(W * k));
  stage.height = Math.max(1, Math.round(H * k));
  const ctx = stage.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(k, 0, 0, k, 0, 0);
  orient(ctx, bitmap.width, bitmap.height, current.rot, current.flipH, current.flipV);
  ctx.drawImage(bitmap, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function renderFrame() {
  if (!current || !bitmap || !current.rect) return;
  const [W, H] = orientedSize(current, bitmap);
  const r = current.rect;
  const p = preset();
  const s = shape();
  frame.style.left = (r.x / W) * 100 + '%';
  frame.style.top = (r.y / H) * 100 + '%';
  frame.style.width = (r.w / W) * 100 + '%';
  frame.style.height = (r.h / H) * 100 + '%';
  frame.classList.toggle('locked', !!p.ratio);
  let corner = '0';
  if (s === 'circle') corner = '50%';
  else if (s === 'rounded') {
    const box = wrap.getBoundingClientRect();
    const shown = Math.min((r.w / W) * box.width, (r.h / H) * box.height);
    corner = (Number(radiusInput.value) / 100) * shown + 'px';
  }
  frame.style.borderRadius = corner;
  for (const prop of ['left', 'top', 'width', 'height', 'borderRadius']) hole.style[prop] = frame.style[prop];

  const enc = encodeSettings();
  const [ow, oh] = outputSize(r, p.exact, enc ? enc.maxSide : 0);
  info.replaceChildren();
  info.append('Cropped area: ', el('b', '', Math.round(r.w) + ' × ' + Math.round(r.h) + ' px'), '. Saves at ', el('b', '', ow + ' × ' + oh + ' px'), '.');
  if (p.exact && (r.w < p.exact.w * 0.98 || r.h < p.exact.h * 0.98)) {
    info.append(el('span', 'warn', 'This area is smaller than ' + p.exact.w + ' × ' + p.exact.h + ', so it will be enlarged and may look soft. Choose a bigger area if you can.'));
  }
}

let drag = null;
frame.addEventListener('pointerdown', (e) => {
  if (!current || !bitmap || saving) return;
  if (e.button != null && e.button > 0) return;
  drag = { x: e.clientX, y: e.clientY, rect: { ...current.rect }, handle: e.target.dataset.h || 'move' };
  try { frame.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  e.preventDefault();
});
frame.addEventListener('pointermove', (e) => {
  if (!drag || !current || !bitmap) return;
  const [W, H] = orientedSize(current, bitmap);
  const scale = W / wrap.getBoundingClientRect().width;
  const dx = (e.clientX - drag.x) * scale;
  const dy = (e.clientY - drag.y) * scale;
  const s = drag.rect;
  if (drag.handle === 'move') current.rect = { x: clamp(s.x + dx, 0, W - s.w), y: clamp(s.y + dy, 0, H - s.h), w: s.w, h: s.h };
  else current.rect = resizeRect(drag.handle, dx, dy, s, W, H, preset().ratio);
  renderFrame();
});
['pointerup', 'pointercancel'].forEach((t) => frame.addEventListener(t, () => { drag = null; }));

frame.addEventListener('keydown', (e) => {
  if (!current || !bitmap || !e.key.startsWith('Arrow')) return;
  const [W, H] = orientedSize(current, bitmap);
  const step = e.shiftKey ? 0.05 : 0.01;
  const r = current.rect;
  if (e.key === 'ArrowLeft') r.x = clamp(r.x - W * step, 0, W - r.w);
  if (e.key === 'ArrowRight') r.x = clamp(r.x + W * step, 0, W - r.w);
  if (e.key === 'ArrowUp') r.y = clamp(r.y - H * step, 0, H - r.h);
  if (e.key === 'ArrowDown') r.y = clamp(r.y + H * step, 0, H - r.h);
  e.preventDefault();
  renderFrame();
});

if (typeof ResizeObserver === 'function') new ResizeObserver(() => renderFrame()).observe(wrap);

function showStageMessage(text) {
  wrap.hidden = true;
  stageMsg.hidden = false;
  stageMsg.textContent = text;
  info.replaceChildren();
  saveBtn.disabled = true;
}

/* ---------- choosing which image is open ---------- */

function closeBitmap() {
  if (bitmap) { try { bitmap.close(); } catch (err) { /* already closed */ } }
  bitmap = null;
}

const usable = (i) => !(i.status === 'error' && i.code !== 'failed' && i.code !== 'toobig');
const nextPending = (after) => {
  const idx = after ? items.indexOf(after) : -1;
  return items.slice(idx + 1).find((i) => i.status === 'pending') || items.find((i) => i.status === 'pending' && i !== after) || null;
};

async function select(item) {
  if (saving) return;
  const token = ++selectToken;
  const previous = current;
  current = item;
  closeBitmap();
  if (previous) update(previous);
  refreshButtons();
  if (!item) { showStageMessage(items.length ? 'Pick an image from the list below to crop it.' : ''); return; }
  update(item);
  showStageMessage('Opening your image.');
  let bmp;
  try {
    bmp = await decode(item.file);
  } catch (err) {
    if (token !== selectToken) return;
    item.status = 'error';
    item.code = 'decode';
    update(item);
    select(nextPending(item));
    return;
  }
  if (token !== selectToken) { bmp.close(); return; }
  bitmap = bmp;
  ensureRect(item);
  drawStage();
  wrap.hidden = false;
  stageMsg.hidden = true;
  saveBtn.disabled = false;
  renderFrame();
  refreshButtons();
}

function refreshButtons() {
  saveBtn.textContent = current && current.status === 'done' ? 'Save this crop again' : 'Crop and save';
  const pending = items.filter((i) => i.status === 'pending');
  skipBtn.hidden = !(current && pending.length > 1 && current.status === 'pending');
}

/* ---------- making the file ---------- */

function roundRectPath(ctx, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r);
  ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r);
  ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
}

async function produce(item, bmp, enc) {
  const s = item.spec;
  const { x, y, w, h } = s.rect;
  const cap = Math.min(1, Math.sqrt(CROP_MAX_AREA / (w * h)));
  const cw = Math.max(1, Math.round(w * cap));
  const ch = Math.max(1, Math.round(h * cap));
  const canvas = makeCanvas(cw, ch);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new JobError('toobig');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(cw / w, 0, 0, ch / h, 0, 0);
  ctx.translate(-x, -y);
  orient(ctx, bmp.width, bmp.height, s.rot, s.flipH, s.flipV);
  ctx.drawImage(bmp, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (s.shape !== 'rect') {
    // Keep only what is inside the shape. Everything outside becomes see-through.
    ctx.globalCompositeOperation = 'destination-in';
    if (s.shape === 'circle') { ctx.beginPath(); ctx.ellipse(cw / 2, ch / 2, cw / 2, ch / 2, 0, 0, Math.PI * 2); }
    else roundRectPath(ctx, cw, ch, (s.radius / 100) * Math.min(cw, ch));
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  const r = await exportCanvas(canvas, { ...enc, outWidth: s.exact ? s.exact.w : 0, outHeight: s.exact ? s.exact.h : 0 });
  return { blob: r.blob, url: URL.createObjectURL(r.blob), width: r.width, height: r.height, outcome: r.outcome, format: r.format, webpFallback: r.webpFallback, targetBytes: enc.targetBytes };
}

function release(item) {
  if (item.result && item.result.url) URL.revokeObjectURL(item.result.url);
  item.result = null;
}

async function saveCurrent() {
  const item = current;
  const enc = encodeSettings();
  if (!item || !bitmap || saving || !enc) return;
  const p = preset();
  saving = true;
  saveBtn.disabled = true;
  item.spec = { rect: { ...item.rect }, rot: item.rot, flipH: item.flipH, flipV: item.flipV, shape: shape(), radius: Number(radiusInput.value), exact: p.exact };
  item.status = 'saving';
  update(item);
  try {
    const res = await produce(item, bitmap, enc);
    release(item);
    item.result = res;
    item.status = 'done';
  } catch (err) {
    item.status = 'error';
    item.code = (err && err.code) || 'failed';
  }
  saving = false;
  update(item);
  refreshSummary();
  const next = nextPending(item);
  if (next) select(next);
  else { saveBtn.disabled = false; refreshButtons(); }
}

// Compression, format or picture size changed: redo the saved crops with the new choice.
async function reexport() {
  const enc = encodeSettings();
  if (!enc) return;
  const run = ++reexportRun;
  for (const item of items.filter((i) => i.spec && i.status !== 'saving' && usable(i))) {
    if (run !== reexportRun) return;
    if (!items.includes(item)) continue;
    item.status = 'saving';
    update(item);
    let bmp = null;
    try {
      bmp = await decode(item.file);
      const res = await produce(item, bmp, enc);
      if (run !== reexportRun || !items.includes(item)) { URL.revokeObjectURL(res.url); if (run !== reexportRun) return; continue; }
      release(item);
      item.result = res;
      item.status = 'done';
    } catch (err) {
      if (run !== reexportRun) return;
      item.status = 'error';
      item.code = (err && err.code) || 'failed';
    } finally {
      if (bmp) bmp.close();
    }
    update(item);
  }
  refreshSummary();
  refreshButtons();
}
let reTimer = 0;
const reexportSoon = () => { clearTimeout(reTimer); reTimer = setTimeout(reexport, 350); };

/* ---------- the list ---------- */

function errorText(item) {
  const name = item.file.name.toLowerCase();
  if (item.code === 'size') return 'This file is over 200 MB, which is more than a browser can handle.';
  if (item.code === 'decode') {
    if (/\.(heic|heif)$/.test(name)) return 'This browser cannot open HEIC photos. Open this page in Safari, or set your iPhone camera to "Most Compatible" so it saves JPEG.';
    if (/\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|raw)$/.test(name)) return 'RAW camera files cannot be opened in a browser. Export a JPEG from your camera or photo software first.';
    if (!item.file.type.startsWith('image/')) return 'This is not an image file.';
    return 'This image could not be opened. It may be damaged or in a format browsers do not support.';
  }
  if (item.code === 'toobig') return 'This crop is too large for this device. Choose a smaller picture size and save again.';
  return 'Something went wrong while saving this crop. Try saving it again.';
}

const extOf = (item) => EXT[(item.result && item.result.format) || formatSel.value] || 'jpg';
const outName = (item) => (cleanName(item.name) || 'image') + '.' + extOf(item);

function build(item) {
  const li = el('li', 'item');
  const thumb = el('div', 'thumb');
  const img = el('img');
  img.alt = '';
  thumb.append(img);
  const main = el('div', 'item-main');
  const nameRow = el('div', 'name-row');
  const input = el('input', 'name');
  input.type = 'text';
  input.value = item.name;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'File name for ' + item.file.name);
  input.addEventListener('input', () => { item.name = input.value; if (item.result) link.download = outName(item); });
  input.addEventListener('blur', () => { item.name = cleanName(input.value) || 'image'; input.value = item.name; });
  const ext = el('span', 'ext');
  nameRow.append(input, ext);
  const meta = el('div', 'item-meta');
  const note = el('div', 'item-note');
  main.append(nameRow, meta, note);

  const actions = el('div', 'item-actions');
  const link = el('a', 'btn primary', 'Download');
  const edit = el('button', 'btn', 'Crop');
  edit.type = 'button';
  edit.addEventListener('click', () => { select(item); work.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const remove = el('button', 'btn ghost', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove ' + item.file.name);
  remove.addEventListener('click', () => removeItem(item));
  actions.append(link, edit, remove);
  li.append(thumb, main, actions);
  item.nodes = { li, img, input, ext, meta, note, link, edit };
  return li;
}

function update(item) {
  const n = item.nodes;
  if (!n) return;
  const isCurrent = item === current;
  const failed = item.status === 'error';
  const dead = failed && !usable(item);
  n.li.className = 'item is-' + item.status + (isCurrent ? ' is-current' : '');
  n.ext.textContent = dead ? '' : '.' + extOf(item);
  n.input.disabled = dead;
  if (dead) n.input.value = item.file.name;

  const src = (item.result && item.result.url) || item.thumbUrl || '';
  if (src) { if (n.img.src !== src) n.img.src = src; n.img.hidden = false; } else n.img.hidden = true;

  n.meta.replaceChildren();
  let note = '';
  if (item.status === 'done') {
    const r = item.result;
    n.meta.append(el('strong', '', fmt(r.blob.size)), el('span', '', r.width + ' × ' + r.height + ' px'), el('span', 'badge', 'Cropped'));
    const target = fmt(r.targetBytes || 0);
    const parts = [];
    if (r.outcome === 'hit') parts.push('Best quality that fits under ' + target + '.');
    if (r.outcome === 'maxed') parts.push('Highest quality at this size. It comes in under your ' + target + '.');
    if (r.outcome === 'shrunk') parts.push('To get under ' + target + ', the picture was also made smaller.');
    if (r.outcome === 'floor') parts.push('This crop cannot get down to ' + target + (item.spec.exact ? ' at this exact size.' : '.') + ' This is the smallest it goes.');
    if (r.webpFallback) parts.push('This browser cannot save WebP, so it was saved as JPEG.');
    note = parts.join(' ');
  } else if (item.status === 'saving') {
    n.meta.append(el('span', '', 'Saving'));
  } else if (failed) {
    n.meta.append(el('span', '', fmt(item.file.size)));
    note = errorText(item);
  } else {
    n.meta.append(el('span', '', fmt(item.file.size)), el('span', 'badge quiet', isCurrent ? 'Open in the cropper' : 'Not cropped yet'));
  }
  n.note.textContent = note;
  n.note.hidden = !note;

  const done = item.status === 'done';
  n.link.hidden = !done;
  if (done) { n.link.href = item.result.url; n.link.download = outName(item); } else n.link.removeAttribute('href');
  n.edit.hidden = dead || isCurrent;
  n.edit.textContent = item.spec ? 'Edit crop' : 'Crop';
}

function refreshSummary() {
  const done = items.filter((i) => i.status === 'done');
  const countable = items.filter(usable);
  summary.textContent = countable.length ? done.length + ' of ' + countable.length + ' cropped' + (done.length ? ', ' + fmt(done.reduce((s, i) => s + i.result.blob.size, 0)) + ' in total.' : '.') : '';
  downloadAllBtn.hidden = done.length < 2;
  downloadAllBtn.textContent = done.length < countable.length ? 'Download the ' + done.length + ' cropped as ZIP' : 'Download all as ZIP';
  $('#renameRow').hidden = items.length < 2;
}

function removeItem(item) {
  if (saving) return;
  release(item);
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  items = items.filter((i) => i !== item);
  item.nodes.li.remove();
  if (!items.length) { resetAll(); return; }
  if (item === current) select(nextPending(null) || items.find(usable) || null);
  refreshSummary();
  refreshButtons();
}

function resetAll() {
  reexportRun++;
  selectToken++;
  items.forEach((i) => { release(i); if (i.thumbUrl) URL.revokeObjectURL(i.thumbUrl); });
  items = [];
  current = null;
  closeBitmap();
  list.replaceChildren();
  work.hidden = true;
  drop.hidden = false;
  refreshSummary();
}

/* ---------- thumbnails (made one at a time to go easy on memory) ---------- */

let thumbChain = Promise.resolve();
function queueThumb(item) {
  thumbChain = thumbChain.then(async () => {
    if (!items.includes(item) || item.thumbUrl) return;
    let bmp = null;
    try {
      bmp = await decode(item.file);
      const [w, h] = fit(bmp.width, bmp.height, 128);
      const c = makeCanvas(w, h);
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.8));
      if (blob && items.includes(item)) { item.thumbUrl = URL.createObjectURL(blob); update(item); }
    } catch (err) {
      if (items.includes(item) && item.status === 'pending' && item !== current) { item.status = 'error'; item.code = 'decode'; update(item); refreshSummary(); refreshButtons(); }
    } finally {
      if (bmp) bmp.close();
    }
  });
}

/* ---------- adding files ---------- */

function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  for (const file of files) {
    const item = { id: nextId++, file, name: cleanName(baseOf(file.name)) + '-cropped', status: 'pending', rot: 0, flipH: false, flipV: false, rect: null, spec: null, result: null, nodes: null };
    if (file.size > MAX_BYTES) { item.status = 'error'; item.code = 'size'; }
    items.push(item);
    list.append(build(item));
    update(item);
    if (item.status === 'pending') queueThumb(item);
  }
  drop.hidden = true;
  work.hidden = false;
  if (!current || !usable(current)) select(nextPending(null) || null);
  refreshSummary();
  refreshButtons();
}

/* ---------- rename all ---------- */

function renameAll() {
  const base = cleanName(renameBase.value);
  if (!base) { renameBase.focus(); return; }
  const targets = items.filter(usable);
  const pad = String(targets.length).length;
  targets.forEach((item, idx) => {
    item.name = base + '-' + String(idx + 1).padStart(pad, '0');
    item.nodes.input.value = item.name;
    if (item.result) item.nodes.link.download = outName(item);
  });
}
$('#renameAll').addEventListener('click', renameAll);
renameBase.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); renameAll(); } });

/* ---------- zip (stored: images are already compressed) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const used = new Set();
  for (const entry of entries) {
    let name = entry.name;
    const dot = name.lastIndexOf('.');
    for (let n = 2; used.has(name.toLowerCase()); n++) name = entry.name.slice(0, dot) + ' (' + n + ')' + entry.name.slice(dot);
    used.add(name.toLowerCase());
    const nameBytes = enc.encode(name);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local.buffer, nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

downloadAllBtn.addEventListener('click', async () => {
  const done = items.filter((i) => i.status === 'done');
  if (!done.length) return;
  downloadAllBtn.disabled = true;
  try {
    const zip = await buildZip(done.map((i) => ({ name: outName(i), blob: i.result.blob })));
    const url = URL.createObjectURL(zip);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cropped-images.zip';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    downloadAllBtn.disabled = false;
  }
});

/* ---------- controls ---------- */

function refreshCrop() {
  syncControls();
  if (current && bitmap) { ensureRect(current); renderFrame(); }
}

presetSel.addEventListener('change', () => {
  const p = preset();
  if (shape() === 'circle' && p.ratio && Math.abs(p.ratio - 1) > 0.001) shapeInputs.find((i) => i.value === 'rect').checked = true;
  if (shape() === 'circle' && !p.ratio) presetSel.value = 'r:1:1';
  refreshCrop();
});
[customW, customH].forEach((i) => i.addEventListener('input', refreshCrop));

shapeInputs.forEach((i) => i.addEventListener('change', () => {
  const s = shape();
  const p = preset();
  if (s === 'circle' && (!p.ratio || Math.abs(p.ratio - 1) > 0.001)) presetSel.value = 'r:1:1';
  if (s !== 'rect' && formatSel.value === 'jpeg' && !jpegChosenForShape) formatSel.value = 'png';
  refreshCrop();
  update(current || {});
  items.forEach(update);
}));
radiusInput.addEventListener('input', renderFrame);

formatSel.addEventListener('change', () => {
  if (shape() !== 'rect') jpegChosenForShape = formatSel.value === 'jpeg';
  syncControls();
  items.forEach(update);
  reexportSoon();
});
[levelSel, targetUnit, outSize].forEach((i) => i.addEventListener('change', () => { syncControls(); renderFrame(); reexportSoon(); }));
[targetValue, outCustom, bgInput].forEach((i) => i.addEventListener('input', () => { syncControls(); renderFrame(); reexportSoon(); }));

function turn(deg) {
  if (!current || !bitmap || saving) return;
  current.rot = (current.rot + deg + 360) % 360;
  const fh = current.flipH;
  current.flipH = current.flipV;
  current.flipV = fh;
  current.rect = null;
  ensureRect(current);
  drawStage();
  renderFrame();
}
function flip(axis) {
  if (!current || !bitmap || saving) return;
  const [W, H] = orientedSize(current, bitmap);
  const r = current.rect;
  if (axis === 'h') { current.flipH = !current.flipH; r.x = W - r.x - r.w; }
  else { current.flipV = !current.flipV; r.y = H - r.y - r.h; }
  drawStage();
  renderFrame();
}
$('#rotL').addEventListener('click', () => turn(-90));
$('#rotR').addEventListener('click', () => turn(90));
$('#flipH').addEventListener('click', () => flip('h'));
$('#flipV').addEventListener('click', () => flip('v'));
$('#resetCrop').addEventListener('click', () => { if (current && bitmap) { current.rect = null; ensureRect(current); renderFrame(); } });

saveBtn.addEventListener('click', saveCurrent);
skipBtn.addEventListener('click', () => { const n = nextPending(current); if (n) select(n); });
$('#clear').addEventListener('click', () => { if (!saving) resetAll(); });

[$('#file'), $('#fileMore')].forEach((input) => input.addEventListener('change', () => { addFiles(input.files); input.value = ''; }));
['dragenter', 'dragover'].forEach((type) => window.addEventListener(type, (e) => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  drop.classList.add('is-over');
}));
['dragleave', 'drop'].forEach((type) => window.addEventListener(type, (e) => {
  if (type === 'dragleave' && e.relatedTarget) return;
  drop.classList.remove('is-over');
}));
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

if (typeof createImageBitmap !== 'function') {
  $('#unsupported').hidden = false;
  drop.classList.add('is-disabled');
  $('#file').disabled = true;
}
syncControls();
