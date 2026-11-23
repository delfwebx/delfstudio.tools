// PDF Optimiser by Delf Studio: page logic.
// Everything runs in the browser. No file is uploaded anywhere.

const $ = (sel) => document.querySelector(sel);
const drop = $('#drop');
const fileInput = $('#file');
const list = $('#list');
const results = $('#results');
const summary = $('#summary');
const engineNote = $('#engine');
const downloadAllBtn = $('#downloadAll');
const clearBtn = $('#clear');
const presetInputs = [...document.querySelectorAll('input[name="preset"]')];

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB guard; larger files exhaust browser memory
const MIN_SAVING = 0.03; // under 3% smaller is treated as "already optimised"

let items = [];
let nextId = 1;
let worker = null;
let activeId = null;
let engineReady = false;

const preset = () => (presetInputs.find((i) => i.checked) || {}).value || 'balanced';

function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + units[u];
}

function outName(name) {
  return name.replace(/\.pdf$/i, '') + '-optimised.pdf';
}

/* ---------- worker ---------- */

function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = () => {
    // Usually the browser ran out of memory on a very large file.
    const item = items.find((i) => i.id === activeId);
    if (item) { item.status = 'error'; item.code = 'memory'; }
    activeId = null;
    engineReady = false;
    worker.terminate();
    startWorker();
    render();
    pump();
  };
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'engine') {
    if (m.failed) { engineNote.textContent = 'The compression engine could not be loaded. Check your connection and reload the page.'; engineNote.hidden = false; return; }
    if (m.ready) { engineReady = true; engineNote.hidden = true; render(); return; }
    if (!engineReady && items.length) {
      engineNote.hidden = false;
      engineNote.textContent = 'Loading the compression engine (one time, about 15 MB): ' + Math.round(m.ratio * 100) + '%';
    }
    return;
  }
  const item = items.find((i) => i.id === m.id);
  if (!item) { if (m.type === 'done' || m.type === 'error') { activeId = null; pump(); } return; }

  if (m.type === 'start') { item.status = 'working'; item.page = 0; item.pages = 0; }
  else if (m.type === 'progress') { item.page = m.page; item.pages = m.pages; }
  else if (m.type === 'done') {
    const blob = new Blob([m.buffer], { type: 'application/pdf' });
    item.pages = m.pages;
    if (blob.size > item.file.size * (1 - MIN_SAVING)) {
      item.status = 'lean';
    } else {
      item.status = 'done';
      item.outSize = blob.size;
      item.url = URL.createObjectURL(blob);
      item.blob = blob;
    }
    activeId = null;
    pump();
  } else if (m.type === 'error') {
    item.status = 'error';
    item.code = m.code;
    activeId = null;
    pump();
  }
  render();
}

async function pump() {
  if (activeId !== null) return;
  const item = items.find((i) => i.status === 'queued');
  if (!item) return;
  activeId = item.id;
  item.status = 'reading';
  render();
  try {
    const buffer = await item.file.arrayBuffer();
    if (!items.includes(item)) { activeId = null; pump(); return; }
    worker.postMessage({ type: 'job', id: item.id, buffer, preset: item.preset }, [buffer]);
  } catch (err) {
    item.status = 'error';
    item.code = 'memory';
    activeId = null;
    render();
    pump();
  }
}

/* ---------- files ---------- */

function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  for (const file of files) {
    const item = { id: nextId++, file, preset: preset(), status: 'queued' };
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) { item.status = 'error'; item.code = 'type'; }
    else if (file.size > MAX_BYTES) { item.status = 'error'; item.code = 'size'; }
    items.push(item);
  }
  render();
  pump();
}

function release(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null; item.blob = null; item.outSize = null;
}

function rerunAll() {
  const p = preset();
  let restart = false;
  for (const item of items) {
    if (item.status === 'error' && ['type', 'size', 'locked', 'unreadable'].includes(item.code)) continue;
    if (item.preset === p && item.status !== 'error') continue;
    if (item.id === activeId) restart = true;
    release(item);
    item.preset = p;
    item.status = 'queued';
  }
  if (restart) {
    // The running job used the old level. Stop it and start over.
    worker.terminate();
    activeId = null;
    engineReady = false;
    startWorker();
  }
  render();
  pump();
}

/* ---------- rendering ---------- */

const ERRORS = {
  type: 'This is not a PDF file.',
  size: 'This file is over 1 GB, which is more than a browser can handle.',
  locked: 'This PDF is password protected. Remove the password first, then try again.',
  unreadable: 'This file could not be read. It may be damaged or not a real PDF.',
  memory: 'Your browser ran out of memory on this file. Try it on a computer, or close other tabs and retry.',
  engine: 'The compression engine could not be loaded. Check your connection and retry.',
  failed: 'Something went wrong while compressing this file.',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderItem(item) {
  const li = el('li', 'item is-' + item.status);
  const main = el('div', 'item-main');
  main.append(el('span', 'item-name', item.file.name));

  const meta = el('span', 'item-meta');
  if (item.status === 'done') {
    const saved = Math.min(99, Math.round((1 - item.outSize / item.file.size) * 100));
    meta.append(el('span', 'was', fmt(item.file.size)), el('span', 'arrow', 'to'), el('strong', '', fmt(item.outSize)), el('span', 'badge', saved + '% smaller'));
  } else if (item.status === 'lean') {
    meta.append(el('span', '', fmt(item.file.size)), el('span', 'badge quiet', 'Already lean'));
  } else {
    meta.append(el('span', '', fmt(item.file.size)));
  }
  main.append(meta);

  const note = el('span', 'item-note');
  if (item.status === 'queued') note.textContent = 'Waiting';
  else if (item.status === 'reading') note.textContent = engineReady ? 'Reading file' : 'Getting ready';
  else if (item.status === 'working') note.textContent = item.pages ? 'Compressing page ' + Math.max(1, item.page) + ' of ' + item.pages : 'Compressing';
  else if (item.status === 'lean') note.textContent = 'This PDF is already well optimised, so there is nothing worth saving at this level. Try a stronger level, or keep your original.';
  else if (item.status === 'error') note.textContent = ERRORS[item.code] || ERRORS.failed;
  if (note.textContent) main.append(note);

  if (item.status === 'done') {
    // Original size as the full track, new size as the filled part.
    const shrink = el('span', 'shrink');
    const kept = el('i');
    kept.style.width = Math.max(1.5, (item.outSize / item.file.size) * 100) + '%';
    shrink.append(kept);
    shrink.setAttribute('role', 'img');
    shrink.setAttribute('aria-label', 'New file is ' + Math.round((item.outSize / item.file.size) * 100) + '% of the original size');
    main.append(shrink);
  }

  if (item.status === 'working' || item.status === 'reading') {
    const bar = el('span', 'bar');
    const fill = el('i');
    const ratio = item.status === 'working' && item.pages ? item.page / item.pages : 0;
    if (ratio) fill.style.width = Math.max(4, Math.round(ratio * 100)) + '%'; else bar.classList.add('indeterminate');
    bar.append(fill);
    main.append(bar);
  }
  li.append(main);

  const actions = el('div', 'item-actions');
  if (item.status === 'done') {
    const a = el('a', 'btn primary', 'Download');
    a.href = item.url;
    a.download = outName(item.file.name);
    actions.append(a);
  }
  if ((item.status === 'error' && ['memory', 'engine', 'failed'].includes(item.code))) {
    const retry = el('button', 'btn', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', () => { item.status = 'queued'; item.preset = preset(); render(); pump(); });
    actions.append(retry);
  }
  const remove = el('button', 'btn ghost', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove ' + item.file.name);
  remove.addEventListener('click', () => {
    if (item.id === activeId) { worker.terminate(); activeId = null; engineReady = false; startWorker(); }
    release(item);
    items = items.filter((i) => i !== item);
    render();
    pump();
  });
  actions.append(remove);
  li.append(actions);
  return li;
}

function render() {
  results.hidden = items.length === 0;
  list.replaceChildren(...items.map(renderItem));

  const done = items.filter((i) => i.status === 'done');
  const busy = items.some((i) => ['queued', 'reading', 'working'].includes(i.status));
  if (done.length) {
    const before = done.reduce((s, i) => s + i.file.size, 0);
    const after = done.reduce((s, i) => s + i.outSize, 0);
    summary.textContent = (busy ? 'So far: ' : '') + fmt(before) + ' down to ' + fmt(after) + ', ' + Math.min(99, Math.round((1 - after / before) * 100)) + '% smaller across ' + done.length + (done.length === 1 ? ' file' : ' files') + '.';
  } else {
    summary.textContent = busy ? 'Working on it. Large files can take a minute.' : '';
  }
  downloadAllBtn.hidden = done.length < 2 || busy;
  if (!busy && engineReady) engineNote.hidden = true;
}

/* ---------- zip (stored, no compression: PDFs are already compressed) ---------- */

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
    for (let n = 2; used.has(name.toLowerCase()); n++) name = entry.name.replace(/\.pdf$/i, '') + ' (' + n + ').pdf';
    used.add(name.toLowerCase());
    const nameBytes = enc.encode(name);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
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
    const zip = await buildZip(done.map((i) => ({ name: outName(i.file.name), blob: i.blob })));
    const url = URL.createObjectURL(zip);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'optimised-pdfs.zip';
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

presetInputs.forEach((input) => input.addEventListener('change', rerunAll));

clearBtn.addEventListener('click', () => {
  if (activeId !== null) { worker.terminate(); activeId = null; engineReady = false; startWorker(); }
  items.forEach(release);
  items = [];
  render();
});

const supported = typeof WebAssembly === 'object' && typeof Worker === 'function';
if (!supported) {
  $('#unsupported').hidden = false;
  drop.classList.add('is-disabled');
  fileInput.disabled = true;
} else {
  startWorker();
  // Start fetching the engine once the visitor shows intent, so the first file feels quick.
  const warm = () => { worker.postMessage({ type: 'warm' }); drop.removeEventListener('pointerenter', warm); drop.removeEventListener('focusin', warm); };
  drop.addEventListener('pointerenter', warm);
  drop.addEventListener('focusin', warm);
}
