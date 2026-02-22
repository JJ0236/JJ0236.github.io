/**
 * LAZAR Zoom & Pan
 * Adds mouse-wheel zoom and click-drag pan to the Image Prep canvas.
 * Injected into the LAZAR app — hooks into .canvas-container > canvas.
 *
 * Controls:
 *   Scroll wheel        → zoom in / out (centered on cursor)
 *   Left-click drag     → pan
 *   Double-click        → reset to fit (centered)
 *   Ctrl+0 / Cmd+0      → reset to fit
 *   Ctrl+= / Cmd+=      → zoom in
 *   Ctrl+- / Cmd+-      → zoom out
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     CONFIG
     ═══════════════════════════════════════════════════════════════════ */
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 32;
  const WHEEL_FACTOR = 0.001;   // sensitivity for scroll zoom
  const KB_ZOOM_STEP = 1.25;    // multiplier per keyboard zoom step

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let lastX = 0;
  let lastY = 0;
  let spaceHeld = false;
  let attached = false;
  let canvasEl = null;
  let containerEl = null;
  let areaEl = null;

  /* ═══════════════════════════════════════════════════════════════════
     ZOOM / PAN INDICATOR (bottom-right overlay)
     ═══════════════════════════════════════════════════════════════════ */
  let indicatorEl = null;
  let indicatorTimeout = null;

  function showIndicator() {
    if (!indicatorEl) return;
    const pct = Math.round(zoom * 100);
    indicatorEl.textContent = `${pct}%`;
    indicatorEl.style.opacity = '1';
    clearTimeout(indicatorTimeout);
    indicatorTimeout = setTimeout(() => {
      if (indicatorEl) indicatorEl.style.opacity = '0';
    }, 1200);
  }

  function createIndicator(parent) {
    if (indicatorEl) return;
    indicatorEl = document.createElement('div');
    indicatorEl.className = 'lazar-zoom-indicator';
    parent.appendChild(indicatorEl);
  }

  /* ═══════════════════════════════════════════════════════════════════
     APPLY TRANSFORM
     ═══════════════════════════════════════════════════════════════════ */
  function applyTransform() {
    if (!canvasEl) return;
    canvasEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    canvasEl.style.transformOrigin = '0 0';
    showIndicator();
  }

  function resetView() {
    fitCanvas();
  }

  /* ═══════════════════════════════════════════════════════════════════
     EVENT HANDLERS
     ═══════════════════════════════════════════════════════════════════ */

  function onWheel(e) {
    e.preventDefault();
    const rect = areaEl.getBoundingClientRect();
    // Cursor position relative to the canvas-area container
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Point on the canvas under the cursor (in canvas-area coords, before transform)
    const oldZoom = zoom;
    const delta = -e.deltaY * WHEEL_FACTOR;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * Math.exp(delta)));

    // Adjust pan so the point under the cursor stays fixed
    const scale = newZoom / oldZoom;
    panX = cx - scale * (cx - panX);
    panY = cy - scale * (cy - panY);
    zoom = newZoom;

    applyTransform();
  }

  function onPointerDown(e) {
    // Pan on any mouse button (left, middle, right)
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;

    e.preventDefault();
    isPanning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    areaEl.style.cursor = 'grabbing';
    areaEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!isPanning) return;
    e.preventDefault();
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    panX += dx;
    panY += dy;
    applyTransform();
  }

  function onPointerUp(e) {
    if (!isPanning) return;
    isPanning = false;
    areaEl.style.cursor = 'grab';
    areaEl.releasePointerCapture(e.pointerId);
  }

  function onDblClick(e) {
    // Only reset if not interacting with UI elements
    if (e.target !== canvasEl && e.target !== containerEl && e.target !== areaEl) return;
    e.preventDefault();
    resetView();
  }

  function onContextMenu(e) {
    // Suppress context menu on canvas area so right-drag works
    e.preventDefault();
  }

  function onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    if (e.key === '0') {
      e.preventDefault();
      resetView();
    } else if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      zoomBy(KB_ZOOM_STEP);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomBy(1 / KB_ZOOM_STEP);
    }
  }

  function onKeyUp(e) {
    // reserved for future shortcuts
  }

  function zoomBy(factor) {
    if (!areaEl) return;
    const rect = areaEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const oldZoom = zoom;
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    const scale = zoom / oldZoom;
    panX = cx - scale * (cx - panX);
    panY = cy - scale * (cy - panY);
    applyTransform();
  }

  /* ═══════════════════════════════════════════════════════════════════
     ATTACH / DETACH
     ═══════════════════════════════════════════════════════════════════ */

  function attach(area, container, canvas) {
    if (attached) return;
    areaEl = area;
    containerEl = container;
    canvasEl = canvas;
    attached = true;

    // Remove CSS constraints that fight with transform-based zoom
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.objectFit = '';

    // Neutralize flexbox centering — we position via transform instead
    container.style.overflow = 'visible';
    container.style.alignItems = 'flex-start';
    container.style.justifyContent = 'flex-start';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.position = 'relative';

    // Canvas must sit at container origin (0,0) for transform math
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';

    // Let the canvas be its natural pixel size scaled down to fit initially
    fitCanvas();

    // Events on the area (not canvas) so pan works even when zoomed out
    area.addEventListener('wheel', onWheel, { passive: false });
    area.addEventListener('pointerdown', onPointerDown);
    area.addEventListener('pointermove', onPointerMove);
    area.addEventListener('pointerup', onPointerUp);
    area.addEventListener('pointercancel', onPointerUp);
    area.addEventListener('dblclick', onDblClick);
    area.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Default cursor — indicates draggable
    area.style.cursor = 'grab';

    createIndicator(area);
    showIndicator();
  }

  function fitCanvas() {
    if (!canvasEl || !areaEl) return;
    const cw = canvasEl.width;
    const ch = canvasEl.height;
    if (!cw || !ch) return;

    const rect = areaEl.getBoundingClientRect();
    const padding = 40; // breathing room around canvas
    const availW = rect.width - padding;
    const availH = rect.height - padding;
    if (availW <= 0 || availH <= 0) return;

    const fitZoom = Math.min(1, availW / cw, availH / ch);
    zoom = fitZoom;
    // Center the canvas
    panX = (rect.width - cw * zoom) / 2;
    panY = (rect.height - ch * zoom) / 2;
    applyTransform();
  }

  function detach() {
    if (!attached) return;
    if (areaEl) {
      areaEl.removeEventListener('wheel', onWheel);
      areaEl.removeEventListener('pointerdown', onPointerDown);
      areaEl.removeEventListener('pointermove', onPointerMove);
      areaEl.removeEventListener('pointerup', onPointerUp);
      areaEl.removeEventListener('pointercancel', onPointerUp);
      areaEl.removeEventListener('dblclick', onDblClick);
      areaEl.removeEventListener('contextmenu', onContextMenu);
      areaEl.style.cursor = '';
    }
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
    }
    canvasEl = null;
    containerEl = null;
    areaEl = null;
    attached = false;
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  /* ═══════════════════════════════════════════════════════════════════
     CSS
     ═══════════════════════════════════════════════════════════════════ */
  const CSS = `
    .canvas-area {
      overflow: hidden !important;
      position: relative !important;
    }
    .canvas-container {
      pointer-events: none;
    }
    .canvas-container canvas {
      will-change: transform;
      image-rendering: auto;
      pointer-events: auto;
    }
    /* Crisp pixels when zoomed in past 100% */
    .canvas-container canvas[data-zoom-crisp] {
      image-rendering: pixelated;
    }
    .lazar-zoom-indicator {
      position: absolute;
      bottom: 36px;
      right: 12px;
      background: rgba(0, 0, 0, 0.7);
      color: #ccc;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-family: 'Inter', monospace;
      pointer-events: none;
      z-index: 20;
      opacity: 0;
      transition: opacity 0.3s;
    }
  `;

  function injectStyles() {
    if (document.getElementById('lazar-zoom-styles')) return;
    const s = document.createElement('style');
    s.id = 'lazar-zoom-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════════
     OBSERVER — watch for canvas to appear / change
     ═══════════════════════════════════════════════════════════════════ */

  // Watch for canvas dimension changes (resize, new image load)
  let canvasObserver = null;
  let lastCanvasW = 0;
  let lastCanvasH = 0;

  function watchCanvasDimensions() {
    if (!canvasEl) return;
    // Poll via rAF since canvas .width/.height changes aren't observable via MutationObserver attributes
    function check() {
      if (!canvasEl || !attached) return;
      if (canvasEl.width !== lastCanvasW || canvasEl.height !== lastCanvasH) {
        lastCanvasW = canvasEl.width;
        lastCanvasH = canvasEl.height;
        fitCanvas();
      }
      requestAnimationFrame(check);
    }
    lastCanvasW = canvasEl.width;
    lastCanvasH = canvasEl.height;
    requestAnimationFrame(check);
  }

  function tryAttach() {
    const area = document.querySelector('.canvas-area');
    if (!area) return;
    const container = area.querySelector('.canvas-container');
    if (!container) { detach(); return; }
    const canvas = container.querySelector('canvas');
    if (!canvas) { detach(); return; }

    // Already attached to this canvas
    if (attached && canvasEl === canvas) return;

    // Different canvas or first time
    detach();
    attach(area, container, canvas);
    watchCanvasDimensions();
  }

  const domObserver = new MutationObserver(() => {
    // Only act on Image Prep tab (not 3D engrave)
    const body3d = document.querySelector('.app-body-3d');
    if (body3d) { detach(); return; }
    tryAttach();
  });

  function init() {
    injectStyles();
    tryAttach();
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
