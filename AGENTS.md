# AGENTS Guide

## Purpose
- PURRINT is a Deno + Vite + React single-page app that prepares 384 px‑wide black-and-white bitmaps for tiny Bluetooth thermal printers (tested with MX06) and sends them over Web Bluetooth.
- The UI lets the user either upload/drop/paste an image or type multiline text that gets rasterized into receipt-friendly imagery, preview it on a faux receipt, and trigger printing when a Web Bluetooth stack is available (desktop Chrome or Android Chrome).

## High-Level Structure
- **Entry point (`src/main.tsx`)** mounts `PurrintApp`, applies the global receipt-inspired styles in `src/index.css`, and loads the IBM VGA bitmap font so the whole app feels like a retro terminal.
- **PurrintApp (`src/components/PurrintApp.tsx`)** holds the full UI, canvas references, drag/drop handling, and printing logic. Mode toggles drive conditional rendering of the preview canvas vs. the auto-resizing `<textarea>`.
- **Services**  
  - `src/services/render.ts` consumes images via `FileReader`, constrains them to 384 px width, normalizes luminance, and applies Atkinson dithering to get binary pixels that match the printer's capabilities. The resulting `ImageData` is echoed back into the preview canvas.  
  - `src/services/printer.ts` converts `ImageData` into horizontal scanlines, constructs MX06-specific command frames (0x51 0x78 header + CRC8), and streams them chunked (64 bytes) to the BLE characteristic `0000ae01-0000-1000-8000-00805f9b34fb`. It flips the bitmap horizontally to match the printer's coordinate system and inserts setup commands (energy, quality, lattice control, feeds) before sending rows.
- **Assets** include the mascot SVG (`src/assets/icon.svg`) and an embedded WOFF of the IBM VGA font (`src/assets/WebPlus_IBM_VGA_9x16.woff`) referenced both by CSS and the `<img>` mascot in the UI.

## UI & Interaction Flow
1. Initial render shows the mascot, compatibility notice (only when `navigator.bluetooth` is missing), the Image/Text toggle, and a faux-receipt preview area. The primary CTA is disabled until Web Bluetooth is supported.
2. **Image mode**  
   - Users tap the receipt to open a hidden `<input type="file">`, paste, or drag/drop an image.  
   - `renderImage` resizes and dithers, storing `photoImageData`, which a `useEffect` paints on the preview canvas.  
   - Clicking `PURRINT!` sends the stored bitmap to `printImage`.
3. **Text mode**  
   - The `<textarea>` grows vertically (`useLayoutEffect` measuring `scrollHeight`).  
   - When printing, `renderTextToCanvas` (local helper) uses `canvas-txt` to split and draw IBM VGA text onto the canvas at `FONT_SIZE = 16` and `WIDTH = 384`. The produced `ImageData` goes straight to `printImage`.

## Image Processing Details (`src/services/render.ts`)
- Uses the DOM `Image` element and `canvas` API to acquire RGBA pixels.
- Converts each pixel to grayscale via simple RGB average, tracks min/max to stretch contrast (normalization) before dithering.
- Implements Atkinson dithering manually, scattering quantization error to neighboring pixels (x+1, x+2, x-1,y+1, etc.) to emulate thermal printer halftoning.
- Writes the binary grayscale back into the canvas and returns the buffer for downstream use, keeping preview and printer input identical.

## Bluetooth Printing Pipeline (`src/services/printer.ts`)
- Maintains a cached `BluetoothDevice` targeted by name filter `"MX06"` and optional service `0000ae30-0000-1000-8000-00805f9b34fb`.
- The helper `formatCommand` builds framed commands with CRC8 (`crc8_table`) and the printer's `0x51 0x78` preamble. Commands include energy (`0xaf`), bitmap draw (`0xa2`), feed (`0xa1`/`0xbd`), print lattice start/stop (`0xa6`), and dithering quality (`0xa4`).
- Each scanline packs 1 bit per pixel (`PRINTER_WIDTH / 8` bytes). Bits are inverted (1 = black) and reversed per byte to match the printer's expectation, then aggregated into the command stream.
- Command bytes are chunked into 64-byte writes with small delays to avoid overwhelming the BLE characteristic.

## Styling and Manifest
- Global styling resides in `src/index.css`, giving the retro receipt look (drop shadows, dashed notice, button hover translations). The CSS hides the preview canvas until an image exists, and uses nested rules for clarity.
- `vite.config.ts` wires `@vitejs/plugin-react` and `vite-plugin-pwa` to provide offline capability and a basic manifest pointing at the SVG icon.

## Tooling & Tasks
- `package.json` declares React 19, `canvas-txt`, the React DOM types, Typescript 5.8, Vite 7, and `vite-plugin-pwa`. No scripts live here; task orchestration happens in `mise`.
- `mise.toml` pins Deno (latest) as both runtime and package manager. Tasks include:  
  - `mise run dev` → Vite development server (hot reload, do not run inside this environment).  
  - `mise run build` → builds for production bundles.  
  - `mise run preview` → serves the Vite build output.  
  - A `postinstall` hook runs `deno install` to sync dependencies after tool downloads.  
- `deno.lock` tracks the dependency graph.

## Key Technical Constraints
- Canvas width and printer width are locked at 384 pixels; every processing step assumes that dimension. Changing printers means touching `WIDTH`, `PRINTER_WIDTH`, and dithering thresholds.
- Web Bluetooth currently works only on Chrome-based browsers with HTTPS (or localhost). The UI warns users when `navigator.bluetooth` is missing, and the print button stays disabled.
- Printing assumes images are already high-contrast after normalization; photos with limited contrast may need pre-adjustment outside the app.

## Extending the Project
- To add filters or brightness controls, extend `renderImage` before the dithering loop.
- Supporting other printers typically requires new `Command` constants, UUIDs, and bit packing order adjustments in `printImage`.
- Additional modes (e.g., QR codes) can reuse the existing `renderTextToCanvas` pattern: draw to the shared preview canvas, call `printImage` with the resulting bitmap.

