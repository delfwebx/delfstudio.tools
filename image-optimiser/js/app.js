// Image Optimiser by Delf Studio: page logic.
// Images are processed in the browser. Nothing is uploaded.
import { optimise } from './engine.js';

const $ = (sel) => document.querySelector(sel);
const drop = $('#drop');
const fileInput = $('#file');
const list = $('#list');
const results = $('#results');
const summary = $('#summary');
const downloadAllBtn = $('#downloadAll');
const clearBtn = $('#clear');
const levelInputs = [...document.querySelectorAll('input[name="level"]')];
const sideInputs = [...document.querySelectorAll('input[name="side"]')];
const formatSel = $('#format');
const targetRow = $('#targetRow');
const targetValue = $('#targetValue');
const targetUnit = $('#targetUnit');
const targetHint = $('#targetHint');
const sideRow = $('#sideRow');
const customSide = $('#customSide');
const sideHint = $('#sideHint');
const renameBase = $('#renameBase');
const renameBtn = $('#renameAll');

const MAX_BYTES = 200 * 1024 * 1024;
const EXT = { jpeg: 'jpg', webp: 'webp', png: 'png' };

let items = [];
let nextId = 1;
let nextJob = 1;
let active = null; // { id, job, stale }
let worker = null;

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

const cleanName = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
const baseOf = (filename) => filename.replace(/\.[^.]+$/, '');
const checked = (inputs) => (inputs.find((i) => i.checked) || {}).value;

/* ---------- settings ---------- */

function readTarget() {
  const v = parseFloat(String(targetValue.value).replace(',', '.'));
  if (!isFinite(v) || v <= 0) return null;
  return Math.round(v * (targetUnit.value === 'MB' ? 1024 * 1024 : 1024));
}

function readSide() {
  const v = checked(sideInputs);
  if (v !== 'custom') return Number(v) || 0;
  const px = parseInt(customSide.value, 10);
  return isFinite(px) && px >= 16 && px <= 20000 ? px : null;
}

// Returns the current settings, or null while a custom box holds something unusable.
function readSettings() {
  const level = checked(levelInputs) || 'balanced';
  const targetBytes = level === 'target' ? readTarget() : 0;
  const maxSide = readSide();
  targetHint.hidden = !(level === 'target' && targetBytes === null);
  sideHint.hidden = maxSide !== null;
  if (targetBytes === null || maxSide === null) return null;
  return { level, targetBytes, maxSide, format: formatSel.value };
}

let lastSettings = { level: 'balanced', targetBytes: 0, maxSide: 0, format: 'jpeg' };
function settings() {
  const s = readSettings();
  if (s) lastSettings = s;
  return lastSettings;
}

function syncRows() {
  targetRow.hidden = checked(levelInputs) !== 'target';
  sideRow.hidden = checked(sideInputs) !== 'custom';
}

/* ---------- running jobs ---------- */

function startWorker() {
  worker = null;
  if (typeof Worker !== 'function' || typeof OffscreenCanvas === 'undefined') return;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.id, m.job, m.attempt);
      else if (m.type === 'done') onDone(m.id, m.job, m.result);
      else if (m.type === 'error') onError(m.id, m.job, m.code);
    };
    worker.onerror = () => {
      const a = active;
      worker.terminate();
      startWorker();
      if (a) onError(a.id, a.job, 'toobig');
    };
  } catch (err) { worker = null; }
}

function pump() {
  if (active) return;
  const item = items.find((i) => i.status === 'queued');
  if (!item) { refreshSummary(); return; }
  const job = nextJob++;
  active = { id: item.id, job, stale: false };
  item.status = 'working';
  item.attempt = 0;
  update(item);
  refreshSummary();
  if (worker) {
    worker.postMessage({ type: 'job', id: item.id, job, file: item.file, settings: item.settings });
  } else {
    optimise(item.file, item.settings, (a) => onProgress(item.id, job, a))
      .then((r) => onDone(item.id, job, r), (e) => onError(item.id, job, (e && e.code) || 'failed'));
  }
}

function current(id, job) {
  if (!active || active.job !== job) return null;
  if (active.stale) { active = null; pump(); return null; }
  return items.find((i) => i.id === id) || (active = null, pump(), null);
}

function onProgress(id, job, attempt) {
  if (!active || active.job !== job || active.stale) return;
  const item = items.find((i) => i.id === id);
  if (item) { item.attempt = attempt; update(item); }
}

function onDone(id, job, r) {
  const item = current(id, job);
  if (!item) return;
  const sameType = item.file.type === r.blob.type;
  const resized = r.width !== r.srcWidth || r.height !== r.srcHeight;
  item.srcWidth = r.srcWidth;
  item.srcHeight = r.srcHeight;
  if (!resized && sameType && r.blob.size > item.file.size * 0.97 && r.outcome !== 'floor') {
    item.status = 'lean';
  } else {
    item.status = 'done';
    item.result = { blob: r.blob, url: URL.createObjectURL(r.blob), width: r.width, height: r.height, outcome: r.outcome, format: r.format, flattened: r.flattened, webpFallback: r.webpFallback };
  }
  active = null;
  update(item);
  pump();
}

function onError(id, job, code) {
  const item = current(id, job);
  if (!item) return;
  item.status = 'error';
  item.code = code;
  active = null;
  update(item);
  pump();
}

function cancelActive() {
  if (!active) return;
  if (worker) { worker.terminate(); startWorker(); active = null; }
  else active.stale = true; // no worker to stop, so its result is ignored when it arrives
}

/* ---------- files ---------- */

function release(item) {
  if (item.result && item.result.url) URL.revokeObjectURL(item.result.url);
  item.result = null;
}

function queue(item, s) {
  release(item);
  item.settings = s;
  item.key = JSON.stringify(s);
  item.status = s.level === 'target' && !s.maxSide && item.file.size <= s.targetBytes && /^image\/(jpeg|webp|png)$/.test(item.file.type) && item.file.type === 'image/' + s.format ? 'under' : 'queued';
}

function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const s = settings();
  for (const file of files) {
    const item = { id: nextId++, file, name: cleanName(baseOf(file.name)) + '-optimised', nodes: null };
    if (file.size > MAX_BYTES) { item.status = 'error'; item.code = 'size'; }
    else queue(item, s);
    items.push(item);
    list.append(build(item));
    update(item);
  }
  results.hidden = false;
  pump();
  refreshSummary();
}

function rerunAll() {
  const s = readSettings();
  if (!s) return;
  lastSettings = s;
  const key = JSON.stringify(s);
  for (const item of items) {
    if (item.status === 'error' && ['size', 'decode'].includes(item.code)) continue;
    if (item.key === key && item.status !== 'error') continue;
    if (active && active.id === item.id) cancelActive();
    queue(item, s);
    update(item);
  }
  pump();
  refreshSummary();
}

let timer = 0;
const rerunSoon = () => { clearTimeout(timer); timer = setTimeout(rerunAll, 350); };

/* ---------- rendering ---------- */

function errorText(item) {
  const name = item.file.name.toLowerCase();
  if (item.code === 'size') return 'This file is over 200 MB, which is more than a browser can handle.';
  if (item.code === 'decode') {
    if (/\.(heic|heif)$/.test(name)) return 'This browser cannot open HEIC photos. Open this page in Safari, or set your iPhone camera to "Most Compatible" so it saves JPEG.';
    if (/\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|raw)$/.test(name)) return 'RAW camera files cannot be opened in a browser. Export a JPEG from your camera or photo software first.';
    if (!item.file.type.startsWith('image/')) return 'This is not an image file.';
    return 'This image could not be opened. It may be damaged or in a format browsers do not support.';
  }
  if (item.code === 'toobig') return 'This picture is too large for this device at that size. Choose a smaller picture size and it will work.';
  return 'Something went wrong with this image.';
}

function extOf(item) {
  return EXT[(item.result && item.result.format) || (item.settings && item.settings.format) || 'jpeg'];
}

function outName(item) {
  return (cleanName(item.name) || 'image') + '.' + extOf(item);
}

function build(item) {
  const li = el('li', 'item');
  const thumb = el('div', 'thumb');
  const main = el('div', 'item-main');

  const nameRow = el('div', 'name-row');
  const input = el('input', 'name');
  input.type = 'text';
  input.value = item.name;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'File name for ' + item.file.name);
  input.addEventListener('input', () => { item.name = input.value; if (item.nodes.link) item.nodes.link.download = outName(item); });
  input.addEventListener('blur', () => { item.name = cleanName(input.value) || 'image'; input.value = item.name; });
  const ext = el('span', 'ext');
  nameRow.append(input, ext);

  const meta = el('div', 'item-meta');
  const shrink = el('span', 'shrink');
  const shrinkFill = el('i');
  shrink.append(shrinkFill);
  const bar = el('span', 'bar indeterminate');
  bar.append(el('i'));
  const note = el('div', 'item-note');
  main.append(nameRow, meta, shrink, bar, note);

  const actions = el('div', 'item-actions');
  const link = el('a', 'btn primary', 'Download');
  const remove = el('button', 'btn ghost', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove ' + item.file.name);
  remove.addEventListener('click', () => {
    if (active && active.id === item.id) cancelActive();
    release(item);
    items = items.filter((i) => i !== item);
    li.remove();
    results.hidden = items.length === 0;
    pump();
    refreshSummary();
  });
  actions.append(link, remove);

  li.append(thumb, main, actions);
  item.nodes = { li, thumb, ext, meta, shrink, shrinkFill, bar, note, link, input };
  return li;
}

function update(item) {
  const n = item.nodes;
  if (!n) return;
  n.li.className = 'item is-' + item.status;
  const failed = item.status === 'error';
  n.ext.textContent = failed ? '' : '.' + extOf(item);
  n.input.disabled = failed;
  if (failed) n.input.value = item.file.name;
  else if (n.input.value === item.file.name && item.name !== item.file.name) n.input.value = item.name;
  const done = item.status === 'done';
  const r = item.result;

  n.thumb.replaceChildren();
  if (done) {
    const img = el('img');
    img.src = r.url;
    img.alt = '';
    img.loading = 'lazy';
    n.thumb.append(img);
  }

  n.meta.replaceChildren();
  if (done) {
    const saved = Math.round((1 - r.blob.size / item.file.size) * 100);
    n.meta.append(el('span', 'was', fmt(item.file.size)), el('span', '', 'to'), el('strong', '', fmt(r.blob.size)));
    if (saved > 0) n.meta.append(el('span', 'badge', Math.min(99, saved) + '% smaller'));
    else n.meta.append(el('span', 'badge quiet', 'Not smaller'));
    const dims = item.srcWidth === r.width && item.srcHeight === r.height
      ? r.width + ' × ' + r.height + ' px'
      : item.srcWidth + ' × ' + item.srcHeight + ' to ' + r.width + ' × ' + r.height + ' px';
    n.meta.append(el('span', 'dims', dims));
  } else {
    n.meta.append(el('span', '', fmt(item.file.size)));
    if (item.status === 'lean') n.meta.append(el('span', 'badge quiet', 'Already lean'));
    if (item.status === 'under') n.meta.append(el('span', 'badge quiet', 'Already under your size'));
  }

  n.shrink.hidden = !done;
  if (done) n.shrinkFill.style.width = Math.min(100, Math.max(1.5, (r.blob.size / item.file.size) * 100)) + '%';
  n.bar.hidden = item.status !== 'working';

  let note = '';
  const target = item.settings ? fmt(item.settings.targetBytes) : '';
  if (item.status === 'queued') note = 'Waiting';
  else if (item.status === 'working') note = item.attempt ? 'Finding the best quality for your size, try ' + item.attempt : 'Optimising';
  else if (item.status === 'lean') note = 'This image is already well optimised at this level. Try a stronger level or a smaller picture size.';
  else if (item.status === 'under') note = 'This image is already smaller than ' + target + ', so there is nothing to do.';
  else if (item.status === 'error') note = errorText(item);
  else if (done) {
    const parts = [];
    if (r.outcome === 'hit') parts.push('Best quality that fits under ' + target + '.');
    if (r.outcome === 'maxed') parts.push('This is the highest quality at this picture size. It comes in under your ' + target + '.');
    if (r.outcome === 'shrunk') parts.push('To get under ' + target + ', the picture itself was also made smaller.');
    if (r.outcome === 'floor') parts.push('This image cannot get down to ' + target + '. This is the smallest it goes.');
    if (r.flattened) parts.push('Transparent areas became white, because JPEG cannot store them. Choose WebP or PNG to keep them.');
    if (r.webpFallback) parts.push('This browser cannot save WebP, so it was saved as JPEG.');
    note = parts.join(' ');
  }
  n.note.textContent = note;
  n.note.hidden = !note;

  n.link.hidden = !done;
  if (done) { n.link.href = r.url; n.link.download = outName(item); } else n.link.removeAttribute('href');
}

function refreshSummary() {
  const done = items.filter((i) => i.status === 'done');
  const busy = items.some((i) => i.status === 'queued' || i.status === 'working');
  if (done.length) {
    const before = done.reduce((s, i) => s + i.file.size, 0);
    const after = done.reduce((s, i) => s + i.result.blob.size, 0);
    const pct = Math.round((1 - after / before) * 100);
    summary.textContent = (busy ? 'So far: ' : '') + fmt(before) + ' down to ' + fmt(after) + (pct > 0 ? ', ' + Math.min(99, pct) + '% smaller' : '') + ' across ' + done.length + (done.length === 1 ? ' image.' : ' images.');
  } else {
    summary.textContent = busy ? 'Working on it.' : '';
  }
  downloadAllBtn.hidden = done.length < 2;
  downloadAllBtn.textContent = busy ? 'Download the ' + done.length + ' finished as ZIP' : 'Download all as ZIP';
  $('#renameRow').hidden = items.length < 2;
}

/* ---------- rename all ---------- */

function renameAll() {
  const base = cleanName(renameBase.value);
  if (!base) { renameBase.focus(); return; }
  const usable = items.filter((i) => !(i.status === 'error' && ['size', 'decode'].includes(i.code)));
  const pad = String(usable.length).length;
  usable.forEach((item, idx) => {
    item.name = base + '-' + String(idx + 1).padStart(pad, '0');
    item.nodes.input.value = item.name;
    if (item.status === 'done') item.nodes.link.download = outName(item);
  });
}
renameBtn.addEventListener('click', renameAll);
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
    a.download = 'optimised-images.zip';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    downloadAllBtn.disabled = false;
  }
});

/* ---------- events ---------- */

fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

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

levelInputs.forEach((i) => i.addEventListener('change', () => { syncRows(); if (checked(levelInputs) === 'target') { targetValue.focus(); targetValue.select(); } rerunAll(); }));
sideInputs.forEach((i) => i.addEventListener('change', () => { syncRows(); if (checked(sideInputs) === 'custom') { customSide.focus(); customSide.select(); } rerunAll(); }));
formatSel.addEventListener('change', rerunAll);
targetUnit.addEventListener('change', rerunAll);
[targetValue, customSide].forEach((i) => {
  i.addEventListener('input', rerunSoon);
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } });
});

clearBtn.addEventListener('click', () => {
  cancelActive();
  items.forEach(release);
  items = [];
  list.replaceChildren();
  results.hidden = true;
  refreshSummary();
});

if (typeof createImageBitmap !== 'function') {
  $('#unsupported').hidden = false;
  drop.classList.add('is-disabled');
  fileInput.disabled = true;
} else {
  startWorker();
}
syncRows();
