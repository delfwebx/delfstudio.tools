// PDF Optimiser by Delf Studio: compression worker.
// Runs Ghostscript (WebAssembly) off the main thread. Files stay on this device.
import loadGhostscript from '../vendor/gs.js';

const WASM_URL = new URL('../vendor/gs.wasm', import.meta.url);
const WASM_SIZE_HINT = 15533045;

// name: [Ghostscript base profile, colour/grey image dpi, mono image dpi]
const PRESETS = {
  light: ['/printer', 200, 600],
  balanced: ['/ebook', 150, 400],
  maximum: ['/screen', 96, 300],
};

// Target-size search: how many extra tries after the two end points, and how
// close under the target counts as good enough.
const MAX_BISECTIONS = 6;
const CLOSE_ENOUGH = 0.93;

let enginePromise = null;

function getEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const res = await fetch(WASM_URL);
    if (!res.ok || !res.body) throw new Error('engine');
    let total = Number(res.headers.get('content-length')) || WASM_SIZE_HINT;
    if (res.headers.get('content-encoding')) total = WASM_SIZE_HINT;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      postMessage({ type: 'engine', ratio: Math.min(1, loaded / total) });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    const compiled = await WebAssembly.compile(bytes);
    postMessage({ type: 'engine', ratio: 1, ready: true });
    return compiled;
  })();
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

const COMMON = [
  '-sDEVICE=pdfwrite',
  '-dCompatibilityLevel=1.5',
  '-dNOPAUSE', '-dBATCH', '-dSAFER',
  '-dDetectDuplicateImages=true',
  '-dCompressFonts=true',
  '-dSubsetFonts=true',
  '-dDownsampleColorImages=true', '-dColorImageDownsampleType=/Bicubic',
  '-dDownsampleGrayImages=true', '-dGrayImageDownsampleType=/Bicubic',
  '-dDownsampleMonoImages=true',
];

function presetArgs(preset) {
  const [profile, dpi, monoDpi] = PRESETS[preset] || PRESETS.balanced;
  return [
    ...COMMON,
    '-dPDFSETTINGS=' + profile,
    '-dColorImageResolution=' + dpi,
    '-dGrayImageResolution=' + dpi,
    '-dMonoImageResolution=' + monoDpi,
    '-sOutputFile=out.pdf',
    'in.pdf',
  ];
}

// One quality dial from 0 (smallest) to 1 (best). It moves image resolution
// and JPEG strength together so file size changes smoothly along it.
function qualityArgs(q) {
  const dpi = Math.round(50 + q * 250);
  const qFactor = (1.5 - q * 1.35).toFixed(3);
  const sampling = '[2 1 1 2]';
  const dict = '<< /QFactor ' + qFactor + ' /Blend 1 /HSamples ' + sampling + ' /VSamples ' + sampling + ' >>';
  return [
    ...COMMON,
    '-dPDFSETTINGS=/ebook',
    '-dPassThroughJPEGImages=false',
    // Thresholds of 1 keep size changing smoothly with resolution (no sudden jumps).
    '-dColorImageDownsampleThreshold=1.0',
    '-dGrayImageDownsampleThreshold=1.0',
    '-dColorImageResolution=' + dpi,
    '-dGrayImageResolution=' + dpi,
    '-dMonoImageResolution=' + Math.max(300, dpi * 2),
    '-sOutputFile=out.pdf',
    '-c',
    '<< /ColorACSImageDict ' + dict + ' /ColorImageDict ' + dict + ' /GrayACSImageDict ' + dict + ' /GrayImageDict ' + dict + ' >> setdistillerparams',
    '-f',
    'in.pdf',
  ];
}

class JobError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Each run gets a fresh Ghostscript instance, so one bad file cannot affect the next.
async function runOnce(compiled, input, args, id, attempt) {
  let pages = 0;
  let locked = false;
  const gs = await loadGhostscript({
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(compiled, imports).then((instance) => done(instance, compiled));
      return {};
    },
    print(line) {
      let m;
      if ((m = /Processing pages \d+ through (\d+)/.exec(line))) pages = Number(m[1]);
      else if ((m = /^Page (\d+)/.exec(line))) postMessage({ type: 'progress', id, page: Number(m[1]), pages, attempt });
    },
    printErr(line) {
      if (/requires a password/i.test(line)) locked = true;
    },
  });

  gs.FS.writeFile('in.pdf', input);
  let code;
  try { code = gs.callMain(args); } catch (err) { code = -1; }
  if (locked) throw new JobError('locked');

  let out = null;
  try { out = gs.FS.readFile('out.pdf'); } catch (err) { out = null; }
  if (code !== 0 || !out || out.length < 64 || pages === 0) throw new JobError('unreadable');
  return { bytes: out.slice(), pages };
}

async function runToTarget(compiled, input, target, id) {
  let attempt = 1;
  // Best quality first. If that already fits, there is nothing better to offer.
  const top = await runOnce(compiled, input, qualityArgs(1), id, attempt);
  if (top.bytes.length <= target) return { ...top, outcome: 'maxed' };

  // Then the smallest possible. If that is still too big, the target is out of reach.
  const floor = await runOnce(compiled, input, qualityArgs(0), id, ++attempt);
  if (floor.bytes.length > target) return { ...floor, outcome: 'floor' };

  let best = floor;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < MAX_BISECTIONS; i++) {
    if (best.bytes.length >= target * CLOSE_ENOUGH) break;
    const mid = (lo + hi) / 2;
    const res = await runOnce(compiled, input, qualityArgs(mid), id, ++attempt);
    if (res.bytes.length <= target) {
      lo = mid;
      if (res.bytes.length > best.bytes.length) best = res;
    } else {
      hi = mid;
    }
  }
  return { ...best, outcome: 'hit' };
}

self.onmessage = async (e) => {
  const { type, id, buffer, setting } = e.data;
  if (type === 'warm') { getEngine().catch(() => postMessage({ type: 'engine', failed: true })); return; }
  if (type !== 'job') return;

  let compiled;
  try {
    compiled = await getEngine();
  } catch (err) {
    postMessage({ type: 'error', id, code: 'engine' });
    return;
  }

  try {
    postMessage({ type: 'start', id });
    const input = new Uint8Array(buffer);
    let result;
    if (typeof setting === 'string' && setting.startsWith('target:')) {
      result = await runToTarget(compiled, input, Number(setting.slice(7)), id);
    } else {
      result = { ...(await runOnce(compiled, input, presetArgs(setting), id, 0)), outcome: 'preset' };
    }
    postMessage({ type: 'done', id, buffer: result.bytes.buffer, pages: result.pages, outcome: result.outcome }, [result.bytes.buffer]);
  } catch (err) {
    postMessage({ type: 'error', id, code: err instanceof JobError ? err.code : 'failed' });
  }
};
