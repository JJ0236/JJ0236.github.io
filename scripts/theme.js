// scripts/theme.js — one theme for the whole site.
//
// Loaded before paint so the page never flashes the wrong theme. Resolves
// auto/light/dark, stamps data-theme on <html>, and gives canvas-based tools a
// way to read the current colours and to hear about a change, because a WebGL
// scene or a 2D preview cannot inherit CSS.

(function () {
  const KEY = 'site-theme';                 // 'auto' | 'light' | 'dark'
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const read = () => {
    try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
  };
  const resolve = pref => (pref === 'auto' ? (media.matches ? 'dark' : 'light') : pref);

  let pref = read();
  const listeners = new Set();

  function apply(next, notify = true) {
    pref = next;
    const actual = resolve(pref);
    root.setAttribute('data-theme', actual);
    root.style.colorScheme = actual;
    try { localStorage.setItem(KEY, pref); } catch { /* private window */ }
    document.querySelectorAll('.theme-seg button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.theme === pref)));
    if (notify) {
      for (const fn of listeners) { try { fn(actual); } catch { /* a tool's own problem */ } }
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: actual } }));
    }
  }

  // Stamp immediately: this file is loaded in <head>, before any paint.
  apply(pref, false);
  media.addEventListener('change', () => { if (pref === 'auto') apply('auto'); });

  /**
   * Colours for canvases. CSS cannot reach a WebGL scene or a 2D context, so
   * tools read the same custom properties the stylesheet uses and redraw when
   * the theme changes. Returns a hex string; `num` gives 0xRRGGBB for three.js.
   */
  const css = name => getComputedStyle(root).getPropertyValue(name).trim();
  const toNum = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    return m ? parseInt(m[1], 16) : 0x000000;
  };

  window.siteTheme = {
    get current() { return resolve(pref); },
    get preference() { return pref; },
    isDark() { return resolve(pref) === 'dark'; },
    colour(name) { return css(name.startsWith('--') ? name : `--${name}`); },
    number(name) { return toNum(this.colour(name)); },
    set(next) { apply(next); },
    /** Call fn now and on every theme change. Returns an unsubscribe. */
    onChange(fn) {
      listeners.add(fn);
      try { fn(resolve(pref)); } catch { /* ignore */ }
      return () => listeners.delete(fn);
    },
  };

  const CONTROL =
    '<span class="theme-seg" role="group" aria-label="Colour theme">' +
      '<button type="button" data-theme="auto" title="Follow the system setting">auto</button>' +
      '<button type="button" data-theme="light" title="Always light">light</button>' +
      '<button type="button" data-theme="dark" title="Always dark">dark</button>' +
    '</span>';

  // Place the control itself rather than making fourteen tool pages carry the
  // same markup. The sidebar is built by nav.js, so it asks for this directly.
  function place() {
    const bar = document.querySelector('.tool-header');
    if (bar && !bar.querySelector('.theme-seg')) {
      const site = bar.querySelector('.tool-header-site');
      const right = document.createElement('div');
      right.className = 'tool-header-right';
      if (site) { site.replaceWith(right); right.appendChild(site); }
      else bar.appendChild(right);
      right.insertAdjacentHTML('beforeend', CONTROL);
    }
    const foot = document.querySelector('.sidebar-footer');
    if (foot && !foot.querySelector('.theme-seg')) foot.insertAdjacentHTML('beforeend', CONTROL);
  }

  // Wire any control that exists once the DOM is up, and again if a script
  // injects the sidebar or tool header later.
  const wire = () => {
    place();
    document.querySelectorAll('.theme-seg button').forEach(b => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.setAttribute('aria-pressed', String(b.dataset.theme === pref));
      b.addEventListener('click', () => apply(b.dataset.theme));
    });
  };
  window.siteTheme.wire = wire;
  window.siteTheme.place = place;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
