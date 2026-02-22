/**
 * LAZAR Dithering Stack Fix v3
 * Prevents dithering from stacking when re-applied.
 *
 * Problem: Resize/crop/text operations bake the dithered display canvas (ye)
 *          back into the backup canvas (Ne). When "Apply Dithering" re-runs,
 *          it reads already-dithered data from Ne → stacking.
 *
 * Fix: Maintain a pristine copy of Ne (the backup canvas). Before each
 *      "Apply Dithering" click, restore Ne from the pristine copy so
 *      dithering always starts from undithered image data.
 *
 * v3 changes:
 *   - Use getImageData/putImageData instead of drawImage for snapshot/restore
 *     to avoid premultiplied-alpha compositing bugs that caused black images
 *   - Added diagnostic logging (enable with: window.__DITHERFIX_DEBUG = true)
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     CONFIG
     ═══════════════════════════════════════════════════════════════════ */
  const DEBUG = () => window.__DITHERFIX_DEBUG === true;

  function log(...args) {
    if (DEBUG()) console.log('[ditherfix]', ...args);
  }
  function warn(...args) {
    console.warn('[ditherfix]', ...args);
  }

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  let pristineData = null;     // ImageData — raw pixel copy (no drawImage!)
  let pristineW = 0;
  let pristineH = 0;
  let backupCanvas = null;     // Reference to Ne (the app's hidden backup canvas)
  let prevW = 0;
  let prevH = 0;
  let snapshotReady = false;
  let modalWasOpen = false;

  /* ═══════════════════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════════════════ */

  /** Find the app's hidden backup canvas (Ne) — it has style="display: none" */
  function findBackupCanvas() {
    const all = document.querySelectorAll('canvas');
    for (const c of all) {
      if (c.style.display === 'none' && c.width > 0 && c.height > 0) return c;
    }
    return null;
  }

  /** Find the dithering button */
  function findDitherButton() {
    const buttons = document.querySelectorAll('.sidebar button.btn-primary');
    for (const b of buttons) {
      const t = b.textContent?.trim();
      if (t === 'Apply Dithering' || t === 'Re-Apply Dithering') return b;
    }
    return null;
  }

  /** Check if a canvas has real (non-transparent, non-black) pixel data */
  function hasContent(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    try {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const spots = [
        [Math.floor(w / 2), Math.floor(h / 2)],
        [Math.floor(w / 4), Math.floor(h / 4)],
        [Math.floor(3 * w / 4), Math.floor(3 * h / 4)],
        [Math.floor(w / 3), Math.floor(h / 3)],
        [Math.floor(2 * w / 3), Math.floor(2 * h / 3)],
      ];
      for (const [x, y] of spots) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        // Check for non-transparent AND non-black pixel
        if (d[3] > 0 && (d[0] > 0 || d[1] > 0 || d[2] > 0)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /** Check if ImageData has real (non-zero) pixel data */
  function imageDataHasContent(imgData) {
    if (!imgData || imgData.width === 0 || imgData.height === 0) return false;
    const d = imgData.data;
    const w = imgData.width, h = imgData.height;
    const spots = [
      [Math.floor(w / 2), Math.floor(h / 2)],
      [Math.floor(w / 4), Math.floor(h / 4)],
      [Math.floor(3 * w / 4), Math.floor(3 * h / 4)],
    ];
    for (const [x, y] of spots) {
      const idx = (y * w + x) * 4;
      if (d[idx + 3] > 0 && (d[idx] > 0 || d[idx + 1] > 0 || d[idx + 2] > 0)) return true;
    }
    return false;
  }

  /** Check if any destructive modal (crop, resize, text) is currently open */
  function isModalOpen() {
    return !!(
      document.querySelector('.crop-modal') ||
      document.querySelector('.resize-modal') ||
      document.querySelector('.text-modal')
    );
  }

  /** Compute a simple hash of pixel data for logging */
  function pixelHash(imgData) {
    if (!imgData) return 'null';
    const d = imgData.data;
    let sum = 0;
    const step = Math.max(4, Math.floor(d.length / 400)) & ~3; // align to 4
    for (let i = 0; i < d.length; i += step) sum += d[i];
    return imgData.width + 'x' + imgData.height + ':' + Math.round(sum);
  }

  /**
   * Snapshot: Use getImageData to capture raw bytes.
   * This avoids premultiplied-alpha issues that drawImage introduces.
   */
  function snapshotPristine() {
    if (!backupCanvas || backupCanvas.width === 0 || backupCanvas.height === 0) {
      log('snapshotPristine: skipped — canvas missing or 0-size');
      return;
    }
    if (!hasContent(backupCanvas)) {
      log('snapshotPristine: skipped — canvas has no visible content');
      return;
    }

    const ctx = backupCanvas.getContext('2d');
    pristineData = ctx.getImageData(0, 0, backupCanvas.width, backupCanvas.height);
    pristineW = backupCanvas.width;
    pristineH = backupCanvas.height;
    prevW = backupCanvas.width;
    prevH = backupCanvas.height;
    snapshotReady = true;

    log('snapshotPristine: captured', pristineW, 'x', pristineH,
      'hash:', pixelHash(pristineData));
  }

  /**
   * Restore: Use putImageData to write raw bytes directly.
   * This is the critical fix — the old version used drawImage which goes
   * through premultiplied-alpha compositing and can corrupt pixel data,
   * producing all-black output. putImageData writes raw RGBA bytes with
   * no compositing, matching exactly how the app's At() function writes
   * to Ne via putImageData.
   */
  function restoreBackup() {
    if (!pristineData || !backupCanvas || !snapshotReady) {
      warn('restoreBackup: skipped — state not ready',
        'hasPristine:', !!pristineData, 'hasBackup:', !!backupCanvas,
        'snapshotReady:', snapshotReady);
      return;
    }
    if (pristineW === 0 || pristineH === 0) {
      warn('restoreBackup: skipped — pristine dimensions are 0');
      return;
    }
    if (!imageDataHasContent(pristineData)) {
      warn('restoreBackup: skipped — pristine has no visible content');
      return;
    }

    const ctx = backupCanvas.getContext('2d');

    if (backupCanvas.width === pristineW && backupCanvas.height === pristineH) {
      // Dimensions match — use putImageData directly (byte-exact, no compositing)
      ctx.putImageData(pristineData, 0, 0);
      log('restoreBackup: restored via putImageData (exact match)',
        pristineW, 'x', pristineH);
    } else {
      // Dimensions differ (crop/resize happened) — need to scale
      // Create temp canvas with pristine data, then drawImage to scale
      log('restoreBackup: dimensions differ — pristine:', pristineW, 'x', pristineH,
        'backup:', backupCanvas.width, 'x', backupCanvas.height);
      const tmp = document.createElement('canvas');
      tmp.width = pristineW;
      tmp.height = pristineH;
      tmp.getContext('2d').putImageData(pristineData, 0, 0);

      ctx.clearRect(0, 0, backupCanvas.width, backupCanvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, backupCanvas.width, backupCanvas.height);
    }

    // Verify the restore worked
    if (DEBUG()) {
      const verifyData = ctx.getImageData(0, 0, backupCanvas.width, backupCanvas.height);
      log('restoreBackup: verification hash:', pixelHash(verifyData));
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     CLICK INTERCEPTOR — capture phase, fires BEFORE React handlers
     ═══════════════════════════════════════════════════════════════════ */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest?.('button');
    if (!btn) return;
    const text = btn.textContent?.trim();
    if (text !== 'Apply Dithering' && text !== 'Re-Apply Dithering') return;

    log('Dithering button clicked:', text);

    // Re-find backup canvas in case React recreated it
    backupCanvas = findBackupCanvas();
    if (!backupCanvas) {
      warn('click handler: backup canvas not found!');
      return;
    }

    log('click handler: backup canvas', backupCanvas.width, 'x', backupCanvas.height);

    if (!snapshotReady) {
      // First dithering ever — take snapshot now
      log('click handler: first dither — snapshotting');
      snapshotPristine();
      return; // No need to restore on first apply
    }

    // Restore backup from pristine before React's handler runs
    log('click handler: restoring from pristine before Sn runs');
    restoreBackup();
  }, true); // ← CAPTURE phase

  /* ═══════════════════════════════════════════════════════════════════
     POLLING — detect when backup canvas first gets content (image load)
     ═══════════════════════════════════════════════════════════════════ */
  let rafId = null;

  function poll() {
    const bc = findBackupCanvas();
    if (bc && bc.width > 0 && bc.height > 0) {
      const dimsChanged = bc.width !== prevW || bc.height !== prevH;
      if (bc !== backupCanvas || dimsChanged) {
        // New canvas appeared, or dimensions changed (image load / resize / crop)
        backupCanvas = bc;
        log('poll: detected canvas change',
          bc.width + 'x' + bc.height, 'prev:', prevW + 'x' + prevH);
        // Delay snapshot to let the drawing operation finish
        setTimeout(() => {
          if (hasContent(backupCanvas)) {
            log('poll: canvas has content after delay, snapshotting');
            snapshotPristine();
          } else {
            log('poll: canvas still empty after delay, skipping');
          }
        }, 300);
      }
    }
    rafId = requestAnimationFrame(poll);
  }

  /* ═══════════════════════════════════════════════════════════════════
     MUTATION OBSERVER — re-snapshot after crop/text modal closes
     ═══════════════════════════════════════════════════════════════════ */
  const domObserver = new MutationObserver(() => {
    const open = isModalOpen();

    if (modalWasOpen && !open) {
      // A modal just closed — re-snapshot Ne
      log('observer: modal closed, scheduling re-snapshot');
      setTimeout(() => {
        backupCanvas = findBackupCanvas();
        if (backupCanvas && hasContent(backupCanvas)) {
          snapshotPristine();
        }
      }, 300);
    }

    modalWasOpen = open;
  });

  /* ═══════════════════════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════════════════════ */
  function init() {
    log('initialized');
    poll();
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
