/**
 * LAZAR Image Upscale Tool
 * Adds a custom scale factor upscaling option to the Image Prep tab.
 * Allows upscaling the image before dithering for finer dot patterns.
 * Ensures upscaling is always applied to the pristine (undithered) image,
 * and integrates cleanly with crop/resize so nothing gets doubled or stacked.
 *
 * UI: Adds a button and input for custom scale factor (e.g., 1.5, 2, 3, etc.)
 *
 * Algorithm: Uses browser's built-in bicubic interpolation (imageSmoothingEnabled=true).
 */
(function () {
  'use strict';

  // Wait for React to render the sidebar
  function addUpscaleUI() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.querySelector('.lazar-upscale-group')) return;

    // Create upscale UI
    const group = document.createElement('div');
    group.className = 'lazar-upscale-group';
    group.style.margin = '24px 0 12px 0';
    group.style.display = 'flex';
    group.style.alignItems = 'center';
    group.style.gap = '8px';

    const label = document.createElement('label');
    label.textContent = 'Upscale:';
    label.style.fontWeight = 'bold';
    label.style.fontSize = '14px';
    group.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '0.01';
    input.value = '2';
    input.style.width = '60px';
    input.style.fontSize = '14px';
    input.style.padding = '2px 6px';
    group.appendChild(input);

    const btn = document.createElement('button');
    btn.textContent = 'Apply';
    btn.className = 'btn btn-secondary';
    btn.style.fontSize = '14px';
    btn.style.padding = '4px 12px';
    group.appendChild(btn);

    sidebar.insertBefore(group, sidebar.firstChild);

    btn.addEventListener('click', function () {
      const scale = parseFloat(input.value);
      if (!scale || scale < 1) return;
      upscaleImage(scale);
    });
  }

  // Upscale the backup canvas (Ne) and display canvas (ye)
  function upscaleImage(scale) {
    // Find canvases
    const backup = findBackupCanvas();
    const display = findDisplayCanvas();
    if (!backup || !display) return;

    // Always upscale from pristine (undithered) backup
    const ctx = backup.getContext('2d');
    const w = backup.width, h = backup.height;
    const imgData = ctx.getImageData(0, 0, w, h);

    // Create new upscaled canvas
    const upW = Math.round(w * scale);
    const upH = Math.round(h * scale);
    const upCanvas = document.createElement('canvas');
    upCanvas.width = upW;
    upCanvas.height = upH;
    const upCtx = upCanvas.getContext('2d');
    upCtx.imageSmoothingEnabled = true;
    upCtx.imageSmoothingQuality = 'high';

    // Draw original image data to upscaled canvas
    // Put original data, then scale
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d').putImageData(imgData, 0, 0);
    upCtx.drawImage(tmp, 0, 0, upW, upH);

    // Write upscaled image back to backup and display canvases
    backup.width = upW;
    backup.height = upH;
    display.width = upW;
    display.height = upH;
    backup.getContext('2d').drawImage(upCanvas, 0, 0);
    display.getContext('2d').drawImage(upCanvas, 0, 0);

    // Trigger ditherfix.js to re-capture pristine
    window.__DITHERFIX_FORCE_CAPTURE && window.__DITHERFIX_FORCE_CAPTURE();
  }

  function findBackupCanvas() {
    for (const c of document.querySelectorAll('canvas')) {
      if (c.style.display === 'none' && c.width > 0 && c.height > 0) return c;
    }
    return null;
  }
  function findDisplayCanvas() {
    for (const c of document.querySelectorAll('canvas')) {
      if (c.style.display !== 'none' && c.width > 0 && c.height > 0) return c;
    }
    return null;
  }

  // MutationObserver to add UI after React renders
  const observer = new MutationObserver(addUpscaleUI);
  observer.observe(document.body, { childList: true, subtree: true });

  // Expose force-capture for ditherfix.js
  window.__DITHERFIX_FORCE_CAPTURE = function () {
    const backup = findBackupCanvas();
    if (!backup) return;
    const ctx = backup.getContext('2d');
    if (ctx && backup.width > 0 && backup.height > 0) {
      // ditherfix.js v4 will see this write and re-capture
      ctx.putImageData(ctx.getImageData(0, 0, backup.width, backup.height), 0, 0);
    }
  };

})();