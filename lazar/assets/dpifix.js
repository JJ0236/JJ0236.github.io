/**
 * LAZAR DPI Fix
 * Intercepts image downloads (PNG, JPEG, BMP) and injects correct DPI
 * metadata into the binary. Without this, canvas.toDataURL() always
 * produces 72 DPI files regardless of what the user enters.
 *
 * Supported formats:
 *   PNG  → pHYs chunk injection
 *   JPEG → JFIF APP0 density field patching
 *   BMP  → biXPelsPerMeter / biYPelsPerMeter header patching
 *
 * Also monitors the resize modal's DPI input so the value persists across
 * the app lifecycle.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     SHARED DPI STATE
     ═══════════════════════════════════════════════════════════════════ */
  // Expose globally so 3dengrave.js (and any future tool) can read/write
  window.__lazarDpi = 300; // Default DPI

  /* ═══════════════════════════════════════════════════════════════════
     CRC-32 (needed for PNG chunk checksums)
     ═══════════════════════════════════════════════════════════════════ */
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }

  function crc32(buf, start, len) {
    let crc = 0xFFFFFFFF;
    for (let i = start; i < start + len; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ═══════════════════════════════════════════════════════════════════
     PNG pHYs CHUNK INJECTION
     ═══════════════════════════════════════════════════════════════════ */

  function buildPhysChunk(dpi) {
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, 9, false);          // data length = 9
    chunk[4] = 0x70; chunk[5] = 0x48;     // "pHYs"
    chunk[6] = 0x59; chunk[7] = 0x73;
    view.setUint32(8, ppm, false);        // X pixels per meter
    view.setUint32(12, ppm, false);       // Y pixels per meter
    chunk[16] = 1;                        // unit = meter
    view.setUint32(17, crc32(chunk, 4, 13), false);
    return chunk;
  }

  function hasPhysChunk(pngBytes) {
    for (let i = 8; i < pngBytes.length - 12; i++) {
      if (pngBytes[i + 4] === 0x70 && pngBytes[i + 5] === 0x48 &&
          pngBytes[i + 6] === 0x59 && pngBytes[i + 7] === 0x73) {
        return i;
      }
      if (pngBytes[i + 4] === 0x49 && pngBytes[i + 5] === 0x45 &&
          pngBytes[i + 6] === 0x4E && pngBytes[i + 7] === 0x44) {
        break;
      }
    }
    return -1;
  }

  function findFirstIdat(pngBytes) {
    let offset = 8;
    while (offset < pngBytes.length - 8) {
      const len = (pngBytes[offset] << 24) | (pngBytes[offset + 1] << 16) |
                  (pngBytes[offset + 2] << 8) | pngBytes[offset + 3];
      const type = String.fromCharCode(
        pngBytes[offset + 4], pngBytes[offset + 5],
        pngBytes[offset + 6], pngBytes[offset + 7]
      );
      if (type === 'IDAT') return offset;
      offset += 12 + len;
    }
    return -1;
  }

  function injectPngDpi(pngBuffer, dpi) {
    const src = new Uint8Array(pngBuffer);
    const physChunk = buildPhysChunk(dpi);

    const existingPos = hasPhysChunk(src);
    if (existingPos >= 0) {
      const result = new Uint8Array(src.length);
      result.set(src);
      result.set(physChunk, existingPos);
      return new Blob([result], { type: 'image/png' });
    }

    const idatPos = findFirstIdat(src);
    if (idatPos < 0) return new Blob([src], { type: 'image/png' });

    const result = new Uint8Array(src.length + 21);
    result.set(src.subarray(0, idatPos), 0);
    result.set(physChunk, idatPos);
    result.set(src.subarray(idatPos), idatPos + 21);
    return new Blob([result], { type: 'image/png' });
  }

  /* ═══════════════════════════════════════════════════════════════════
     JPEG JFIF DPI INJECTION
     The JFIF APP0 marker stores density at fixed offsets:
       Offset (within APP0 data):
         0-4:  "JFIF\0" identifier
         5-6:  version (1.01 or 1.02)
         7:    density units (0=no units, 1=DPI, 2=DPCM)
         8-9:  X density (big-endian uint16)
        10-11: Y density (big-endian uint16)
     APP0 marker starts at byte 2 in the file (after SOI 0xFFD8):
       bytes 2-3 = 0xFF 0xE0 (APP0 marker)
       bytes 4-5 = length (big-endian)
       bytes 6-10 = "JFIF\0"
       byte 11-12 = version
       byte 13 = density units
       bytes 14-15 = X density
       bytes 16-17 = Y density
     ═══════════════════════════════════════════════════════════════════ */

  function injectJpegDpi(jpegBuffer, dpi) {
    const src = new Uint8Array(jpegBuffer);

    // Verify JPEG SOI marker
    if (src[0] !== 0xFF || src[1] !== 0xD8) {
      return new Blob([src], { type: 'image/jpeg' });
    }

    // Check for JFIF APP0 marker at byte 2
    if (src[2] === 0xFF && src[3] === 0xE0) {
      // Verify "JFIF\0" identifier at bytes 6-10
      if (src[6] === 0x4A && src[7] === 0x46 && src[8] === 0x49 &&
          src[9] === 0x46 && src[10] === 0x00) {
        const result = new Uint8Array(src.length);
        result.set(src);
        // Set density units = 1 (DPI)
        result[13] = 1;
        // Set X density (big-endian uint16)
        result[14] = (dpi >> 8) & 0xFF;
        result[15] = dpi & 0xFF;
        // Set Y density (big-endian uint16)
        result[16] = (dpi >> 8) & 0xFF;
        result[17] = dpi & 0xFF;
        return new Blob([result], { type: 'image/jpeg' });
      }
    }

    // No JFIF APP0 found — inject one after SOI
    // Minimal JFIF APP0 segment: 2 marker + 2 length + 14 data = 18 bytes
    const app0 = new Uint8Array(18);
    app0[0] = 0xFF; app0[1] = 0xE0;   // APP0 marker
    app0[2] = 0x00; app0[3] = 0x10;   // length = 16 (includes length bytes, excludes marker)
    // "JFIF\0"
    app0[4] = 0x4A; app0[5] = 0x46; app0[6] = 0x49;
    app0[7] = 0x46; app0[8] = 0x00;
    // Version 1.01
    app0[9] = 0x01; app0[10] = 0x01;
    // Density units = 1 (DPI)
    app0[11] = 1;
    // X density
    app0[12] = (dpi >> 8) & 0xFF;
    app0[13] = dpi & 0xFF;
    // Y density
    app0[14] = (dpi >> 8) & 0xFF;
    app0[15] = dpi & 0xFF;
    // Thumbnail 0x0
    app0[16] = 0; app0[17] = 0;

    const result = new Uint8Array(src.length + 18);
    result.set(src.subarray(0, 2), 0);       // SOI
    result.set(app0, 2);                      // JFIF APP0
    result.set(src.subarray(2), 20);          // rest of file
    return new Blob([result], { type: 'image/jpeg' });
  }

  /* ═══════════════════════════════════════════════════════════════════
     BMP DPI INJECTION
     BMP stores resolution in the DIB header (BITMAPINFOHEADER):
       Offset 38-41: biXPelsPerMeter (little-endian int32)
       Offset 42-45: biYPelsPerMeter (little-endian int32)
     ═══════════════════════════════════════════════════════════════════ */

  function injectBmpDpi(bmpBuffer, dpi) {
    const src = new Uint8Array(bmpBuffer);

    // Verify BMP signature "BM"
    if (src[0] !== 0x42 || src[1] !== 0x4D) {
      return new Blob([src], { type: 'image/bmp' });
    }

    // Check DIB header size at offset 14 (must be >= 40 for BITMAPINFOHEADER)
    const dibSize = src[14] | (src[15] << 8) | (src[16] << 16) | (src[17] << 24);
    if (dibSize < 40 || src.length < 46) {
      return new Blob([src], { type: 'image/bmp' });
    }

    const ppm = Math.round(dpi / 0.0254);
    const result = new Uint8Array(src.length);
    result.set(src);
    const view = new DataView(result.buffer);
    // biXPelsPerMeter at offset 38 (little-endian)
    view.setInt32(38, ppm, true);
    // biYPelsPerMeter at offset 42 (little-endian)
    view.setInt32(42, ppm, true);
    return new Blob([result], { type: 'image/bmp' });
  }

  /* ═══════════════════════════════════════════════════════════════════
     FORMAT DISPATCHER
     ═══════════════════════════════════════════════════════════════════ */

  function injectDpi(buffer, dpi, format) {
    switch (format) {
      case 'png':  return injectPngDpi(buffer, dpi);
      case 'jpg':  return injectJpegDpi(buffer, dpi);
      case 'jpeg': return injectJpegDpi(buffer, dpi);
      case 'bmp':  return injectBmpDpi(buffer, dpi);
      default:     return null; // unsupported (webp)
    }
  }

  /** Detect format from filename extension */
  function getFormat(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext === 'bmp') return 'bmp';
    return null;
  }

  /** Detect MIME type for data: URLs */
  function getFormatFromMime(dataUrl) {
    if (dataUrl.startsWith('data:image/png'))  return 'png';
    if (dataUrl.startsWith('data:image/jpeg')) return 'jpg';
    if (dataUrl.startsWith('data:image/bmp'))  return 'bmp';
    return null;
  }

  /* ═══════════════════════════════════════════════════════════════════
     INTERCEPT DOWNLOADS
     Monkey-patch <a>.click() to catch image downloads and inject
     DPI metadata before the file is saved.
     ═══════════════════════════════════════════════════════════════════ */

  const pendingDownloads = new WeakSet();
  const origClick = HTMLAnchorElement.prototype.click;

  HTMLAnchorElement.prototype.click = function () {
    if (!this.download || !this.href) {
      return origClick.call(this);
    }

    const dpi = window.__lazarDpi || 300;
    if (dpi <= 72) {
      return origClick.call(this);
    }

    const format = getFormat(this.download);
    if (!format) {
      return origClick.call(this);
    }

    // Avoid infinite recursion
    if (pendingDownloads.has(this)) {
      pendingDownloads.delete(this);
      return origClick.call(this);
    }

    const href = this.href;
    const downloadName = this.download;
    const anchor = this;

    // Handle data: URLs (synchronous)
    if (href.startsWith('data:')) {
      const dataFormat = getFormatFromMime(href) || format;
      try {
        const binary = atob(href.split(',')[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const newBlob = injectDpi(bytes.buffer, dpi, dataFormat);
        if (!newBlob) return origClick.call(this);

        const newUrl = URL.createObjectURL(newBlob);
        anchor.href = newUrl;
        pendingDownloads.add(anchor);
        origClick.call(anchor);
        setTimeout(() => URL.revokeObjectURL(newUrl), 10000);
        return;
      } catch (e) {
        console.warn('[DPI Fix] Failed to inject DPI into data URL:', e);
        return origClick.call(this);
      }
    }

    // Handle blob: URLs (async — re-creates download after fetch)
    if (href.startsWith('blob:')) {
      fetch(href)
        .then(r => r.arrayBuffer())
        .then(buf => {
          const newBlob = injectDpi(buf, dpi, format);
          if (!newBlob) { origClick.call(anchor); return; }

          const newUrl = URL.createObjectURL(newBlob);
          anchor.href = newUrl;
          anchor.download = downloadName;
          pendingDownloads.add(anchor);
          origClick.call(anchor);
          setTimeout(() => URL.revokeObjectURL(newUrl), 10000);
        })
        .catch(e => {
          console.warn('[DPI Fix] Failed to inject DPI into blob:', e);
          origClick.call(anchor);
        });
      return;
    }

    return origClick.call(this);
  };

  /* ═══════════════════════════════════════════════════════════════════
     MONITOR RESIZE MODAL DPI INPUT
     Watch for the resize modal to appear and track DPI changes
     ═══════════════════════════════════════════════════════════════════ */

  function watchDpiInput() {
    // The resize modal has a DPI input with min=1, max=2400
    // Look for number inputs within .resize-modal or .resize-fields
    const inputs = document.querySelectorAll('.resize-modal input[type="number"], .resize-fields input[type="number"]');
    for (const input of inputs) {
      if (input.max === '2400' && !input.dataset.dpiWatched) {
        input.dataset.dpiWatched = '1';
        const updateDpi = () => {
          const val = parseInt(input.value, 10);
          if (val >= 1 && val <= 2400) {
            window.__lazarDpi = val;
          }
        };
        input.addEventListener('input', updateDpi);
        input.addEventListener('change', updateDpi);
        // Inject our persisted DPI into the input so the user sees it
        // instead of the hardcoded 300 default. Uses React's native
        // input value setter to trigger React's onChange handler.
        const currentDpi = window.__lazarDpi || 300;
        if (parseInt(input.value, 10) !== currentDpi) {
          const nativeSet = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          ).set;
          nativeSet.call(input, String(currentDpi));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Do NOT call updateDpi() here — that would read the modal's
        // default (300) and overwrite our persisted value.
      }
    }
  }

  // Also watch the Easy Mode DPI input
  function watchEasyModeDpi() {
    // Easy mode has a DPI input too — look for inputs near "DPI" label text
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent.trim() === 'DPI') {
        const input = label.parentElement?.querySelector('input[type="number"]');
        if (input && !input.dataset.dpiWatched) {
          input.dataset.dpiWatched = '1';
          const updateDpi = () => {
            const val = parseInt(input.value, 10);
            if (val >= 1 && val <= 2400) {
              window.__lazarDpi = val;
            }
          };
          input.addEventListener('input', updateDpi);
          input.addEventListener('change', updateDpi);
          // Inject persisted DPI into Easy Mode input too
          const currentDpi = window.__lazarDpi || 300;
          if (parseInt(input.value, 10) !== currentDpi) {
            const nativeSet = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value'
            ).set;
            nativeSet.call(input, String(currentDpi));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }
    }
  }

  // Observe DOM for modal appearances
  const observer = new MutationObserver(() => {
    watchDpiInput();
    watchEasyModeDpi();
  });

  function init() {
    watchDpiInput();
    watchEasyModeDpi();
    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[DPI Fix] Active — PNG/JPEG/BMP downloads will include DPI metadata');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
