# portseif.github.io

Landing page listing my Mac apps and their downloads.

## How it finds projects

The page is static: `index.html` + `styles.css` + `app.js`, no build step. On
load, `app.js` asks the GitHub API for my public repos and keeps the ones whose
name ends in `-releases`. For each of those it reads
`https://portseif.github.io/<repo>/appcast.xml` and pulls the latest version,
release date, download URL, download size, minimum macOS version, and the first
few release-note bullets straight out of the Sparkle feed.

So publishing a new app means creating a `<Name>-releases` repo with Pages
enabled and an `appcast.xml` at its root. Nothing here needs editing.

An app that updates from GitHub Releases instead (Elevenpoint, an Electron
app on electron-updater) has no appcast, so when `appcast.xml` 404s the page
reads the repo's releases from the API:

- the newest published release with a `.dmg` is the one shown, so a repo
  whose releases carry no disk image (Wheelhouse's zip) stays off the page
- the name comes from the `.dmg` file name, `<productName>-<version>…`, and
  the size from the Apple silicon `.dmg` when there is one
- **Download** goes to the repo's website (the Website field on GitHub) when
  it has one, opening in a new tab since it's a page, not a file. That's how
  an app with separate Apple silicon and Intel builds sends people to a page
  offering both. Without one it's the `.dmg` itself.
- the notes are the release body up to the download list, the first list
  naming one of the release's files, minus the line leading into it. Each
  paragraph and each bullet is one note. They're prose rather than verb-led,
  so "What's new" shows them as one unlabelled card instead of splitting
  them into Added and Fixed.
- the changelog panel is built from every release in the same answer, so it
  costs no request of its own, and its GitHub link goes to the releases page

That's one more API call per such repo, kept in `localStorage` for an hour
the same way as the repo list.

GitHub allows 60 API calls an hour per IP address without a token, so the repo
list is kept in `localStorage` for an hour, and when the API refuses (a spent
limit, an outage) the last copy is used whatever its age. A new app can take
up to an hour to show for someone who visited recently. A first visit from a
network that has spent its limit says when it resets.

Optional per-project extras, all safely skipped when missing:

- the repo description becomes the one-line blurb under the app name
- an **icon**, looked up in this order:
  1. `icon.png` at the root of the `<Name>-releases` repo (preferred, since a
     new app then needs no change here)
  2. `icons/<AppName>.png` in this repo
- a **screenshot**, same idea, `.webp` preferred over `.png` at each step:
  1. `screenshot.webp` / `screenshot.png` at the root of the `<Name>-releases` repo
  2. `screenshots/<AppName>.webp` / `.png` in this repo
- **several screenshots**, from a manifest listing them in the order they show:
  `[{ "src": "screenshots/projects.webp", "alt": "The projects table" }, …]`,
  each `src` relative to the manifest. Same idea as the icon:
  1. `screenshots.json` at the root of the `<Name>-releases` repo
  2. `screenshots/<AppName>.json` in this repo (StackMe's is here, with its
     shots in `screenshots/StackMe/`)

  Two or more render as a fanned
  stack (front card whole, its neighbours tucked behind and sticking out either
  side, wrapping from three up) that moves by drag, swipe, the dots or the
  arrow keys (from anywhere on the page, and inside the lightbox, which swaps
  to the new shot); the front card opens the lightbox. Capture them all at the same
  size: every card takes the first one's proportions. Without a manifest, or if
  none of its images load, the single-screenshot lookup above applies.

`<AppName>` is the appcast's `<channel><title>`. Both images are probed before
the entry renders, so a missing one never reserves empty space.

An entry with a screenshot lays out as a two-column split, details left and
product shot right. An entry without one stays single-column and capped, so the
two forms can sit on the same page without looking like different templates.

Both images are probed before the entry renders, and the probe reports the
image's intrinsic size, so the markup reserves exactly the right space for any
aspect ratio and nothing shifts as it loads.

`icons/StackMe.png` was extracted from `AppIcon.icns` inside the shipped app
bundle and resized to 256px. `icons/Elevenpoint.png` is the 256px image from
`icon.icns` in the installed app. `screenshots/StackMe.webp` is cropped to the app
window itself, with the capture's own matte and drop shadow removed so the page
supplies the radius, border and shadow instead. WebP took it from 348 KB to
59 KB with no visible cost to the UI text.

## Design notes

- **Accent is reserved for the primary action.** Download is the only coloured
  thing on the page; secondary links are neutral and underlined, so colour is
  not the only signal marking them. The blue is Apple's button blue rather than
  systemBlue `#007AFF`, which carries a white label at 4.02:1 and misses AA. It
  is retuned per scheme: light button 4.70:1, dark button 5.18:1.
- **The download button is built like Catalyst's.** Same three layers as
  `catalyst.tailwindui.com/docs/button`: the element paints the 1px ring, a
  `::before` layer paints the fill and casts the drop shadow, and an `::after`
  layer carries the inset white top highlight and the hover wash. Dark mode
  hides the fill layer, since against a dark page that shadow is invisible and
  a tinted one reads as a neon halo rather than depth.
- **Translucent chrome.** The header is a `backdrop-filter` material that
  content scrolls under, with a soft gradient at its bottom edge instead of a
  hairline. `prefers-reduced-transparency` swaps it for a solid bar with a
  border, and `prefers-contrast: more` solidifies the hairlines.
- **Entries are icon plus aligned body.** The icon holds the left edge and
  everything else lines up with the app name, so an entry reads as one block.
  Below 600px the icon stacks above, and below 980px the split collapses.
- **No boxes.** Release notes sit under a single hairline rather than in a
  card. Elevating a five-line list made the least important content the
  heaviest element on the page.
- **Type is size-specific.** The app name uses `clamp()` with tight leading and
  negative tracking; small labels get slightly positive tracking. Sizes are in
  `rem` so the layout scales with the reader's text-size setting. The system
  font ships its own optical sizing and on the target Macs resolves to the same
  face the app uses.
- **Motion.** Entries materialize (blur, scale and opacity together) as they
  arrive, on a critically damped curve. The download button responds on press,
  not on release. `prefers-reduced-motion: reduce` swaps the materialize for a
  plain cross-fade rather than removing the feedback entirely.
- One radius scale, one `z-index` (the sticky header), hairline dividers rather
  than boxed cards, so the list reads the same with one app or ten.

## Changelog panel

"Full changelog" opens a right-side inset drawer on a glass material rather
than navigating away. The appcast only carries release notes for the newest
version, so the panel reads the repo's `CHANGELOG.md`, parsed as headings plus
bullets. It is fetched on first open, not on page load, then cached per app, so
a visitor who never opens it never pays for it.

It is a native `<dialog>` opened with `showModal()`, which supplies the top
layer, the focus trap, Escape handling and inert background for free. Clicks
outside the panel box close it, and focus returns to the trigger.

Motion:

- Transitions rather than keyframes, so a rapid open/close retargets from the
  current position instead of restarting from zero.
- Enter 420ms on the drawer curve, exit 260ms. Exit is faster because the user
  has already decided.
- Only `transform` and `opacity` animate; `display` and `overlay` are discrete,
  which is what keeps the exit visible on a `<dialog>`.
- Never `ease-in`. It withholds the first frames, which is the moment the user
  is watching most closely.
- Enter and exit run along the same axis the panel sits on, so it reads as
  coming from and returning to the right edge.

## Accessibility fallbacks

Three independent signals are honored, each with its own path rather than a
blanket off switch:

- `prefers-reduced-motion` keeps the opacity change and drops the movement.
- `prefers-reduced-transparency` swaps every glass surface for a solid one.
  macOS "Reduce transparency" triggers this, so the chrome and panel render
  opaque for anyone who has it on.
- `prefers-contrast: more` solidifies hairlines and gives the panel a 2px
  border.

External links open in a new tab with `rel="noopener noreferrer"`. The download
link does not: it is same-origin in production and is a file download rather
than a navigation.

## Local preview

```
python3 -m http.server 8000
```

Then open http://localhost:8000. The GitHub API and the appcast feeds are both
public and both send `Access-Control-Allow-Origin: *`, so the local copy shows
exactly what production will.
