/**
 * LAZAR Dithering Stack Fix v4
 *
 * Prevents dithering from stacking when re-applied.
 *
 * Problem: Resize/crop/text operations read from the display canvas (ye,
 *          which may contain dithered output) and write the result to the
 *          backup canvas (Ne). When "Apply Dithering" re-runs, it reads
 *          already-dithered data from Ne → stacking artefacts.
 *
 * Strategy (v4 — complete rewrite):
 *   Instead of polling with rAF + fragile hasContent checks, we monkey-patch
 *   CanvasRenderingContext2D.drawImage and .putImageData to detect writes
 *   to the backup canvas (Ne, identified by style.display === "none").
 *
 *   We track an `isDithered` flag ourselves. Whenever a CLEAN write lands
 *   on the backup canvas (isDithered === false), we capture a pristine
 *   snapshot via getImageData. Before each "Apply/Re-Apply Dithering"
 *   click, we restore the snapshot to Ne so dithering always starts from
 *   undithered pixel data.
 *
 * Advantages over v3:
 *   - No rAF polling (zero per-frame overhead)
 *   - No hasContent heuristic (dark images work)
 *   - No 300ms timing delays / race conditions
 *   - No MutationObserver
 *   - Exact capture at the moment of write
 *
 * Debug: set  window.__DITHERFIX_DEBUG = true  in the console.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     DEBUG HELPERS
     ═══════════════════════════════════════════════════════════════════ */
  const DEBUG = () => window.__DITHERFIX_DEBUG === true;
  function log(...a) { if (DEBUG()) console.log('[ditherfix]', ...a); }
  function warn(...a) { console.warn('[ditherfix]', ...a); }

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  let pristineData = null;   // ImageData — raw pixel snapshot
  let pristineW    = 0;
  let pristineH    = 0;
  let isDithered   = false;  // has dithering been applied since last clean state?
  let captureQueued = false; // prevents redundant captures in same microtask

  /* ═══════════════════════════════════════════════════════════════════
     ORIGINAL (UNPATCHED) CANVAS METHODS
     ═══════════════════════════════════════════════════════════════════ */
  const _drawImage    = CanvasRenderingContext2D.prototype.drawImage;
  const _putImageData = CanvasRenderingContext2D.prototype.putImageData;
  const _getImageData = CanvasRenderingContext2D.prototype.getImageData;
  const _clearRect    = CanvasRenderingContext2D.prototype.clearRect;

  /* ═══════════════════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════════════════ */

  /** Is this the hidden backup canvas (Ne)? */
  function isBackup(canvas) {
    return canvas &&
           canvas.style.display === 'none' &&
           canvas.width  > 0 &&
           canvas.height > 0;
  }

  /** Find the backup canvas by iterating all <canvas> elements */
  function findBackupCanvas() {
    for (const c of document.querySelectorAll('canvas')) {
      if (isBackup(c)) return c;
    }
    return null;
  }

  /** Capture a pristine snapshot of the backup canvas (raw bytes) */
  function capture(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext('2d');
    pristineData = _getImageData.call(ctx, 0, 0, canvas.width, canvas.height);
    pristineW = canvas.width;
    pristineH = canvas.height;
    log('captured pristine', pristineW + 'x' + pristineH);
  }

  /** Schedule a capture at end of current microtask (coalesces multiple writes) */
  function scheduleCapture(canvas) {
    if (captureQueued) return;
    captureQueued = true;
    Promise.resolve().then(() => {
      captureQueued = false;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        capture(canvas);
      }
    });
  }

  /**
   * Restore the backup canvas from our pristine snapshot.
   * Uses putImageData for byte-exact restore when dimensions match;
   * falls back to drawImage scaling when they differ (post-crop/resize).
   */
  function restore(canvas) {
    if (!pristineData || !canvas) {
      warn('restore: no pristine data or canvas');
      return false;
    }
    const ctx = canvas.getContext('2d');

    if (canvas.width === pristineW && canvas.height === pristineH) {
      // Byte-exact restore — no compositing, no quality loss
      _putImageData.call(ctx, pristineData, 0, 0);
      log('restored via putImageData (exact)', pristineW + 'x' + pristineH);
    } else {
      // Dimensions differ — need to scale through a temp canvas
      log('restored via drawImage (scaled)',
        pristineW + 'x' + pristineH, '→', canvas.width + 'x' + canvas.height);
      const tmp = document.createElement('canvas');
      tmp.width  = pristineW;
      tmp.height = pristineH;
      _putImageData.call(tmp.getContext('2d'), pristineData, 0, 0);

      _clearRect.call(ctx, 0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      _drawImage.call(ctx, tmp, 0, 0, canvas.width, canvas.height);
    }
    return true;
  }

  /* ═══════════════════════════════════════════════════════════════════
     CANVAS WRITE INTERCEPTORS
     Detect every write to the backup canvas. If we're in a "clean"
     state (isDithered === false), capture a pristine snapshot.
     Uses the unpatched _getImageData so our own reads don't recurse.
     ═══════════════════════════════════════════════════════════════════ */

  CanvasRenderingContext2D.prototype.drawImage = function (source) {
    // Call the real drawImage with all original arguments
    const result = _drawImage.apply(this, arguments);

    const canvas = this.canvas;
    if (isBackup(canvas)) {
      // Detect when an HTMLImageElement is drawn → new image load via At()
      if (source instanceof HTMLImageElement) {
        log('HTMLImageElement drawn to backup → new image load, resetting');
        isDithered = false;
        scheduleCapture(canvas);
      } else if (!isDithered) {
        // Clean (pre-dithering) write from crop/resize/text
        scheduleCapture(canvas);
      }
      // If isDithered && not an Image element → contaminated write from
      // ds/Ir reading dithered ye → skip capture (keep old pristine)
    }

    return result;
  };

  CanvasRenderingContext2D.prototype.putImageData = function (imageData, dx, dy) {
    const result = _putImageData.apply(this, arguments);

    const canvas = this.canvas;
    if (isBackup(canvas)) {
      // Full-canvas putImageData on a hidden canvas usually means
      // At() writing the freshly loaded image
      if (imageData &&
          imageData.width === canvas.width &&
          imageData.height === canvas.height) {
        if (isDithered) {
          log('full-canvas putImageData on backup → resetting isDithered');
          isDithered = false;
        }
        scheduleCapture(canvas);
      } else if (!isDithered) {
        scheduleCapture(canvas);
      }
    }

    return result;
  };

  /* ═══════════════════════════════════════════════════════════════════
     CLICK INTERCEPTOR — capture phase, fires BEFORE React handlers
     ═══════════════════════════════════════════════════════════════════ */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest?.('button');
    if (!btn) return;
    const text = btn.textContent?.trim();
    if (text !== 'Apply Dithering' && text !== 'Re-Apply Dithering') return;

    log('dither button clicked:', text,
        '| isDithered:', isDithered,
        '| hasPristine:', !!pristineData,
        '| pristineDims:', pristineW + 'x' + pristineH);

    const canvas = findBackupCanvas();
    if (!canvas) {
      warn('backup canvas not found!');
      return;
    }

    if (!pristineData) {
      // First ever dithering and interceptors didn't fire yet — capture now
      log('first apply — capturing pristine now');
      capture(canvas);
      isDithered = true;
      return;
    }

    // Restore backup from pristine before React's Sn handler reads it
    log('restoring pristine before dithering');
    const ok = restore(canvas);
    if (ok) log('restore successful');
    isDithered = true;
  }, true); // ← CAPTURE phase

  /* ═══════════════════════════════════════════════════════════════════
     FILE INPUT / DRAG-DROP / PASTE — reset state on new image
     ═══════════════════════════════════════════════════════════════════ */

  document.addEventListener('change', function (e) {
    const input = e.target;
    if (input.type === 'file' && input.files && input.files.length > 0) {
      log('file input change → resetting state');
      isDithered = false;
      pristineData = null;
    }
  }, true);

  document.addEventListener('drop', function (e) {
    if (e.dataTransfer?.files?.length > 0) {
      log('drop event → resetting state');
      isDithered = false;
      pristineData = null;
    }
  }, true);

  document.addEventListener('paste', function () {
    log('paste event → resetting state');
    isDithered = false;
    pristineData = null;
  }, true);

  /* ═══════════════════════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════════════════════ */
  log('v4 initialized — intercepting canvas writes');

})();
