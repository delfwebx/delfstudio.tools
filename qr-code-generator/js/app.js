// QR Code Generator by Delf Studio.
// Codes are made in the browser. Nothing typed here is sent anywhere.
import qrcode from '../vendor/qrcode.mjs';

// Encode text as UTF-8 so accents, Arabic, emoji and so on scan correctly.
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

const $ = (sel) => document.querySelector(sel);
const typesEl = $('#types');
const fieldsEl = $('#fields');
const previewEl = $('#preview');
const statusEl = $('#status');
const warnEl = $('#warn');
const pngBtn = $('#downloadPng');
const svgBtn = $('#downloadSvg');
const sizeSel = $('#pngSize');
const fgInput = $('#fg');
const bgInput = $('#bg');
const logoInput = $('#logo');
const logoName = $('#logoName');
const logoRemove = $('#logoRemove');
const styleInputs = [...document.querySelectorAll('input[name="style"]')];

const QUIET = 4; // blank modules around the code, required for reliable scanning
const SAMPLE = 'https://delfwebx.github.io/delfstudio.tools/';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/* ---------- what a code can hold ---------- */

const wifiEscape = (s) => s.replace(/([\\;,:"])/g, '\\$1');
const vcardEscape = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const digits = (s) => s.replace(/[^\d]/g, '');

const TYPES = {
  link: {
    label: 'Link',
    fields: [{ id: 'url', label: 'Website address', type: 'url', placeholder: 'https://example.com', inputmode: 'url' }],
    build(v) {
      const url = v.url.trim();
      if (!url) return '';
      return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url;
    },
  },
  text: {
    label: 'Text',
    fields: [{ id: 'text', label: 'Your text', type: 'textarea', placeholder: 'Anything you want people to read when they scan' }],
    build: (v) => v.text.trim(),
  },
  wifi: {
    label: 'Wi-Fi',
    fields: [
      { id: 'ssid', label: 'Network name', type: 'text', placeholder: 'Home Wi-Fi' },
      { id: 'pass', label: 'Password', type: 'text', placeholder: 'Leave empty for an open network', autocomplete: 'off' },
      { id: 'enc', label: 'Security', type: 'select', options: [['WPA', 'WPA / WPA2 / WPA3 (most networks)'], ['WEP', 'WEP (old routers)'], ['nopass', 'None (open network)']] },
      { id: 'hidden', label: 'This network is hidden', type: 'checkbox' },
    ],
    build(v) {
      const ssid = v.ssid.trim();
      if (!ssid) return '';
      const enc = v.pass ? v.enc : 'nopass';
      return 'WIFI:T:' + enc + ';S:' + wifiEscape(ssid) + ';' + (enc === 'nopass' ? '' : 'P:' + wifiEscape(v.pass) + ';') + (v.hidden ? 'H:true;' : '') + ';';
    },
  },
  email: {
    label: 'Email',
    fields: [
      { id: 'to', label: 'Send to', type: 'email', placeholder: 'name@example.com', inputmode: 'email' },
      { id: 'subject', label: 'Subject (optional)', type: 'text' },
      { id: 'body', label: 'Message (optional)', type: 'textarea' },
    ],
    build(v) {
      const to = v.to.trim();
      if (!to) return '';
      const q = [];
      if (v.subject.trim()) q.push('subject=' + encodeURIComponent(v.subject.trim()));
      if (v.body.trim()) q.push('body=' + encodeURIComponent(v.body.trim()));
      return 'mailto:' + to + (q.length ? '?' + q.join('&') : '');
    },
  },
  phone: {
    label: 'Phone',
    fields: [{ id: 'number', label: 'Phone number', type: 'tel', placeholder: '+971 50 123 4567', inputmode: 'tel' }],
    build(v) {
      const n = v.number.trim();
      const d = digits(n);
      return d ? 'tel:' + (n.startsWith('+') ? '+' : '') + d : '';
    },
  },
  whatsapp: {
    label: 'WhatsApp',
    fields: [
      { id: 'number', label: 'WhatsApp number, with country code', type: 'tel', placeholder: '+971 50 123 4567', inputmode: 'tel' },
      { id: 'message', label: 'Pre-filled message (optional)', type: 'textarea' },
    ],
    build(v) {
      const d = digits(v.number);
      if (!d) return '';
      return 'https://wa.me/' + d + (v.message.trim() ? '?text=' + encodeURIComponent(v.message.trim()) : '');
    },
  },
  contact: {
    label: 'Contact card',
    fields: [
      { id: 'first', label: 'First name', type: 'text', autocomplete: 'off' },
      { id: 'last', label: 'Last name', type: 'text', autocomplete: 'off' },
      { id: 'org', label: 'Company (optional)', type: 'text' },
      { id: 'title', label: 'Job title (optional)', type: 'text' },
      { id: 'tel', label: 'Phone (optional)', type: 'tel', inputmode: 'tel' },
      { id: 'mail', label: 'Email (optional)', type: 'email', inputmode: 'email' },
      { id: 'site', label: 'Website (optional)', type: 'url', inputmode: 'url' },
    ],
    build(v) {
      const first = v.first.trim();
      const last = v.last.trim();
      if (!first && !last) return '';
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + vcardEscape(last) + ';' + vcardEscape(first) + ';;;', 'FN:' + vcardEscape((first + ' ' + last).trim())];
      if (v.org.trim()) lines.push('ORG:' + vcardEscape(v.org.trim()));
      if (v.title.trim()) lines.push('TITLE:' + vcardEscape(v.title.trim()));
      if (v.tel.trim()) lines.push('TEL;TYPE=CELL:' + v.tel.trim());
      if (v.mail.trim()) lines.push('EMAIL:' + v.mail.trim());
      if (v.site.trim()) lines.push('URL:' + v.site.trim());
      lines.push('END:VCARD');
      return lines.join('\n');
    },
  },
};

/* ---------- state ---------- */

const state = {
  type: 'link',
  values: {},
  logo: null, // { dataUrl, image, name }
};
for (const [key, def] of Object.entries(TYPES)) {
  state.values[key] = {};
  for (const f of def.fields) state.values[key][f.id] = f.type === 'checkbox' ? false : f.type === 'select' ? f.options[0][0] : '';
}

let current = null; // { svg, svgNoLogo, modules, hole } for the code on screen, or null when empty

const styleValue = () => (styleInputs.find((i) => i.checked) || {}).value || 'square';

/* ---------- form ---------- */

function renderTypes() {
  typesEl.replaceChildren(...Object.entries(TYPES).map(([key, def]) => {
    const label = document.createElement('label');
    label.className = 'chip';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'type';
    input.value = key;
    input.checked = key === state.type;
    input.addEventListener('change', () => { state.type = key; renderFields(); update(); });
    const span = document.createElement('span');
    span.textContent = def.label;
    label.append(input, span);
    return label;
  }));
}

function renderFields() {
  const def = TYPES[state.type];
  const values = state.values[state.type];
  fieldsEl.replaceChildren(...def.fields.map((f) => {
    const id = 'f-' + state.type + '-' + f.id;
    const wrap = document.createElement(f.type === 'checkbox' ? 'label' : 'div');
    wrap.className = f.type === 'checkbox' ? 'check' : 'field';
    let control;
    if (f.type === 'textarea') {
      control = document.createElement('textarea');
      control.rows = 3;
    } else if (f.type === 'select') {
      control = document.createElement('select');
      for (const [value, text] of f.options) control.append(new Option(text, value));
    } else {
      control = document.createElement('input');
      control.type = f.type;
    }
    control.id = id;
    if (f.placeholder) control.placeholder = f.placeholder;
    if (f.inputmode) control.inputMode = f.inputmode;
    if (f.autocomplete) control.autocomplete = f.autocomplete;
    if (f.type !== 'checkbox' && f.type !== 'select') { control.spellcheck = false; control.autocapitalize = 'off'; }
    if (f.type === 'checkbox') control.checked = values[f.id]; else control.value = values[f.id];
    const onChange = () => { values[f.id] = f.type === 'checkbox' ? control.checked : control.value; schedule(); };
    control.addEventListener('input', onChange);
    control.addEventListener('change', onChange);
    if (f.type === 'checkbox') {
      wrap.append(control, document.createTextNode(' ' + f.label));
    } else {
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = f.label;
      wrap.append(label, control);
    }
    return wrap;
  }));
}

/* ---------- drawing ---------- */

const num = (v) => String(Math.round(v * 100) / 100);

function roundedRect(x, y, w, h, r) {
  const a = 'a' + num(r) + ' ' + num(r) + ' 0 0 1 ';
  return 'M' + num(x + r) + ' ' + num(y) + 'h' + num(w - 2 * r) + a + num(r) + ' ' + num(r) + 'v' + num(h - 2 * r) + a + num(-r) + ' ' + num(r) +
    'h' + num(-(w - 2 * r)) + a + num(-r) + ' ' + num(-r) + 'v' + num(-(h - 2 * r)) + a + num(r) + ' ' + num(-r) + 'z';
}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function buildSvg(qr, opt, includeLogo) {
  const n = qr.getModuleCount();
  const size = n + QUIET * 2;
  const isFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  // With a logo, clear a square in the middle. High error correction covers the gap.
  let hole = null;
  if (opt.logo) {
    let k = Math.round(n * 0.24);
    if ((n - k) % 2) k += 1;
    hole = { start: (n - k) / 2, size: k };
  }
  const inHole = (r, c) => hole && r >= hole.start && r < hole.start + hole.size && c >= hole.start && c < hole.start + hole.size;

  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inHole(r, c)) continue;
      if (opt.style !== 'square' && isFinder(r, c)) continue;
      const x = c + QUIET;
      const y = r + QUIET;
      if (opt.style === 'square') d += 'M' + x + ' ' + y + 'h1v1h-1z';
      else if (opt.style === 'rounded') d += roundedRect(x + 0.04, y + 0.04, 0.92, 0.92, 0.3);
      else d += 'M' + num(x + 0.5) + ' ' + num(y + 0.04) + 'a.46 .46 0 1 0 0 .92a.46 .46 0 1 0 0-.92z';
    }
  }
  if (opt.style !== 'square') {
    // The three corner markers stay solid and bold so cameras lock on quickly.
    const rad = opt.style === 'dots' ? 2.4 : 1.6;
    for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const x = fc + QUIET;
      const y = fr + QUIET;
      d += roundedRect(x, y, 7, 7, rad) + roundedRect(x + 1, y + 1, 5, 5, rad * 0.7) + roundedRect(x + 2, y + 2, 3, 3, rad * 0.45);
    }
  }

  let logo = '';
  if (hole && includeLogo) {
    const p = hole.start + QUIET;
    logo = '<rect x="' + p + '" y="' + p + '" width="' + hole.size + '" height="' + hole.size + '" rx="0.6" fill="' + opt.bg + '"/>' +
      '<image x="' + (p + 0.5) + '" y="' + (p + 0.5) + '" width="' + (hole.size - 1) + '" height="' + (hole.size - 1) + '" href="' + escapeAttr(opt.logo.dataUrl) + '"/>';
  }

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + opt.px + '" height="' + opt.px + '"' +
    (opt.style === 'square' ? ' shape-rendering="crispEdges"' : '') + '>' +
    '<rect width="' + size + '" height="' + size + '" fill="' + opt.bg + '"/>' +
    '<path fill="' + opt.fg + '" fill-rule="evenodd" d="' + d + '"/>' + logo + '</svg>';
  return { svg, size, hole };
}

/* ---------- colour check ---------- */

function luminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function colourWarning(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (ratio < 3) return 'These two colours are too close. Many phones will not be able to scan this. Pick a darker code colour or a lighter background.';
  if (a > b) return 'A light code on a dark background does not scan on every phone. Dark on light is the safe choice.';
  return '';
}

/* ---------- update ---------- */

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(update, 80);
}

function update() {
  const payload = TYPES[state.type].build(state.values[state.type]);
  const opt = { style: styleValue(), fg: fgInput.value, bg: bgInput.value, logo: state.logo, px: 1024 };
  const empty = !payload;

  let qr;
  try {
    qr = qrcode(0, state.logo ? 'H' : 'M');
    qr.addData(empty ? SAMPLE : payload, 'Byte');
    qr.make();
  } catch (err) {
    current = null;
    previewEl.classList.add('is-empty');
    statusEl.textContent = 'That is too much to fit in one QR code. Shorten it' + (state.logo ? ', or remove the logo to make room.' : '.');
    statusEl.classList.add('bad');
    setDownloads(false);
    return;
  }

  const withLogo = buildSvg(qr, opt, true);
  previewEl.innerHTML = withLogo.svg;
  previewEl.classList.toggle('is-empty', empty);
  statusEl.classList.remove('bad');

  const warning = empty ? '' : colourWarning(opt.fg, opt.bg);
  warnEl.textContent = warning;
  warnEl.hidden = !warning;

  if (empty) {
    current = null;
    statusEl.textContent = 'Fill in the form and your code appears here.';
    setDownloads(false);
    return;
  }
  current = { svg: withLogo.svg, plain: buildSvg(qr, opt, false), opt };
  const dense = qr.getModuleCount() > 57;
  statusEl.textContent = dense
    ? 'Ready. This code holds a lot, so print it large or shorten the content for easier scanning.'
    : 'Ready. Test it with your phone camera before you print.';
  setDownloads(true);
}

function setDownloads(on) {
  pngBtn.disabled = !on;
  svgBtn.disabled = !on;
}

/* ---------- downloads ---------- */

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderPng(px) {
  const { plain, opt } = current;
  const url = URL.createObjectURL(new Blob([plain.svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = opt.style !== 'square';
    ctx.drawImage(img, 0, 0, px, px);
    if (plain.hole && opt.logo) {
      // The logo is painted straight onto the canvas, which is more dependable
      // across browsers than an image nested inside the SVG.
      const unit = px / plain.size;
      const box = plain.hole.size * unit;
      const pos = (plain.hole.start + QUIET) * unit;
      ctx.fillStyle = opt.bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(pos, pos, box, box, 0.6 * unit); else ctx.rect(pos, pos, box, box);
      ctx.fill();
      const inner = box - unit;
      const im = opt.logo.image;
      const w = im.naturalWidth || im.width || 1;
      const h = im.naturalHeight || im.height || 1;
      const scale = Math.min(inner / w, inner / h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, pos + unit / 2 + (inner - w * scale) / 2, pos + unit / 2 + (inner - h * scale) / 2, w * scale, h * scale);
    }
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

pngBtn.addEventListener('click', async () => {
  if (!current) return;
  pngBtn.disabled = true;
  try {
    const blob = await renderPng(Number(sizeSel.value) || 1024);
    if (blob) save(blob, 'qr-code.png');
  } catch (err) {
    statusEl.textContent = 'The PNG could not be made in this browser. Try the SVG download instead.';
    statusEl.classList.add('bad');
  } finally {
    pngBtn.disabled = !current;
  }
});

svgBtn.addEventListener('click', () => {
  if (!current) return;
  save(new Blob([current.svg], { type: 'image/svg+xml' }), 'qr-code.svg');
});

/* ---------- logo ---------- */

logoInput.addEventListener('change', () => {
  const file = logoInput.files[0];
  logoInput.value = '';
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { logoName.textContent = 'Use a PNG, JPG, WebP or SVG image.'; return; }
  if (file.size > MAX_LOGO_BYTES) { logoName.textContent = 'That image is over 2 MB. Use a smaller one.'; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const image = await loadImage(reader.result);
      state.logo = { dataUrl: reader.result, image, name: file.name };
      logoName.textContent = file.name;
      logoRemove.hidden = false;
      update();
    } catch (err) {
      logoName.textContent = 'That image could not be read. Try another one.';
    }
  };
  reader.readAsDataURL(file);
});

logoRemove.addEventListener('click', () => {
  state.logo = null;
  logoName.textContent = 'No logo';
  logoRemove.hidden = true;
  update();
});

/* ---------- start ---------- */

[fgInput, bgInput].forEach((i) => i.addEventListener('input', schedule));
styleInputs.forEach((i) => i.addEventListener('change', update));
$('#resetColours').addEventListener('click', () => { fgInput.value = '#000000'; bgInput.value = '#ffffff'; update(); });

renderTypes();
renderFields();
update();
