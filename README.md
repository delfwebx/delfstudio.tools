# Delf Studio Tools

Free, single-purpose web tools. Each tool lives in its own folder and runs entirely in the visitor's browser.

| Tool | Folder | What it does |
|---|---|---|
| PDF Optimiser | `pdf-optimiser/` | Makes large PDF files smaller, without uploading them |
| Image Optimiser | `image-optimiser/` | Shrinks photos for email and web: compression levels, target file size, resize, batch rename, ZIP download |
| QR Code Generator | `qr-code-generator/` | Makes static QR codes (link, text, Wi-Fi, email, phone, WhatsApp, contact card) with colours, shapes and a logo |

`index.html` at the top level is the menu page that links to every tool.

## Adding a tool

1. Create a folder for it (for example `image-resizer/`) with its own `index.html`.
2. Add one list item for it in the top-level `index.html`.
3. Link its wordmark back to `../` so visitors can return to the menu.

## Image Optimiser

- `image-optimiser/index.html`: the page.
- `image-optimiser/js/engine.js`: decodes, resizes and re-encodes images with the browser's own canvas. No third-party code.
- `image-optimiser/js/worker.js`: runs the engine off the main thread where the browser supports it.
- `image-optimiser/js/app.js`: settings, the queue, renaming and downloads.

Output never carries the original's metadata (EXIF, GPS), because images are redrawn rather than copied.

## QR Code Generator

- `qr-code-generator/index.html`: the page.
- `qr-code-generator/js/app.js`: builds the content for each code type, draws the code as SVG, and exports PNG and SVG.
- `qr-code-generator/vendor/qrcode.mjs`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase (MIT licence).

Codes are static: the content is stored in the code itself, so nothing passes through a server and nothing expires.

## PDF Optimiser

- `pdf-optimiser/index.html`: the page (layout, styles, copy).
- `pdf-optimiser/js/app.js`: file handling, the queue, results and downloads.
- `pdf-optimiser/js/worker.js`: runs the compression off the main thread.
- `pdf-optimiser/vendor/gs.js`, `gs.wasm`: Ghostscript 10.06 compiled to WebAssembly, from [@okathira/ghostpdl-wasm](https://github.com/okathira/ghostpdl-wasm) 1.1.0.

There is no build step and no server code. Any static host works.

### Compression levels

| Level | Image resolution | Use for |
|---|---|---|
| Light | 200 dpi | Printing |
| Balanced | 150 dpi | Most files, on-screen reading |
| Maximum | 96 dpi | Smallest possible file |
| Custom size | Searched per file | Hitting a size limit, such as "under 5 MB" |

Custom size runs Ghostscript several times per file (best quality, smallest, then up to six tries in between) and keeps the largest result that fits under the target.

## Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening a page straight from disk will not work, because browsers block workers and WebAssembly on `file://`.

## Hosting

- GitHub Pages: Settings, Pages, deploy from the `main` branch, root folder.
- cPanel or other Apache hosting: upload every file, including `.htaccess`.

## Licence

Ghostscript is licensed under the GNU AGPL v3, and the PDF Optimiser ships it, so the whole project is published under the same licence (see `LICENSE`). Keep the source link in the page footer.
