// Renders a download entry for every public "<Name>-releases" repo owned by the
// GitHub user below. Each of those repos publishes a Sparkle appcast on GitHub
// Pages, which already carries the version, date, size and release notes, so no
// per-project configuration lives in this repo.

const GITHUB_USER = "portseif";
const RELEASES_SUFFIX = "-releases";
const PAGES_ORIGIN = `https://${GITHUB_USER}.github.io`;
const SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle";
const MAX_RELEASE_NOTES = 5;

// Heroicons' arrow-down-tray, split so the arrow can be nudged on its own. The
// hover animation is Aniket Pawar's, from Heroicons Animated (MIT,
// github.com/Aniket-508/heroicons-animated), ported from Motion to a keyframe
// in styles.css since this page carries no animation library.
//
// Stroke is 2.5 viewBox units rather than the Heroicons default of 1.5, so it
// carries the same weight as the label beside it: the 600-weight label strokes
// a 1.73px stem at 14px and a 1.98px stem at 16px, and 2.5 units lands on
// 1.67px at the 16px icon and 2.08px at the 20px one.
const DOWNLOAD_ICON = `
  <svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false">
    <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5" />
    <g class="download-icon-arrow">
      <path d="M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </g>
  </svg>`;

const listElement = document.getElementById("project-list");

main();

async function main() {
  let releaseRepos;
  try {
    releaseRepos = await fetchReleaseRepos();
  } catch (error) {
    showStatus(
      `Could not reach the GitHub API (${error.message}). ` +
        `<a href="https://github.com/${GITHUB_USER}?tab=repositories">Browse the repositories instead</a>.`
    );
    return;
  }

  const projects = (await Promise.all(releaseRepos.map(loadProject))).filter(Boolean);

  if (projects.length === 0) {
    showStatus("No apps published yet.");
    return;
  }

  projects.sort((a, b) => b.releasedAt - a.releasedAt);
  projectsByName = new Map(projects.map((project) => [project.name, project]));

  const fragment = document.createDocumentFragment();
  projects.forEach((project, index) => fragment.append(buildProjectEntry(project, index)));

  listElement.innerHTML = "";
  listElement.removeAttribute("aria-busy");
  listElement.append(fragment);

  wireChangelogPanel();
  wirePanelDrag();
  wireLightbox();
}

async function fetchReleaseRepos() {
  const response = await fetch(
    `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&type=owner`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const repos = await response.json();
  return repos.filter((repo) => !repo.fork && !repo.archived && repo.name.endsWith(RELEASES_SUFFIX));
}

// Reads one repo's appcast and folds it together with the repo metadata.
// Returns null when the repo has no readable appcast, so a half-published
// project never breaks the page.
async function loadProject(repo) {
  const repoPagesUrl = `${PAGES_ORIGIN}/${repo.name}`;
  let appcast;
  try {
    const response = await fetch(`${repoPagesUrl}/appcast.xml`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    appcast = new DOMParser().parseFromString(await response.text(), "application/xml");
    if (appcast.querySelector("parsererror")) throw new Error("malformed appcast");
  } catch (error) {
    console.warn(`Skipping ${repo.name}: ${error.message}`);
    return null;
  }

  const latestItem = findLatestItem(appcast);
  if (!latestItem) return null;

  const enclosure = latestItem.querySelector("enclosure");
  const downloadUrl = enclosure?.getAttribute("url");
  if (!downloadUrl) return null;

  const publishedText = latestItem.querySelector("pubDate")?.textContent?.trim();
  const publishedDate = publishedText ? new Date(publishedText) : null;
  const hasPublishedDate = Boolean(publishedDate && !isNaN(publishedDate));

  const name =
    appcast.querySelector("channel > title")?.textContent?.trim() ||
    repo.name.slice(0, -RELEASES_SUFFIX.length);

  // Both artwork slots prefer a file published alongside the release, so a new
  // app needs no change here, and fall back to one committed to this repo.
  // Either resolves to null and is simply left out of the entry.
  const [icon, screenshot] = await Promise.all([
    resolveFirstImage([`${repoPagesUrl}/icon.png`, `icons/${name}.png`]),
    resolveFirstImage([
      `${repoPagesUrl}/screenshot.webp`,
      `${repoPagesUrl}/screenshot.png`,
      `screenshots/${name}.webp`,
      `screenshots/${name}.png`,
    ]),
  ]);

  return {
    name,
    description: repo.description || "",
    version:
      sparkleText(latestItem, "shortVersionString") || sparkleText(latestItem, "version") || "",
    minimumSystemVersion: sparkleText(latestItem, "minimumSystemVersion"),
    downloadUrl,
    downloadBytes: Number(enclosure.getAttribute("length")) || 0,
    releaseNotes: extractReleaseNotes(latestItem.querySelector("description")?.textContent || ""),
    releasedAt: hasPublishedDate ? publishedDate : new Date(0),
    hasPublishedDate,
    icon,
    screenshot,
    changelogUrl: `${repo.html_url}/blob/${repo.default_branch}/CHANGELOG.md`,
    changelogSource: `${repoPagesUrl}/CHANGELOG.md`,
    repoUrl: repo.html_url,
  };
}

// Appcast items are not required to be in order, so pick the highest version
// rather than trusting the first entry.
function findLatestItem(appcast) {
  const items = [...appcast.querySelectorAll("channel > item")];
  return items.reduce((newest, item) => {
    if (!newest) return item;
    const candidate = sparkleText(item, "version") || sparkleText(item, "shortVersionString") || "0";
    const incumbent =
      sparkleText(newest, "version") || sparkleText(newest, "shortVersionString") || "0";
    return compareVersions(candidate, incumbent) > 0 ? item : newest;
  }, null);
}

function sparkleText(item, tagName) {
  const element =
    item.getElementsByTagNameNS(SPARKLE_NAMESPACE, tagName)[0] ||
    item.getElementsByTagName(`sparkle:${tagName}`)[0];
  return element?.textContent?.trim() || "";
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

// The appcast description is standalone HTML written for Sparkle's release-note
// pane: a styled heading plus a long <li> list. Only the leading few bullets
// belong on a landing page, so take those as plain text and drop the rest.
function extractReleaseNotes(descriptionHtml) {
  const parsed = new DOMParser().parseFromString(descriptionHtml, "text/html");
  return [...parsed.querySelectorAll("li")]
    .map((item) => item.textContent.trim())
    .filter(Boolean)
    .slice(0, MAX_RELEASE_NOTES);
}

function buildProjectEntry(project, index) {
  const entry = document.createElement("article");
  entry.className = project.screenshot ? "project with-screenshot" : "project";
  entry.style.setProperty("--index", index);

  const specs = [];
  if (project.version) specs.push(["Version", project.version]);
  if (project.hasPublishedDate) {
    specs.push([
      "Released",
      project.releasedAt.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    ]);
  }
  if (project.downloadBytes) specs.push(["Size", formatBytes(project.downloadBytes)]);
  if (project.minimumSystemVersion) specs.push(["Requires", `macOS ${project.minimumSystemVersion}`]);

  entry.innerHTML = `
    <div class="project-info">
      ${
        project.icon
          ? `<img class="project-icon" src="${escapeHtml(project.icon.url)}"
                  alt="${escapeHtml(project.name)} icon" width="88" height="88">`
          : ""
      }
      <div class="project-body">
        <h2 class="project-name">${escapeHtml(project.name)}</h2>
        ${
          project.description
            ? `<p class="project-description">${escapeHtml(project.description)}</p>`
            : ""
        }
        <dl class="spec">
          ${specs
            .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`)
            .join("")}
        </dl>
        <p class="actions">
          <a class="download" href="${escapeHtml(project.downloadUrl)}">${DOWNLOAD_ICON}Download</a>
          <button class="secondary" type="button" data-changelog="${escapeHtml(project.name)}">Full changelog</button>
          <a class="secondary" href="${escapeHtml(project.repoUrl)}"
             target="_blank" rel="noopener noreferrer">Repository</a>
        </p>
      </div>
    </div>
    ${
      project.screenshot
        ? `<figure class="project-shot">
             <button class="shot-trigger" type="button"
                     aria-label="View the ${escapeHtml(project.name)} screenshot full size">
               <img src="${escapeHtml(project.screenshot.url)}"
                    alt="${escapeHtml(project.name)} running on macOS"
                    width="${project.screenshot.width}" height="${project.screenshot.height}"
                    fetchpriority="${index === 0 ? "high" : "auto"}">
             </button>
           </figure>`
        : ""
    }
    ${
      project.releaseNotes.length
        ? `<ul class="notes">${project.releaseNotes
            .map((note) => `<li>${escapeHtml(note)}</li>`)
            .join("")}</ul>`
        : ""
    }`;

  return entry;
}

// Tries each candidate URL in order and resolves with the first that actually
// loads, reporting its intrinsic size, or null if none do. Resolving before
// render means an entry never reserves space for an image that does not exist,
// and the real dimensions let the markup reserve exactly the right space for
// one that does, whatever its aspect ratio.
function resolveFirstImage(candidateUrls) {
  return new Promise((resolve) => {
    let candidateIndex = 0;
    const probe = new Image();
    probe.onload = () =>
      resolve({
        url: candidateUrls[candidateIndex],
        width: probe.naturalWidth,
        height: probe.naturalHeight,
      });
    probe.onerror = () => {
      candidateIndex += 1;
      if (candidateIndex < candidateUrls.length) probe.src = candidateUrls[candidateIndex];
      else resolve(null);
    };
    probe.src = candidateUrls[0];
  });
}

function formatBytes(bytes) {
  const megabytes = bytes / 1024 / 1024;
  return megabytes >= 100 ? `${Math.round(megabytes)} MB` : `${megabytes.toFixed(1)} MB`;
}

function showStatus(html) {
  listElement.removeAttribute("aria-busy");
  listElement.innerHTML = `<p class="status">${html}</p>`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}


/* ---------------------------------------------------------------------------
   Changelog panel.

   The appcast only carries release notes for the newest version, so the full
   history comes from the repo's CHANGELOG.md. It is fetched the first time the
   panel opens rather than on page load, so a visitor who never opens it never
   pays for it, then cached per app.
   --------------------------------------------------------------------------- */

const changelogDialog = document.getElementById("changelog");
const changelogTitle = document.getElementById("changelog-title");
const changelogBody = document.getElementById("changelog-body");
const changelogSource = document.getElementById("changelog-source");
const changelogCache = new Map();

let projectsByName = new Map();
let elementThatOpenedPanel = null;

function wireChangelogPanel() {
  listElement.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-changelog]");
    if (trigger) openChangelog(trigger.dataset.changelog, trigger);
  });

  changelogDialog.querySelector(".close-button").addEventListener("click", () =>
    changelogDialog.close()
  );

  // A click landing outside the panel box is a click on the backdrop.
  changelogDialog.addEventListener("click", (event) => {
    const bounds = changelogDialog.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) changelogDialog.close();
  });

  // Scroll edge effect. Each fade grows with how far the content has scrolled
  // past that edge, so it appears as the content does rather than sitting
  // there masking the first line of a panel that has not been scrolled.
  changelogBody.addEventListener("scroll", updateChangelogEdges, { passive: true });
  addEventListener("resize", updateChangelogEdges);

  // Escape is handled natively; this runs for every close.
  changelogDialog.addEventListener("close", () => {
    document.documentElement.classList.remove("panel-open");
    elementThatOpenedPanel?.focus();
    elementThatOpenedPanel = null;
  });
}

async function openChangelog(projectName, trigger) {
  const project = projectsByName.get(projectName);
  if (!project) return;

  elementThatOpenedPanel = trigger;
  changelogTitle.textContent = `${project.name} changelog`;
  changelogSource.href = project.changelogUrl;
  document.documentElement.classList.add("panel-open");
  changelogDialog.showModal();
  changelogBody.scrollTop = 0;
  updateChangelogEdges();

  if (changelogCache.has(projectName)) {
    renderChangelog(changelogCache.get(projectName));
    return;
  }

  changelogBody.innerHTML = `
    <div class="changelog-skeleton" aria-hidden="true">
      ${['46%', '92%', '78%', '88%', '34%', '84%', '70%']
        .map((width) => `<div class="skeleton-bar" style="width:${width}"></div>`)
        .join("")}
    </div>
    <p class="sr-only">Loading the changelog.</p>`;

  try {
    const response = await fetch(project.changelogSource, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const releases = parseChangelog(await response.text());
    if (releases.length === 0) throw new Error("no releases found");
    changelogCache.set(projectName, releases);
    renderChangelog(releases);
  } catch (error) {
    changelogBody.innerHTML = `<p class="status">Could not load the changelog (${escapeHtml(
      error.message
    )}). <a class="secondary" target="_blank" rel="noopener noreferrer" href="${escapeHtml(
      project.changelogUrl
    )}">Read it on GitHub</a>.</p>`;
  }
}

// The file is headings and bullets only: "### <label> (<date>)" starts a
// release, "- " lines are its notes. Anything else is structure we do not need.
function parseChangelog(markdown) {
  const releases = [];
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^###\s+(.*)$/);
    if (heading) {
      const withDate = heading[1].match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      releases.push({
        label: (withDate ? withDate[1] : heading[1]).trim(),
        date: withDate ? withDate[2].trim() : "",
        notes: [],
      });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet && releases.length) releases[releases.length - 1].notes.push(bullet[1].trim());
  }
  return releases.filter((release) => release.notes.length > 0);
}

const EDGE_FADE_MAX = 24;

function updateChangelogEdges() {
  const { scrollTop, scrollHeight, clientHeight } = changelogBody;
  const below = scrollHeight - clientHeight - scrollTop;
  changelogBody.style.setProperty("--fade-top", `${Math.min(scrollTop, EDGE_FADE_MAX)}px`);
  changelogBody.style.setProperty("--fade-bottom", `${Math.min(below, EDGE_FADE_MAX)}px`);
}

function renderChangelog(releases) {
  changelogBody.innerHTML = releases
    .map(
      (release) => `
        <section class="release">
          <h3 class="release-version">
            ${escapeHtml(release.label)}
            ${release.date ? `<span class="release-date">${escapeHtml(release.date)}</span>` : ""}
          </h3>
          <ul class="notes">
            ${release.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
          </ul>
        </section>`
    )
    .join("");

  updateChangelogEdges();
}


/* ---------------------------------------------------------------------------
   Screenshot lightbox.

   The thumbnail morphs into the full-size shot rather than crossfading into
   it: one element travels, so the eye keeps hold of the thing it clicked. The
   move is FLIP. The dialog image is laid out at its final size first, then
   transformed back onto the thumbnail's box and animated to identity, which
   keeps the whole thing on the compositor.

   The radius is counter-scaled on the way in, since a 12px corner shrunk to
   thumbnail size would otherwise land at 3px and the corners would visibly
   grow after the move finished.
   --------------------------------------------------------------------------- */

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const MORPH_IN_MS = 420;
const MORPH_OUT_MS = 260;
const CORNER_RADIUS = 12;

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let shotThatOpenedLightbox = null;
let morph = null;

function wireLightbox() {
  listElement.addEventListener("click", (event) => {
    const trigger = event.target.closest(".shot-trigger");
    if (trigger) openLightbox(trigger);
  });

  lightbox.addEventListener("click", () => closeLightbox());

  // Escape closes a <dialog> instantly. Take it over so it plays the morph
  // back to the thumbnail, the same as a click.
  lightbox.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeLightbox();
  });

  lightbox.addEventListener("close", () => {
    lightbox.classList.remove("closing");
    document.documentElement.classList.remove("panel-open");
    shotThatOpenedLightbox?.classList.remove("shot-trigger-lifted");
    shotThatOpenedLightbox?.focus();
    shotThatOpenedLightbox = null;
  });
}

function openLightbox(trigger) {
  const thumbnail = trigger.querySelector("img");
  shotThatOpenedLightbox = trigger;

  lightboxImage.src = thumbnail.currentSrc || thumbnail.src;
  lightboxImage.alt = thumbnail.alt;
  lightboxImage.width = thumbnail.getAttribute("width");
  lightboxImage.height = thumbnail.getAttribute("height");

  document.documentElement.classList.add("panel-open");
  lightbox.showModal();

  // Measured while the thumbnail is still painted, then hidden so the two
  // copies never show at once.
  const from = thumbnail.getBoundingClientRect();
  trigger.classList.add("shot-trigger-lifted");

  playMorph(from, "in");
}

function closeLightbox() {
  if (!shotThatOpenedLightbox) return;

  // Fades the scrim alongside the morph instead of after it.
  lightbox.classList.add("closing");

  const to = shotThatOpenedLightbox.querySelector("img").getBoundingClientRect();
  playMorph(to, "out").finished.then(
    () => lightbox.close(),
    () => {} // cancelled by a re-open; that path closes on its own
  );
}

// Returns the running animation. `thumbnailRect` is the small end of the move
// in both directions: opening runs towards the dialog's own layout, closing
// runs back to wherever the thumbnail sits now.
function playMorph(thumbnailRect, direction) {
  // Read where the image is right now, before cancelling whatever is moving
  // it. A close that interrupts an open has to start from the presentation
  // value; starting from the logical one snaps the image to full size for a
  // frame before it flies back.
  const live = getComputedStyle(lightboxImage);
  const presentation = { transform: live.transform, borderRadius: live.borderRadius };
  morph?.cancel();

  const full = lightboxImage.getBoundingClientRect();
  const scale = thumbnailRect.width / full.width;
  const offsetX = thumbnailRect.left + thumbnailRect.width / 2 - (full.left + full.width / 2);
  const offsetY = thumbnailRect.top + thumbnailRect.height / 2 - (full.top + full.height / 2);

  const collapsed = {
    transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
    borderRadius: `${CORNER_RADIUS / scale}px`,
  };
  const expanded = { transform: "none", borderRadius: `${CORNER_RADIUS}px` };
  const opening = direction === "in";

  morph = lightboxImage.animate(opening ? [collapsed, expanded] : [presentation, collapsed], {
    // Reduced motion gets the scrim's fade and nothing that flies across the
    // screen, so the state change still reads without the travel.
    duration: prefersReducedMotion.matches ? 0 : opening ? MORPH_IN_MS : MORPH_OUT_MS,
    easing: opening ? "cubic-bezier(0.32, 0.72, 0, 1)" : "cubic-bezier(0.23, 1, 0.32, 1)",
    fill: opening ? "none" : "forwards",
  });

  return morph;
}


/* ---------------------------------------------------------------------------
   Flicking the panel away.

   Touch only. A finger has no cheap way to reach a 28px target in the corner,
   so the sheet itself becomes the control: the header tracks the finger 1:1,
   resists past the open edge, and on release projects where the flick was
   heading and springs the rest of the way carrying the finger's own velocity.
   Grabbing it again mid-flight picks it up from wherever it is, so the gesture
   and the thought can happen at the same time.

   A mouse already has the close button under the cursor, and a pointer that
   can hover does not need a second way to do the same thing, so this stays out
   of its way entirely -- gated per event on pointerType rather than at startup,
   so a laptop with a touchscreen gets the right behaviour from either input.
   --------------------------------------------------------------------------- */

const DRAG_THRESHOLD = 10; // px of hysteresis before a press becomes a drag
const VELOCITY_WINDOW = 100; // ms of pointer history used for the release speed
const DECELERATION = 0.998; // matches a normal scroll's feel

// Springs in Apple's two designer parameters rather than mass/stiffness/damping.
// `response` is roughly how long it takes to arrive, in seconds; `damping` is 1
// for a clean settle and below 1 for overshoot. It runs from whatever value it
// is handed and can be re-targeted mid-flight carrying its own velocity, which
// is what keeps an interrupted gesture continuous instead of restarted.
function spring({ from, to, velocity = 0, response = 0.3, damping = 1, onFrame, onRest }) {
  const frequency = (2 * Math.PI) / response;
  const stiffness = frequency * frequency;
  const resistance = 2 * damping * frequency;

  let value = from;
  let speed = velocity;
  let previous = performance.now();
  let frame = requestAnimationFrame(step);

  function step(now) {
    // Clamped so a backgrounded tab does not resume with one enormous step.
    const elapsed = Math.min((now - previous) / 1000, 1 / 30);
    previous = now;

    const displacement = value - to;
    speed += (-stiffness * displacement - resistance * speed) * elapsed;
    value += speed * elapsed;
    onFrame(value);

    if (Math.abs(displacement) < 0.5 && Math.abs(speed) < 10) {
      onFrame(to);
      onRest?.();
      return;
    }
    frame = requestAnimationFrame(step);
  }

  return {
    stop: () => cancelAnimationFrame(frame),
    get value() {
      return value;
    },
    get velocity() {
      return speed;
    },
  };
}

// Where a flick would come to rest on its own. This is the exponential decay
// scroll views use, not the textbook v^2/2a, which lands much too short.
function project(velocity) {
  return ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

// Past the open edge there is nothing to reveal, so the panel follows less and
// less rather than stopping dead against an invisible wall.
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function wirePanelDrag() {
  const grip = changelogDialog.querySelector(".changelog-head");

  let pointerId = null;
  let dragging = false;
  let startX = 0;
  let startOffset = 0;
  let offset = 0;
  let width = 0;
  let trail = [];
  let settle = null;

  const paint = (x) => {
    offset = x;
    changelogDialog.style.transform = `translateX(${x}px)`;
  };

  const release = () => {
    changelogDialog.classList.remove("dragging");
    changelogDialog.style.transform = "";
    dragging = false;
    pointerId = null;
  };

  grip.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    if (event.button !== 0 || pointerId !== null) return;

    // Taking hold of a panel that is still moving starts from where it is.
    settle?.stop();
    settle = null;

    pointerId = event.pointerId;
    startX = event.clientX;
    width = changelogDialog.getBoundingClientRect().width;
    startOffset = changelogDialog.classList.contains("dragging") ? offset : 0;
    trail = [{ x: event.clientX, at: event.timeStamp }];
  });

  grip.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;

    const travelled = event.clientX - startX;
    if (!dragging) {
      if (Math.abs(travelled) < DRAG_THRESHOLD) return;
      // Only now is this a drag rather than a press, so the close button keeps
      // its click if the pointer never really moved.
      dragging = true;
      changelogDialog.classList.add("dragging");
      // Keeps tracking once the pointer leaves the header, which it will on any
      // real drag. Guarded because a pointer can go away between the move and
      // this call, and losing capture is not worth losing the drag over.
      try {
        grip.setPointerCapture(pointerId);
      } catch {}
    }

    trail.push({ x: event.clientX, at: event.timeStamp });
    trail = trail.filter((point) => event.timeStamp - point.at <= VELOCITY_WINDOW);

    const raw = startOffset + travelled;
    paint(raw < 0 ? -rubberband(-raw, width) : raw);
  });

  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      pointerId = null;
      return;
    }

    const oldest = trail[0];
    const span = (event.timeStamp - oldest.at) / 1000;
    const velocity = span > 0 ? (event.clientX - oldest.x) / span : 0;

    // Decide on where the flick was going, not on where the finger stopped.
    const dismissing = offset + project(velocity) > width / 2;
    const reduced = prefersReducedMotion.matches;

    settle = spring({
      from: offset,
      to: dismissing ? width : 0,
      velocity,
      // A release carries momentum, so it earns a little overshoot -- except
      // when it is going away, where overshoot would just be a bounce off the
      // edge of the screen.
      response: reduced ? 0.15 : 0.3,
      damping: reduced || dismissing ? 1 : 0.8,
      onFrame: paint,
      onRest: () => {
        settle = null;
        if (dismissing) changelogDialog.close();
        release();
      },
    });

    dragging = false;
    pointerId = null;
  };

  grip.addEventListener("pointerup", finish);
  grip.addEventListener("pointercancel", finish);

  // A close from anywhere else (Escape, the button) leaves no drag state behind.
  changelogDialog.addEventListener("close", () => {
    settle?.stop();
    settle = null;
    release();
  });
}
