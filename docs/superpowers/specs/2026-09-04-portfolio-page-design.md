# Portfolio Page — Design Spec

**Date:** 2026-09-04
**Repo:** `JJ0236.github.io` (joshhicks.info, GitHub Pages from `main`)

## Why

A board member at the Bella Vista Animal Shelter asked for a portfolio she
could share with her board while they evaluate web designers. The site has a
Projects page, but it lists browser tools and experiments — not client work.
A shelter board needs to see finished websites for real organizations.

The page is built to survive that specific ask without being about it: no
mention of the shelter anywhere, so it stays useful for the next prospect.

## Audience

Non-technical volunteer board members comparing candidates. They judge on
appearance and relevance, not stack. Two consequences drive the whole design:

1. Every entry leads with a real screenshot. Text-only cards would lose.
2. Ordering does the persuading — see Content below.

## Scope

- New page at `/portfolio/`
- `Portfolio` added to the sidebar, directly under `Home`
- Home hub grid rebalanced so Portfolio takes the wide featured slot
- `testflight/` deleted from the repo

## Content

Four entries, in this fixed order:

| # | Site | URL | Status | Why this position |
|---|------|-----|--------|-------------------|
| 1 | NWA Kennel Club | nwakennelclub.vercel.app | Preview build | Structurally the same site a shelter needs — member org, events calendar, join/volunteer CTAs, animal photography |
| 2 | Aviatrix Charters | aviatrixcharters.com | Live | Polish piece, live on its own domain |
| 3 | GRT Rubber Technologies | grtrubba.vercel.app | Preview build | Serious corporate client, multi-plant manufacturer |
| 4 | Vendorville | vendorville-site.vercel.app | Preview build | An application, not a brochure — accounts, dashboard, billing |

Role line on all four: **Design & build**. Confirmed by Josh 2026-09-04.

Status chips are honest about launch state: `Live` for Aviatrix, `Preview
build` for the three not yet on the client's own domain. Framing them as
preview reads as active pipeline rather than as vaporware.

## Layout

Standard site chrome: `styles/main.css`, sidebar injected by `scripts/nav.js`.
No new dependencies, no build step.

1. **Header** — "Portfolio", a positioning line, and two sentences on process
   (discovery → design → build → handoff). A board buys a process too.
2. **Work grid** — four equal-weight cards, 2-up desktop / 1-up mobile.
   Each card: screenshot (16:10, status chip overlaid top-right), business
   name, one-sentence description, mono role line, scope tags, "Visit site →".
   Whole card is the link; opens in a new tab with `rel="noopener"`.
3. **Closing band** — moss-dark, matching the `/projects/` featured banner.
   "Need a site built or rebuilt?" + email + link to `/contact/`.

Scope tags describe what each site *does* (Events, Booking, Dashboard), not
what it is written in. Josh cannot vouch for a stack claim on a board call;
he can vouch for a feature.

## Screenshots

Captured with headless Chrome at 1440×900, downscaled to 1200px wide, saved
as JPEG to `/assets/portfolio/{slug}.jpg`. Cards set explicit width/height
and `loading="lazy"` so nothing shifts on load.

Slugs: `nwa-kennel-club`, `aviatrix-charters`, `grt-rubber`, `vendorville`.

## Home hub change

`index.html` uses a fixed 3×2 grid sized to fill the viewport without
scrolling. Its five cards (Projects spanning two columns) consume exactly six
cells, so a sixth card would overflow into a third row and break the layout.

Resolution: Portfolio takes the wide `hub-card--featured` slot; Projects
becomes a standard card. Cell count is unchanged, and a visitor arriving from
a business card sees client work first.

## Removing testflight

`testflight/` (1.3MB) holds the Ozark Tours helicopter landing page. Aviatrix
Charters is the shipped successor on its own domain, so the copy on
joshhicks.info is redundant. Nothing outside the folder links to it —
verified by grep across all HTML/JS/CSS/MD — so deletion needs no other edit.

Source of truth remains `~/Documents/deena/Helicopter Site/`, untouched.

## Non-goals

- No CMS, no JSON data file. Four entries in hand-written HTML is correct
  at this size; revisit past roughly a dozen.
- No case-study detail pages. Cards link straight to the live sites.
- No changes to `/projects/`, which keeps serving tools and experiments.

## Verification

- Every internal path resolves and every external URL returns 200
- Page renders at 1440, 900, and 390 wide with no horizontal scroll
- `Portfolio` shows active styling on `/portfolio/`, not on other pages
- Home grid still fills the viewport without scrolling
- No remaining references to `testflight`
