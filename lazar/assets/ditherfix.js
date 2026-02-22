/**
 * LAZAR Dithering Stack Fix
 * Prevents dithering from stacking when re-applied.
 *
 * Problem: Resize/crop/text operations bake the dithered display canvas (ye)
 *          back into the backup canvas (Ne). When "Apply Dithering" re-runs,
 *          it reads already-dithered data from Ne → stacking.
 *
 * Fix: Maintain a pristine copy of Ne (the backup canvas). Before each
 *      "Apply Dithering" click, restore Ne from the pristine copy so
 *      dithering always starts from undithered image data.
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  let pristineCanvas = null;   // Our hidden pristine copy
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

  /** Check if a canvas has real (non-transparent) pixel data */
  function hasContent(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    try {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      // Sample a few pixels from center and edges
      const spots = [
        [Math.floor(w / 2), Math.floor(h / 2)],
        [Math.floor(w / 4), Math.floor(h / 4)],
        [Math.floor(3 * w / 4), Math.floor(3 * h / 4)],
      ];
      for (const [x, y] of spots) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        if (d[3] > 0) return true; // non-transparent pixel found
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /** Check if any destructive modal (crop, resize) is currently open */
  function isModalOpen() {
    return !!(
      document.querySelector('.crop-modal') ||
      document.querySelector('.resize-modal') ||
      document.querySelector('.text-modal')
    );
  }

  /** Snapshot the backup canvas into our pristine copy */
  function snapshotPristine() {
    if (!backupCanvas || backupCanvas.width === 0 || backupCanvas.height === 0) return;
    if (!hasContent(backupCanvas)) return; // Don't snapshot an empty canvas
    if (!pristineCanvas) pristineCanvas = document.createElement('canvas');
    pristineCanvas.width = backupCanvas.width;
    pristineCanvas.height = backupCanvas.height;
    const ctx = pristineCanvas.getContext('2d');
    ctx.drawImage(backupCanvas, 0, 0);
    prevW = backupCanvas.width;
    prevH = backupCanvas.height;
    snapshotReady = true;
  }

  /** Restore the backup canvas from our pristine copy (resize if needed) */
  function restoreBackup() {
    if (!pristineCanvas || !backupCanvas || !snapshotReady) return;
    if (pristineCanvas.width === 0 || pristineCanvas.height === 0) return;
    if (!hasContent(pristineCanvas)) return; // Don't restore an empty pristine canvas

    const ctx = backupCanvas.getContext('2d');
    ctx.clearRect(0, 0, backupCanvas.width, backupCanvas.height);

    // Draw pristine onto backup (handles resize gracefully)
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pristineCanvas, 0, 0, backupCanvas.width, backupCanvas.height);
  }

  /* ═══════════════════════════════════════════════════════════════════
     CLICK INTERCEPTOR — capture phase, fires BEFORE React handlers
     ═══════════════════════════════════════════════════════════════════ */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest?.('button');
    if (!btn) return;
    const text = btn.textContent?.trim();
    if (text !== 'Apply Dithering' && text !== 'Re-Apply Dithering') return;

    // Re-find backup canvas in case React recreated it
    backupCanvas = findBackupCanvas();
    if (!backupCanvas) return;

    if (!snapshotReady) {
      // First dithering ever — take snapshot now
      snapshotPristine();
      return; // No need to restore on first apply
    }

    // Restore backup from pristine before React's handler runs
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
        // Delay snapshot to let the drawing operation finish
        setTimeout(() => {
          if (hasContent(backupCanvas)) {
            snapshotPristine();
          }
        }, 300);
      }
    }
    rafId = requestAnimationFrame(poll);
  }

  /* ═══════════════════════════════════════════════════════════════════
     MUTATION OBSERVER — re-snapshot after crop/text modal closes
     (only if dithering hasn't been applied yet, so data is clean)
     ═══════════════════════════════════════════════════════════════════ */
  const domObserver = new MutationObserver(() => {
    const open = isModalOpen();

    if (modalWasOpen && !open) {
      // A modal just closed — re-snapshot Ne if it's still clean
      // Ne is "clean" if the dithering button still says "Apply Dithering"
      // (not "Re-Apply"), meaning no dithering has been done yet
      setTimeout(() => {
        const btn = findDitherButton();
        backupCanvas = findBackupCanvas();
        if (backupCanvas && hasContent(backupCanvas)) {
          // Always re-snapshot after modal close — the crop/resize/text
          // operation baked the current state into Ne, which is fresh
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
    poll();
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
