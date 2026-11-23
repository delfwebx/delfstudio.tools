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

function buildArgs(preset) {
  const [profile, dpi, monoDpi] = PRESETS[preset] || PRESETS.balanced;
  return [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    '-dPDFSETTINGS=' + profile,
    '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    '-dDownsampleColorImages=true', '-dColorImageDownsampleType=/Bicubic', '-dColorImageResolution=' + dpi,
    '-dDownsampleGrayImages=true', '-dGrayImageDownsampleType=/Bicubic', '-dGrayImageResolution=' + dpi,
    '-dDownsampleMonoImages=true', '-dMonoImageResolution=' + monoDpi,
    '-sOutputFile=out.pdf',
    'in.pdf',
  ];
}

self.onmessage = async (e) => {
  const { type, id, buffer, preset } = e.data;
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
        else if ((m = /^Page (\d+)/.exec(line))) postMessage({ type: 'progress', id, page: Number(m[1]), pages });
      },
      printErr(line) {
        if (/requires a password/i.test(line)) locked = true;
      },
    });

    gs.FS.writeFile('in.pdf', new Uint8Array(buffer));
    let code;
    try { code = gs.callMain(buildArgs(preset)); } catch (err) { code = -1; }

    if (locked) { postMessage({ type: 'error', id, code: 'locked' }); return; }

    let out = null;
    try { out = gs.FS.readFile('out.pdf'); } catch (err) { out = null; }
    if (code !== 0 || !out || out.length < 64 || pages === 0) {
      postMessage({ type: 'error', id, code: 'unreadable' });
      return;
    }
    const copy = out.slice();
    postMessage({ type: 'done', id, buffer: copy.buffer, pages }, [copy.buffer]);
  } catch (err) {
    postMessage({ type: 'error', id, code: 'failed' });
  }
};
