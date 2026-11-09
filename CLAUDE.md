# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`portseif.github.io` — a static GitHub Pages landing page that lists Chris's apps with downloads and release notes. Three hand-written files do everything: `index.html`, `styles.css`, `app.js`. No build step, no package manager, no framework, no tests, no linter. `.nojekyll` makes Pages serve the files as-is, and pushing `main` deploys.

`README.md` is the design record (accent rules, the Catalyst-style button, motion curves, a11y fallbacks, the changelog panel). Read it before changing visual or interaction behavior, and update it in the same change when behavior it describes moves — recent commits touch `README.md` alongside `app.js`/`styles.css` for exactly this reason.

## Running it

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. It has to be served over HTTP, not opened as `file://`, because `app.js` `fetch`es relative screenshot manifests. The GitHub API and every appcast send `Access-Control-Allow-Origin: *`, so local shows exactly what production shows. Verify changes in a browser (light and dark, narrow and wide, reduced motion) since there's nothing else to run.

## How the page finds apps (app.js data flow)

Nothing per-app is configured here. `main()`:

1. `fetchReleaseRepos()` — GitHub API `users/portseif/repos`, keeps non-fork, non-archived repos ending in `-releases`. All GitHub API reads go through `fetchGitHubCached()`: cached in `localStorage` for an hour, and on any API failure the stale copy is used regardless of age (unauthenticated limit is 60/hr/IP). Changing the shape of what's stored means bumping the cache key's `.vN`.
2. `loadProject(repo)` per repo — first `readAppcastRelease()`: `https://portseif.github.io/<repo>/appcast.xml` (Sparkle feed) for version, date, enclosure URL/size, min macOS, and the first `MAX_RELEASE_NOTES` `<li>`s; the app name is the appcast's `<channel><title>`. With no appcast it falls back to `readGitHubRelease()` (electron-updater apps like Elevenpoint): the newest release with a `.dmg`, Download → the repo's `homepage` if set, else the `.dmg`; notes parsed from the release Markdown by `releaseNotesFromMarkdown()`; the changelog panel's history (`project.changelog`) built from the same response. Neither yielding a download returns `null` and the repo is skipped (that's what keeps zip-only `wheelhouse-releases` off the page).
3. Artwork lookups always prefer a file in the `<Name>-releases` repo's Pages root, falling back to one committed here: `icon.png` → `icons/<AppName>.png`; `screenshots.json` → `screenshots/<AppName>.json` (manifest `src`s resolve relative to the manifest) → single `screenshot.webp/.png` → `screenshots/<AppName>.webp/.png`. `resolveFirstImage()` probes each candidate with an `Image` and returns intrinsic width/height so markup reserves exact space — never render an `<img>` for an unprobed URL.
4. Entries render as template-literal HTML; every interpolated value goes through `escapeHtml()`. Until then the list shows loading placeholders: `showSkeletons()` (first thing in `main()`) clones `index.html`'s single `.skeleton` up to the app count the last render stored in `localStorage` (`app-count.v1`).
5. Only after render are the `wire*()` functions called. They use event delegation on `#project-list`, so new markup inside entries doesn't need its own listeners.

For appcast apps the full changelog comes from `<repo>/CHANGELOG.md` on Pages, fetched lazily on first panel open and cached per app. `parseChangelog()` only understands `### vX.Y.Z (date)` headings and `- ` bullets. The "Added"/"Fixed" split in "What's new" is inferred from each note's leading verb (`REPAIR_VERBS`) or, for sentence-style GitHub Release notes, from phrases like "used to"/"no longer"/"again" (`REPAIR_PHRASES`). A GitHub Release's summary paragraph renders under the heading (`releaseSummary`) and only its bullets are split.

The rate limit makes local testing awkward: a fresh browser profile on a spent network shows only the limit message. Seed `localStorage` with the trimmed API answers (shape `{ savedAt, data }`, keys `release-repos.v2` and `releases.v1:<repo>`) fetched with an authenticated `gh api` to exercise the page anyway.

## Non-obvious structure in app.js

- **`main()` is called near the top of the file**, before most `const`s are declared. Anything `main()` touches synchronously before its first `await` (e.g. `REPOS_CACHE_KEY`, `APP_COUNT_KEY`) must be declared above the `main();` call or it hits the temporal dead zone. Constants used only after an `await` can live further down.
- **Shared motion primitives**: `spring()` (Apple-style `response`/`damping`, re-targetable with carried velocity), `project()` (flick end point via scroll-view exponential decay), `rubberband()`, plus `DRAG_THRESHOLD`/`VELOCITY_WINDOW`/`prefersReducedMotion`. Both the changelog panel's touch-flick dismiss and the screenshot stack use them — reuse rather than adding a second spring or easing helper. No animation library is loaded, by design.
- **Screenshot stack**: every card's transform/opacity/z-index is a pure function of one number, `position` (in cards), via `render(at)`. Drags, springs, dots, clicks, arrow keys and sideways trackpad swipes (`wheel`, one card per swipe, claimed or left to the page on the swipe's first event since only that one is cancelable) all just move that number through `go()`. The dots row is one `role="slider"`: WebKit and Chromium turn a screen reader's increment (VoiceOver's swipe up/down) into a real ←/→ keydown on it, so its own keydown handler is what makes it adjustable. `heading` tracks the destination so rapid key presses each advance a card. Stacks with 3+ cards wrap; 2 cards rubber-band at the ends. Global ←/→ targets the lightbox's stack, else the focused stack, else the one most in view, and are ignored while the changelog is open.
- **Contents (`#toc`)**: filled by `wireToc()` once there are 2+ apps, which also adds `html.has-toc`; CSS only shows it at ≥75rem. Links are `#<slugOf(name)>` anchors to each `.project` (which has `scroll-margin-top` for the sticky header). The active link gets `aria-current`; a rAF-throttled scroll handler picks the last entry past 40% of the window, or the last entry at the bottom of the page. `.has-toc .page` and `.chrome-inner` share a `padding-left` formula that keeps content clear of the fixed list.
- **Two native `<dialog>`s** (`#changelog`, `#lightbox`) opened with `showModal()`. Both toggle `html.panel-open`. The lightbox overrides `cancel` (Escape) so it plays a FLIP morph back to the thumbnail instead of closing instantly; `playMorph()` reads the computed transform before cancelling so interrupted morphs don't snap. Focus returns to the trigger on close.
- **Changelog panel drag is touch-only**, gated per event on `pointerType !== "mouse"` (not at startup), so touchscreen laptops work with either input.

## styles.css conventions

- All color, radius and easing values are custom properties on `:root`, redefined under `@media (prefers-color-scheme: dark)`. Add new colors as tokens, with a dark value, rather than inline.
- Hover styles live inside `@media (hover: hover) and (pointer: fine)`; press feedback fires on `:active`, not release.
- Three independent a11y paths, each handled separately: `prefers-reduced-motion` (keep opacity, drop movement — mirrored in JS via `prefersReducedMotion`), `prefers-reduced-transparency` (glass → solid), `prefers-contrast: more` (solid hairlines, thicker panel border).
- The sticky header is the page's only stacking context (`z-index: 10`); stack cards' z-indexes stay contained inside `.shot-deck`.
- Only `transform` and `opacity` animate. Avoid `ease-in`; use `--ease-out` for entrances and `--ease-drawer` for the panel.

## Code style

Comments explain *why* (a design rationale, a browser quirk, a contrast ratio), often at length, in plain prose. Keep that voice when editing nearby code. Commit messages are short, lowercase, and describe the visible change (e.g. "fit the screenshot stack beside the details, …").

`_design/` (a Pencil `.pen` file plus reference images) and `.claude/` are gitignored and not part of the site.
