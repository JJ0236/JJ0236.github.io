/**
 * Bug Report Button
 * Hides the Normal / Easy mode buttons in the navbar and replaces them
 * with a "Report a Bug" button that opens a mailto-based email dialog.
 */
(function () {
  'use strict';

  const BUG_EMAIL = 'findme@joshhicks.info';

  /* ── Inject styles ──────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    .bug-report-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 13px;
      font-family: inherit;
      font-weight: 500;
      background: rgba(233,69,96,.12);
      border: 1px solid #e94560;
      border-radius: var(--radius, 6px);
      color: #e94560;
      cursor: pointer;
      transition: border-color .15s, color .15s, background .15s;
      white-space: nowrap;
    }
    .bug-report-btn:hover {
      background: rgba(233,69,96,.22);
      border-color: #ff6b85;
      color: #ff6b85;
    }

    /* Modal overlay */
    .bug-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.72);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      animation: bug-fade-in .15s ease;
    }
    @keyframes bug-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .bug-dialog {
      background: var(--bg-card, #1a1a2e);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius-lg, 10px);
      width: 480px;
      max-width: 92vw;
      padding: 28px 28px 22px;
      box-shadow: 0 24px 64px rgba(0,0,0,.5);
      animation: bug-slide-in .15s ease;
    }
    @keyframes bug-slide-in {
      from { transform: translateY(-12px); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }

    .bug-dialog h2 {
      margin: 0 0 4px;
      font-size: 17px;
      font-weight: 700;
      color: var(--text-primary, #e0e0e0);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .bug-dialog .bug-sub {
      font-size: 12px;
      color: var(--text-secondary, #a0a0c0);
      margin: 0 0 20px;
    }

    .bug-field {
      margin-bottom: 14px;
    }

    .bug-field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary, #a0a0c0);
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: .4px;
    }

    .bug-field input,
    .bug-field textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      background: var(--bg-input, #0f0f23);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-primary, #e0e0e0);
      font-size: 13px;
      font-family: inherit;
      resize: vertical;
      transition: border-color .15s;
    }

    .bug-field input:focus,
    .bug-field textarea:focus {
      outline: none;
      border-color: var(--accent, #2196f3);
    }

    .bug-field textarea {
      min-height: 110px;
    }

    .bug-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }

    .bug-cancel {
      padding: 7px 16px;
      font-size: 13px;
      font-family: inherit;
      background: transparent;
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0);
      cursor: pointer;
      transition: border-color .15s, color .15s;
    }
    .bug-cancel:hover {
      border-color: var(--text-secondary, #a0a0c0);
      color: var(--text-primary, #e0e0e0);
    }

    .bug-send {
      padding: 7px 18px;
      font-size: 13px;
      font-family: inherit;
      font-weight: 600;
      background: #e94560;
      border: 1px solid transparent;
      border-radius: var(--radius, 6px);
      color: #fff;
      cursor: pointer;
      transition: background .15s;
    }
    .bug-send:hover {
      background: #c73652;
    }
  `;
  document.head.appendChild(style);

  /* ── Modal ──────────────────────────────────────────────────────── */
  function openModal() {
    if (document.querySelector('.bug-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'bug-overlay';
    overlay.innerHTML = `
      <div class="bug-dialog" role="dialog" aria-modal="true" aria-label="Report a Bug">
        <h2>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e94560" stroke-width="2.2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Report a Bug
        </h2>
        <p class="bug-sub">Describe what went wrong — your default email app will open with the details filled in.</p>

        <div class="bug-field">
          <label>Subject</label>
          <input id="bug-subject" type="text" placeholder="e.g. Dithering result looks wrong" value="LAZAR Bug Report" />
        </div>

        <div class="bug-field">
          <label>What happened?</label>
          <textarea id="bug-body" placeholder="Describe what you were doing, what you expected, and what actually happened…"></textarea>
        </div>

        <div class="bug-actions">
          <button class="bug-cancel" id="bug-cancel-btn">Cancel</button>
          <button class="bug-send" id="bug-send-btn">Open Email&hellip;</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Focus first input
    setTimeout(() => document.getElementById('bug-subject').focus(), 50);

    function close() { overlay.remove(); }

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('bug-cancel-btn').addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    document.getElementById('bug-send-btn').addEventListener('click', () => {
      const subject = encodeURIComponent(
        document.getElementById('bug-subject').value.trim() || 'LAZAR Bug Report'
      );
      const body = encodeURIComponent(
        document.getElementById('bug-body').value.trim() || '(no description provided)'
      );
      window.location.href = `mailto:${BUG_EMAIL}?subject=${subject}&body=${body}`;
      close();
    });
  }

  /* ── Inject button into navbar ──────────────────────────────────── */
  function injectButton(navbar) {
    // Don't inject twice
    if (navbar.querySelector('.bug-report-btn')) return;

    // Hide the Normal / Easy mode buttons — they contain those text labels
    navbar.querySelectorAll('button').forEach((btn) => {
      const t = btn.textContent.trim();
      if (t === 'Normal' || t === 'Easy' || t === 'Easy mode' || t === 'Normal mode') {
        btn.style.display = 'none';
        // Also hide any adjacent divider/separator sibling
        const prev = btn.previousElementSibling;
        if (prev && (prev.tagName === 'HR' || getComputedStyle(prev).width === '1px')) {
          prev.style.display = 'none';
        }
      }
    });

    const bugBtn = document.createElement('button');
    bugBtn.className = 'bug-report-btn';
    bugBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      Report a Bug
    `;
    bugBtn.addEventListener('click', openModal);

    // Insert at the right end of the navbar (before any trailing flex spacer)
    navbar.appendChild(bugBtn);
  }

  /* ── Wait for navbar to appear ──────────────────────────────────── */
  function tryInject() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
      injectButton(navbar);
      // Keep watching in case React re-renders the navbar
      const mo = new MutationObserver(() => injectButton(navbar));
      mo.observe(navbar, { childList: true, subtree: true });
    }
  }

  // Try immediately, then watch for React mount
  tryInject();
  const rootObs = new MutationObserver(() => { tryInject(); });
  rootObs.observe(document.body, { childList: true, subtree: false });

  // Belt-and-suspenders: also try on DOMContentLoaded / load
  document.addEventListener('DOMContentLoaded', tryInject);
  window.addEventListener('load', tryInject);
})();
