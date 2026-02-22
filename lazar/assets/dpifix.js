/**
 * LAZAR DPI Fix
 * Intercepts PNG downloads from the Image Prep tab and injects correct DPI
 * metadata (pHYs chunk) into the PNG binary. Without this, canvas.toDataURL()
 * always produces 72 DPI files regardless of what the user enters.
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

  /**
   * Build a 21-byte pHYs chunk (4 len + 4 type + 9 data + 4 crc).
   * @param {number} dpi – dots per inch
   * @returns {Uint8Array} complete pHYs chunk
   */
  function buildPhysChunk(dpi) {
    const ppm = Math.round(dpi / 0.0254); // pixels per meter
    const chunk = new Uint8Array(21);
    const view = new DataView(chunk.buffer);

    // Length of data section = 9
    view.setUint32(0, 9, false);

    // Chunk type: "pHYs"
    chunk[4] = 0x70; // p
    chunk[5] = 0x48; // H
    chunk[6] = 0x59; // Y
    chunk[7] = 0x73; // s

    // X pixels per unit (big-endian)
    view.setUint32(8, ppm, false);

    // Y pixels per unit (big-endian)
    view.setUint32(12, ppm, false);

    // Unit = 1 (meter)
    chunk[16] = 1;

    // CRC over type + data (bytes 4..16 inclusive = 13 bytes)
    const crc = crc32(chunk, 4, 13);
    view.setUint32(17, crc, false);

    return chunk;
  }

  /**
   * Check if a PNG already has a pHYs chunk.
   */
  function hasPhysChunk(pngBytes) {
    // pHYs = 0x70 0x48 0x59 0x73
    for (let i = 8; i < pngBytes.length - 12; i++) {
      if (pngBytes[i + 4] === 0x70 &&
          pngBytes[i + 5] === 0x48 &&
          pngBytes[i + 6] === 0x59 &&
          pngBytes[i + 7] === 0x73) {
        return i; // offset of the length field
      }
      // Also check for IEND to stop early
      if (pngBytes[i + 4] === 0x49 &&
          pngBytes[i + 5] === 0x45 &&
          pngBytes[i + 6] === 0x4E &&
          pngBytes[i + 7] === 0x44) {
        break;
      }
    }
    return -1;
  }

  /**
   * Find the first IDAT chunk position in a PNG.
   * pHYs must appear before the first IDAT.
   */
  function findFirstIdat(pngBytes) {
    let offset = 8; // skip 8-byte PNG signature
    while (offset < pngBytes.length - 8) {
      const len = (pngBytes[offset] << 24) | (pngBytes[offset + 1] << 16) |
                  (pngBytes[offset + 2] << 8) | pngBytes[offset + 3];
      const type = String.fromCharCode(
        pngBytes[offset + 4], pngBytes[offset + 5],
        pngBytes[offset + 6], pngBytes[offset + 7]
      );
      if (type === 'IDAT') return offset;
      offset += 12 + len; // 4 len + 4 type + data + 4 crc
    }
    return -1;
  }

  /**
   * Inject or replace pHYs chunk in a PNG ArrayBuffer.
   * @param {ArrayBuffer} pngBuffer
   * @param {number} dpi
   * @returns {Blob} new PNG blob with correct DPI
   */
  function injectDpi(pngBuffer, dpi) {
    const src = new Uint8Array(pngBuffer);
    const physChunk = buildPhysChunk(dpi);

    // Check for existing pHYs
    const existingPos = hasPhysChunk(src);
    if (existingPos >= 0) {
      // Replace existing pHYs chunk (it's always 21 bytes: 4+4+9+4)
      const result = new Uint8Array(src.length);
      result.set(src);
      result.set(physChunk, existingPos);
      return new Blob([result], { type: 'image/png' });
    }

    // Insert before first IDAT
    const idatPos = findFirstIdat(src);
    if (idatPos < 0) {
      // Can't find IDAT, return original
      return new Blob([src], { type: 'image/png' });
    }

    const result = new Uint8Array(src.length + 21);
    result.set(src.subarray(0, idatPos), 0);           // everything before IDAT
    result.set(physChunk, idatPos);                      // pHYs chunk
    result.set(src.subarray(idatPos), idatPos + 21);    // IDAT onward
    return new Blob([result], { type: 'image/png' });
  }

  /* ═══════════════════════════════════════════════════════════════════
     INTERCEPT DOWNLOADS
     We monkey-patch the <a> element click to catch PNG downloads and
     inject the pHYs chunk before the file is saved.
     ═══════════════════════════════════════════════════════════════════ */

  const origCreateElement = document.createElement.bind(document);
  const pendingDownloads = new WeakSet();

  // Override click on anchor elements that have a download attribute
  // and a data:image/png or blob: href
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.download || !this.href) {
      return origClick.call(this);
    }

    const dpi = window.__lazarDpi || 300;
    if (dpi <= 72) {
      // 72 DPI is the canvas default, no injection needed
      return origClick.call(this);
    }

    // Only intercept PNG downloads
    const isPng = this.download.toLowerCase().endsWith('.png');
    if (!isPng) {
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

    // Handle data: URLs
    if (href.startsWith('data:image/png')) {
      try {
        const binary = atob(href.split(',')[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const newBlob = injectDpi(bytes.buffer, dpi);
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

    // Handle blob: URLs
    if (href.startsWith('blob:')) {
      fetch(href)
        .then(r => r.arrayBuffer())
        .then(buf => {
          const newBlob = injectDpi(buf, dpi);
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

    // Not a data/blob URL, pass through
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
        // Read current value
        updateDpi();
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
          updateDpi();
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
    console.log('[DPI Fix] Active — PNG downloads will include DPI metadata');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
