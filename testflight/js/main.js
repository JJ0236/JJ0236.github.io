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
     The dots and line are derived from each card's real geometry,
     so every dot lands on the same spot on its card (inner edge,
     vertically centered) and the line is rebuilt through the actual
     dot positions each frame — nothing can drift or desync.
     SVG is sticky (100vh); the line tip leads at a fixed viewport
     position so it never lags behind the scroll.
  ---------------------------------------------------------- */
  function initJourneyScroll() {
    const track = document.querySelector('.journey__track');
    const fill  = document.querySelector('.journey__path-fill');
    const dots  = document.querySelectorAll('.journey__dot');
    const stops = document.querySelectorAll('.journey__stop');
    const cards = document.querySelectorAll('.journey__card');
    const bgs   = document.querySelectorAll('.journey__bg');
    const node  = document.querySelector('.adv-intro__node');

    if (!track || !fill || !stops.length) return;

    const ACT = 52;   // viewport %: a dot is "reached/active" above this line

    // Document-space geometry, ignoring transforms (offsetParent chain).
    function docTop(el)  { let y = 0; while (el) { y += el.offsetTop;  el = el.offsetParent; } return y; }
    function docLeft(el) { let x = 0; while (el) { x += el.offsetLeft; el = el.offsetParent; } return x; }

    let J = [];            // journey points in document coords {x, y}
    let nodeDoc = null;    // adventures node center in document coords
    let trackDocTop = 0, trackDocLeft = 0;

    // Cache positions on load / resize (layout is stable; cheap per-frame after).
    function measure() {
      trackDocTop  = docTop(track);
      trackDocLeft = docLeft(track);
      J = [];
      stops.forEach(function(stop, i) {
        const card = stop.querySelector('.journey__card');
        const side = stop.dataset.side;
        const x = docLeft(card) + (side === 'left' ? card.offsetWidth : 0);
        const y = docTop(card) + card.offsetHeight / 2;
        J.push({ x: x, y: y });
        // Position the dot at the same document point (track-relative)
        dots[i].style.left = (x - trackDocLeft) + 'px';
        dots[i].style.top  = (y - trackDocTop) + 'px';
      });
      nodeDoc = node
        ? { x: docLeft(node) + node.offsetWidth / 2, y: docTop(node) + node.offsetHeight / 2 }
        : null;
    }

    function update() {
      if (!J.length) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const sc = window.scrollY;

      const vx = function(dx) { return (dx / vw) * 100; };
      const vy = function(dy) { return ((dy - sc) / vh) * 100; };

      let activeIdx = -1;

      // Enter from just above the first dot
      const p0 = J[0];
      let d = 'M ' + vx(p0.x).toFixed(2) + ',' + (vy(p0.y) - 8).toFixed(2);

      J.forEach(function(p, i) {
        const sy = vy(p.y);
        d += ' L ' + vx(p.x).toFixed(2) + ',' + sy.toFixed(2);
        const reached = sy <= ACT;
        dots[i].classList.toggle('is-reached', reached);
        if (reached) activeIdx = i;
      });

      // Continuation: drop below the last dot, sweep to center quickly, then
      // run straight down the centre and land on the Adventures node — one
      // continuous line across the boundary.
      const last = J[J.length - 1];
      if (nodeDoc) {
        const nodeY  = vy(nodeDoc.y);
        const sweepY = Math.min(vy(last.y) + 13, nodeY);
        d += ' L ' + vx(last.x).toFixed(2) + ',' + (vy(last.y) + 4).toFixed(2);
        d += ' L 50,' + sweepY.toFixed(2);
        d += ' L 50,' + nodeY.toFixed(2);
      }
      fill.setAttribute('d', d);

      dots.forEach(function(dot, i) { dot.classList.toggle('is-active', i === activeIdx); });

      // Background photos: 2 stops per photo
      const bgIdx = Math.min(Math.floor(Math.max(activeIdx, 0) / 2), bgs.length - 1);
      bgs.forEach(function(bg, i) { bg.style.opacity = i === bgIdx ? '1' : '0'; });
    }

    // Cards fade in when scrolled into view
    const io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) { if (e.isIntersecting) e.target.classList.add('is-visible'); });
    }, { threshold: 0.2 });
    cards.forEach(function(c) { io.observe(c); });

    let raf = null;
    window.addEventListener('scroll', function() {
      if (raf) return;
      raf = requestAnimationFrame(function() { update(); raf = null; });
    }, { passive: true });

    let resizeTimer = null;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() { measure(); update(); }, 150);
    });

    // Recompute once images/fonts settle (card heights can shift)
    window.addEventListener('load', function() { measure(); update(); });

    measure();
    update();
  }

  initJourneyScroll();

  /* ----------------------------------------------------------
     ADVENTURES "UNROLL"
     As the trail line hands off, the Choose-Your-Experience
     section unrolls: heading wipes down, cards cascade in.
  ---------------------------------------------------------- */
  (function initAdventuresUnroll() {
    const adventures = document.querySelector('.adventures');
    if (!adventures) return;

    // Watch the connector at the top of the section; fire when it rises to
    // ~58% of the viewport — right where the trail tip dissolves — so the
    // split/unfurl reads as the line connecting into the section.
    const sentinel = adventures.querySelector('.adv-intro') || adventures;

    const io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) {
          adventures.classList.add('is-unrolled');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -52% 0px', threshold: 0 });

    io.observe(sentinel);
  })();

  /* ----------------------------------------------------------
     UNIFIED PARALLAX ENGINE
     Hero bg: absolute scrollY-based (classic).
     Everything with [data-par] / [data-par-x]: viewport-center
     relative offset — gives smooth, balanced movement in both
     scroll directions regardless of page position.
  ---------------------------------------------------------- */
  const heroBg = document.getElementById('heroBg');

  // Collect all parallax elements once
  const parMap = new Map();

  function registerParElements() {
    document.querySelectorAll('[data-par], [data-par-x]').forEach(el => {
      parMap.set(el, {
        speedY: parseFloat(el.dataset.par  || '0'),
        speedX: parseFloat(el.dataset.parX || '0'),
      });
    });
  }

  registerParElements();

  let parRaf = null;

  function runParallax() {
    const scrollY = window.scrollY;
    const vh      = window.innerHeight;
    const isMobile = window.innerWidth < 768;

    // Hero background — absolute parallax from top of page
    if (heroBg) {
      // Move bg down as user scrolls: bg lags behind → classic depth effect
      heroBg.style.transform = `translateY(${scrollY * 0.45}px)`;
    }

    // Skip multi-directional parallax on mobile to avoid jank
    if (isMobile) return;

    parMap.forEach(({ speedY, speedX }, el) => {
      const rect = el.getBoundingClientRect();

      // Only process elements near the viewport
      if (rect.bottom < -300 || rect.top > vh + 300) return;

      // Distance of element's centre from viewport centre
      const fromCenter = (rect.top + rect.height * 0.5) - vh * 0.5;

      const ty = fromCenter * speedY;
      const tx = fromCenter * speedX;

      el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    });
  }

  function scheduleParallax() {
    if (parRaf) return;
    parRaf = requestAnimationFrame(() => {
      runParallax();
      parRaf = null;
    });
  }

  window.addEventListener('scroll', scheduleParallax, { passive: true });
  window.addEventListener('resize', scheduleParallax, { passive: true });
  runParallax();

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

  /* ----------------------------------------------------------
     ADVENTURE MODAL
     Opens when any adv-card__trigger is clicked.
     Populates from adventureData by card index.
  ---------------------------------------------------------- */
  const adventureData = [
    {
      tag:        '◆ Signature Experience',
      title:      'Crystal Mining Tours',
      tagline:    'Dig for Ozark quartz in a working private mine',
      img:        'https://images.pexels.com/photos/3737455/pexels-photo-3737455.jpeg?auto=compress&cs=tinysrgb&w=1400',
      desc:       'Fly by helicopter to a private working crystal mine deep in the Ouachita Mountains. A seasoned local miner walks you through the geology and hands you a pick. Every crystal you find is yours to keep — raw, unpolished, and pulled from 300-million-year-old rock by your own hands.',
      highlights: [
        'Private helicopter transfer from Harrison, AR',
        'Guided dig session with a working miner',
        'Keep everything you find',
        'Lunch at a nearby local smokehouse',
        'Half-day or full-day options available',
      ],
    },
    {
      tag:        'World-Class Waters',
      title:      'Fly Fishing in Cotter',
      tagline:    'White River tailwater — legendary trout',
      img:        'https://images.pexels.com/photos/1409019/pexels-photo-1409019.jpeg?auto=compress&cs=tinysrgb&w=1400',
      desc:       'The White River below Bull Shoals Dam is consistently ranked among the top trout fisheries in North America. We fly you directly to Cotter, Arkansas, where a certified guide meets you bankside with rods already rigged for the conditions. No crowds. No shuttles. Just cold water and rising fish.',
      highlights: [
        'Helicopter transfer to Cotter, AR',
        'Full-day guided float or wade trip',
        'All gear and flies provided or BYO',
        'Rainbow, brown, and cutthroat trout',
        'Catch-and-release or harvest options',
      ],
    },
    {
      tag:        'Trail Riding',
      title:      'Equestrian Adventures',
      tagline:    'Ride trails only horses can reach',
      img:        'https://images.pexels.com/photos/1490577/pexels-photo-1490577.jpeg?auto=compress&cs=tinysrgb&w=1400',
      desc:       'Land on a private ranch in the heart of the Boston Mountains and saddle up for trails that no road will ever reach. Whether you want a casual ridge ride at sunrise or a full-day backcountry trek, our wranglers match you with the right horse and lead the way into some of the most beautiful terrain in the South.',
      highlights: [
        'Private helicopter to ranch helipad',
        'Matched to horse by experience level',
        'Sunrise, half-day, and full-day options',
        'Remote ridge and valley trail routes',
        'Cookout lunch available on full-day trips',
      ],
    },
    {
      tag:        'Hundred Miles',
      title:      'Private Mountain Biking',
      tagline:    '100 miles of single-track. Zero crowds.',
      img:        'https://images.pexels.com/photos/1143169/pexels-photo-1143169.jpeg?auto=compress&cs=tinysrgb&w=1400',
      desc:       'The Ozarks hold some of the finest mountain biking in the country — and most of it sees almost no traffic on a weekday. We fly you out to a private trailhead with a shuttled bike (or bring your own), a route matched to your ability, and nobody else in sight. Flow trails, technical rock gardens, ridge-top gravel — your call.',
      highlights: [
        'Helicopter drop at remote trailhead',
        'Curated route by ability level',
        'High-end trail bikes available or BYO',
        'Shuttle retrieval or loop options',
        'Over 100 miles of accessible trail network',
      ],
    },
    {
      tag:        'Drive Something Special',
      title:      'Supercar & Heritage Rentals',
      tagline:    'Lamborghini. Ferrari. Classic muscle.',
      img:        'https://images.pexels.com/photos/1545743/pexels-photo-1545743.jpeg?auto=compress&cs=tinysrgb&w=1400',
      desc:       'The Ozark Mountain roads were practically designed for a supercar. We helicopter you to a private collection, walk you through the fleet, and hand you the keys. Twisting two-lane highways, overlook pull-offs, and zero traffic. Bring a co-pilot or go solo — either way, the road is yours.',
      highlights: [
        'Helicopter transfer to private collection',
        'Lamborghini, Ferrari, and classic American muscle available',
        'Curated driving route through the mountains',
        'Professional briefing and support vehicle',
        'Half-day and full-day rentals',
      ],
    },
    {
      tag:        'Beaver Lake',
      title:      'Sailing with a Private Chef',
      tagline:    'A private yacht. A gourmet chef. 90 miles of shoreline.',
      img:        'https://images.pexels.com/photos/1007836/pexels-photo-1007836.jpeg?auto=compress&cs=tinysrgb&w=1400',
      desc:       "Beaver Lake is Arkansas's largest reservoir — 28,000 acres of clear Ozark water ringed by forested bluffs. We land you at the marina, where a private yacht and a professionally trained chef are waiting. Sail into hidden coves for a multi-course lunch, a sunset dinner, or a full-day charter. No other boats. No other guests.",
      highlights: [
        'Helicopter transfer to Beaver Lake marina',
        'Private yacht charter with captain',
        'Onboard chef with custom menu',
        'Hidden cove anchorage and swimming',
        'Sunset and overnight charter options',
      ],
    },
    {
      tag:        'Fine Dining',
      title:      'Fly In to Restaurant Ryn',
      tagline:    'Arrive by air. Dine at the finest table in the Ozarks.',
      img:        'https://images.pexels.com/photos/941861/pexels-photo-941861.jpeg?auto=compress&cs=tinysrgb&w=1400',
      desc:       "Restaurant Ryn is widely regarded as one of the finest dining destinations in the American South — a farm-to-table experience set in a restored historic building in Eureka Springs. We fly you there, arrange a reservation, and bring you home. The easiest table in the house to book when you arrive by helicopter.",
      highlights: [
        'Round-trip helicopter transfer',
        'Reservation arranged in advance',
        "Chef's tasting menu or à la carte",
        'Private table with advance notice',
        'Pair with a Eureka Springs evening excursion',
      ],
    },
    {
      tag:        'Overnight Stay',
      title:      'Antebellum Mansion & Stables',
      tagline:    'Wake up in a 180-year-old estate. Horses graze the morning mist.',
      img:        'https://images.pexels.com/photos/2724748/pexels-photo-2724748.jpeg?auto=compress&cs=tinysrgb&w=1920',
      desc:       'Land on the lawn of a meticulously restored antebellum mansion — one of the oldest surviving estates in the Arkansas Ozarks. A private housekeeper prepares your room, a chef handles every meal, and the stable yard holds working horses available at dawn. History, luxury, and total solitude, hours from the nearest town.',
      highlights: [
        'Helicopter landing on the estate lawn',
        'Private overnight in the main house',
        'Full board: dinner, breakfast, and lunch',
        'Morning horse ride with a wrangler',
        'Full estate buyout available for groups',
      ],
    },
  ];

  const modal        = document.getElementById('advModal');
  const modalBackdrop= document.getElementById('advModalBackdrop');
  const modalClose   = document.getElementById('advModalClose');
  const modalBack    = document.getElementById('advModalBack');
  const modalImg     = document.getElementById('advModalImg');
  const modalTag     = document.getElementById('advModalTag');
  const modalTitle   = document.getElementById('advModalTitle');
  const modalTagline = document.getElementById('advModalTagline');
  const modalDesc    = document.getElementById('advModalDesc');
  const modalHighlights = document.getElementById('advModalHighlights');

  let previouslyFocused = null;

  function openModal(idx) {
    const data = adventureData[idx];
    if (!data || !modal) return;

    modalTag.textContent      = data.tag;
    modalTitle.textContent    = data.title;
    modalTagline.textContent  = data.tagline;
    modalDesc.textContent     = data.desc;
    modalImg.style.backgroundImage = `url('${data.img}')`;

    modalHighlights.innerHTML = data.highlights
      .map(h => `<li>${h}</li>`)
      .join('');

    previouslyFocused = document.activeElement;
    modal.removeAttribute('hidden');

    // Force reflow so the transition plays
    modal.offsetHeight;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    modalClose.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';

    modal.addEventListener('transitionend', () => {
      modal.setAttribute('hidden', '');
    }, { once: true });

    if (previouslyFocused) previouslyFocused.focus();
  }

  if (modal) {
    document.querySelectorAll('.adv-card__trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('[data-adv-idx]');
        if (card) openModal(parseInt(card.dataset.advIdx, 10));
      });
    });

    modalClose.addEventListener('click', closeModal);
    modalBack.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
    });

    // Trap focus inside modal
    modal.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || !modal.classList.contains('is-open')) return;
      const focusable = Array.from(
        modal.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

})();
