/**
 * nav.js — Earthy Workbench Sidebar
 * Injects the shared sidebar nav into every page.
 * On mobile (< 768px) renders a hamburger + off-canvas drawer.
 */

(function () {
  const NAV_LINKS = [
    { href: '/',            label: 'Home',       icon: homeIcon()       },
    { href: '/about/',      label: 'About',      icon: aboutIcon()      },
    { href: '/experience/', label: 'Experience', icon: experienceIcon() },
    { href: '/projects/',   label: 'Projects',   icon: projectsIcon()   },
    { href: '/contact/',    label: 'Contact',    icon: contactIcon()    },
  ];

  const TOOLS_LINKS = [
    { href: '/lazar/',               label: 'LAZAR'               },
    { href: '/foraging/',            label: 'Foraging Map'        },
    { href: '/s1c3r/',               label: 's1c3r'               },
    { href: '/transcript-tool/',     label: 'Transcript Tool'     },
    { href: '/instagram-analytics/', label: 'IG Analytics'        },
    { href: '/woah/',                label: 'WebGL Demo'          },
    { href: '/scissor/',             label: 'Scissor Lattice'     },
  ];

  function isActive(href) {
    const path = window.location.pathname;
    if (href === '/') return path === '/';
    return path.startsWith(href);
  }

  function homeIcon() {
    return `<svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M7 18v-7h6v7"/></svg>`;
  }

  function aboutIcon() {
    return `<svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3.5"/><path d="M2.5 18c0-3.866 3.358-7 7.5-7s7.5 3.134 7.5 7"/></svg>`;
  }

  function experienceIcon() {
    return `<svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="11" rx="1.5"/><path d="M7 7V5.5A2.5 2.5 0 0112 5.5V7"/><line x1="2" y1="11" x2="18" y2="11"/></svg>`;
  }

  function projectsIcon() {
    return `<svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="7" height="7" rx="1"/><rect x="11" y="3" width="7" height="7" rx="1"/><rect x="2" y="12" width="7" height="6" rx="1"/><rect x="11" y="12" width="7" height="6" rx="1"/></svg>`;
  }

  function contactIcon() {
    return `<svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h14a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1z"/><polyline points="3,4 10,11 17,4"/></svg>`;
  }

  function buildNavItems(links, showIcons) {
    return links.map(link => {
      const active = isActive(link.href);
      return `<li><a href="${link.href}" class="${active ? 'active' : ''}">${showIcons ? link.icon : ''}<span>${link.label}</span></a></li>`;
    }).join('');
  }

  function buildSidebar() {
    return `
      <aside class="sidebar" id="sidebar" role="navigation" aria-label="Site navigation">
        <div class="sidebar-brand">
          <a href="/">
            <div class="sidebar-name">Josh Hicks</div>
            <div class="sidebar-role">Information Systems</div>
          </a>
        </div>
        <nav class="sidebar-nav">
          <ul>${buildNavItems(NAV_LINKS, true)}</ul>
          <div class="sidebar-section-label">Tools</div>
          <ul>${buildNavItems(TOOLS_LINKS, false)}</ul>
        </nav>
        <div class="sidebar-footer">
          <a href="https://github.com/JJ0236" target="_blank" rel="noopener" aria-label="GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.185 6.839 9.504.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.071 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.844a9.6 9.6 0 012.504.338c1.909-1.294 2.747-1.025 2.747-1.025.546 1.378.202 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.847-2.338 4.695-4.566 4.944.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.578.688.48C19.138 20.2 22 16.447 22 12.021 22 6.484 17.523 2 12 2z"/>
            </svg>
          </a>
          <a href="https://www.linkedin.com/in/josh-hicks-8b5b04286/" target="_blank" rel="noopener" aria-label="LinkedIn">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
          </a>
        </div>
      </aside>
      <button class="nav-toggle" id="nav-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">
        <span></span>
      </button>
      <div class="nav-overlay" id="nav-overlay"></div>
    `;
  }

  function init() {
    // Inject sidebar before the .site-content wrapper if it exists,
    // otherwise prepend to body.
    const layout = document.querySelector('.site-layout');
    if (layout) {
      layout.insertAdjacentHTML('afterbegin', buildSidebar());
    } else {
      document.body.insertAdjacentHTML('afterbegin', buildSidebar());
    }

    const sidebar  = document.getElementById('sidebar');
    const toggle   = document.getElementById('nav-toggle');
    const overlay  = document.getElementById('nav-overlay');

    function openNav() {
      sidebar.classList.add('open');
      overlay.classList.add('visible');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }

    function closeNav() {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    toggle.addEventListener('click', () => {
      sidebar.classList.contains('open') ? closeNav() : openNav();
    });

    overlay.addEventListener('click', closeNav);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeNav();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Fade-up on scroll ──────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const fadeEls = document.querySelectorAll('.fade-up');
    if (!fadeEls.length) return;

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    fadeEls.forEach(el => observer.observe(el));
  });
})();
