# PDF Optimiser by Delf Studio

A single-purpose web tool: make large PDF files smaller. Everything runs in the visitor's browser, so files are never uploaded.

## How it works

- `index.html`: the page (layout, styles, copy).
- `js/app.js`: file handling, the queue, results and downloads.
- `js/worker.js`: runs the compression off the main thread.
- `vendor/gs.js`, `vendor/gs.wasm`: Ghostscript 10.06 compiled to WebAssembly, from [@okathira/ghostpdl-wasm](https://github.com/okathira/ghostpdl-wasm) 1.1.0.

There is no build step and no server code. Any static host works.

## Compression levels

| Level | Image resolution | Use for |
|---|---|---|
| Light | 200 dpi | Printing |
| Balanced | 150 dpi | Most files, on-screen reading |
| Maximum | 96 dpi | Smallest possible file |

## Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` straight from disk will not work, because browsers block workers and WebAssembly on `file://`.

## Hosting

- GitHub Pages: Settings, Pages, deploy from the `main` branch, root folder.
- cPanel or other Apache hosting: upload every file, including `.htaccess`.

## Licence

Ghostscript is licensed under the GNU AGPL v3, and this tool ships it, so the whole project is published under the same licence (see `LICENSE`). Keep the source link in the page footer.
