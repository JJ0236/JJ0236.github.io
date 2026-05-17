/* ============================================================
   OZARK TOURS — Main JavaScript
   Progressive enhancement: add .js class so CSS can set
   initial hidden states for animated elements.
   ============================================================ */

(function () {
  'use strict';

  // Signal to CSS that JS is active (enables animation initial states)
  document.documentElement.classList.add('js');

  /* ----------------------------------------------------------
     NAV: transparent over hero, solid when scrolled
  ---------------------------------------------------------- */
  const nav = document.getElementById('nav');

  function updateNav() {
    nav.classList.toggle('nav--scrolled', window.scrollY > 50);
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();

  /* ----------------------------------------------------------
     MOBILE NAV TOGGLE
  ---------------------------------------------------------- */
  const hamburger  = document.getElementById('hamburger');
  const navLinks   = document.getElementById('navLinks');

  function closeMenu() {
    hamburger.classList.remove('is-open');
    navLinks.classList.remove('is-open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', () => {
    const isOpen = hamburger.classList.toggle('is-open');
    navLinks.classList.toggle('is-open', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  // Close when any nav link is tapped
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });

  /* ----------------------------------------------------------
     HERO: subtle zoom-in on page load
  ---------------------------------------------------------- */
  const hero = document.getElementById('hero');

  if (document.readyState === 'complete') {
    hero.classList.add('is-loaded');
  } else {
    window.addEventListener('load', () => hero.classList.add('is-loaded'));
  }

  /* ----------------------------------------------------------
     INTERSECTION OBSERVER: Generic fade-in
  ---------------------------------------------------------- */
  const fadeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          fadeObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  document.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));

  /* ----------------------------------------------------------
     TESTIMONIAL: fade in when visible
  ---------------------------------------------------------- */
  const testimonialInner = document.querySelector('.testimonial__inner');
  if (testimonialInner) {
    testimonialInner.classList.add('fade-in');
    fadeObserver.observe(testimonialInner);
  }

  /* ----------------------------------------------------------
     WHY ITEMS: staggered sequential reveal (01–05)
  ---------------------------------------------------------- */
  const whyList = document.querySelector('.why__list');

  if (whyList) {
    const whyObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const items = whyList.querySelectorAll('[data-reveal]');
            items.forEach((item, i) => {
              setTimeout(() => {
                item.classList.add('is-visible');
              }, i * 140);
            });
            whyObserver.unobserve(whyList);
          }
        });
      },
      { threshold: 0.1 }
    );

    whyObserver.observe(whyList);
  }

  /* ----------------------------------------------------------
     STATS COUNTER ANIMATION
  ---------------------------------------------------------- */
  function animateCounter(el) {
    const rawValue  = el.dataset.count;
    const target    = parseFloat(rawValue);
    const isFloat   = rawValue.includes('.');
    const duration  = 1800;
    const startTime = performance.now();

    function tick(now) {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased    = 1 - Math.pow(1 - progress, 3);
      const current  = target * eased;

      el.textContent = isFloat
        ? current.toFixed(1)
        : Math.floor(current).toLocaleString();

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  const statsSection = document.querySelector('.stats');

  if (statsSection) {
    const statsObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.querySelectorAll('.stats__num').forEach(animateCounter);
            statsObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    statsObserver.observe(statsSection);
  }

  /* ----------------------------------------------------------
     JOURNEY SCROLLYTELLING
     One SVG line flows down the full height of .journey__track.
     Five stops each min-height:100vh \u2248 500vh total.
     Line draws via stroke-dashoffset as you scroll.
     Dots activate when line reaches their waypoint.
     Cards fade in via IntersectionObserver.
  ---------------------------------------------------------- */
  function initJourneyScroll() {
    const track = document.querySelector('.journey__track');
    const fill  = document.querySelector('.journey__path-fill');
    const dots  = document.querySelectorAll('.journey__dot');
    const cards = document.querySelectorAll('.journey__card');
    const bgs   = document.querySelectorAll('.journey__bg');

    if (!track || !fill) return;

    // SVG waypoints \u2014 must match path d= and dot inline style= positions.
    // ViewBox 0 0 100 100: (x,y) maps directly to (x%, y%) of track.
    const svgWP = [
      {x: 72, y: 10},  // Harrison       \u2192 left:72%, top:10%
      {x: 80, y: 30},  // Boxley Valley  \u2192 left:80%, top:30%
      {x: 20, y: 50},  // Hawksbill Crag \u2192 left:20%, top:50%
      {x: 80, y: 70},  // Turner Bend    \u2192 left:80%, top:70%
      {x: 20, y: 90}   // Crystal Mines  \u2192 left:20%, top:90%
    ];

    // Dot activation thresholds match the clip rect (which reveals by Y position)
    const stopFracs = svgWP.map(wp => wp.y / 100);

    // Clip rect drives the reveal: height 0→100 in viewBox coords as scroll progresses
    const clipRect = document.getElementById('journeyClipRect');

    // Scroll progress: 0\u20131 over the full track height
    function getProgress() {
      const rect = track.getBoundingClientRect();
      const scrollable = track.offsetHeight - window.innerHeight;
      if (scrollable <= 0) return 0;
      return Math.max(0, Math.min(1, -rect.top / scrollable));
    }

    function update() {
      const p = getProgress();

      // Reveal the line from top to bottom via clip rect
      clipRect.setAttribute('height', p * 100);

      // Activate dots when line reaches them
      let activeIdx = 0;
      for (let i = stopFracs.length - 1; i >= 0; i--) {
        if (p >= stopFracs[i] - 0.01) { activeIdx = i; break; }
      }
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-reached', p >= stopFracs[i] - 0.01);
        dot.classList.toggle('is-active',  i === activeIdx);
      });

      // Crossfade background photos
      bgs.forEach((bg, i) => {
        bg.style.opacity = i === activeIdx ? '1' : '0';
      });
    }

    // Cards fade in when scrolled into view
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-visible'); });
    }, { threshold: 0.25 });
    cards.forEach(c => io.observe(c));

    let raf = null;
    window.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { update(); raf = null; });
    }, { passive: true });

    update();
  }

  initJourneyScroll();

  /* ----------------------------------------------------------
     GALLERY PARALLAX — desktop only, subtle depth effect
  ---------------------------------------------------------- */
  const galleryItems = document.querySelectorAll('[data-parallax]');

  if (galleryItems.length) {
    let rafId = null;

    function applyParallax() {
      // Skip on mobile to avoid jank
      if (window.innerWidth < 768) return;

      galleryItems.forEach(item => {
        const rect  = item.getBoundingClientRect();
        const viewH = window.innerHeight;

        // Skip if off-screen
        if (rect.bottom < 0 || rect.top > viewH) return;

        const progress = (viewH - rect.top) / (viewH + rect.height);
        const offset   = (progress - 0.5) * 48;
        const img      = item.querySelector('.gallery__img');

        if (img) {
          // Scale slightly larger than container so movement
          // doesn't expose edges
          img.style.transform = `scale(1.1) translateY(${offset}px)`;
        }
      });
    }

    function onScroll() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        applyParallax();
        rafId = null;
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    applyParallax();
  }

  /* ----------------------------------------------------------
     FORM SUBMISSION
     - If YOUR_FORM_ID hasn't been replaced, shows a demo
       success message (no network call).
     - If a real Formspree ID is present, submits via AJAX
       and shows success on response.
  ---------------------------------------------------------- */
  const form        = document.getElementById('bookForm');
  const formSuccess = document.getElementById('formSuccess');

  if (form && formSuccess) {
    form.addEventListener('submit', async (e) => {
      const action = form.getAttribute('action') || '';

      // Demo mode: no real endpoint configured
      if (action.includes('YOUR_FORM_ID')) {
        e.preventDefault();
        showSuccess();
        return;
      }

      // Real submission via Formspree AJAX
      e.preventDefault();

      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
      }

      try {
        const response = await fetch(action, {
          method:  'POST',
          body:    new FormData(form),
          headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
          showSuccess();
        } else {
          // Re-enable button on error so user can retry
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send My Request';
          }
        }
      } catch {
        // Network failure — fall back to normal HTML form submit
        form.submit();
      }
    });
  }

  function showSuccess() {
    // Reset all fields
    if (form) {
      form.querySelectorAll('input, select, textarea').forEach(field => {
        field.value = '';
      });
    }

    if (formSuccess) {
      formSuccess.removeAttribute('hidden');
      formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

})();
