// Renders a download entry for every public "<Name>-releases" repo owned by the
// GitHub user below. Most of those repos publish a Sparkle appcast on GitHub
// Pages, which already carries the version, date, size and release notes; one
// without an appcast (an Electron app, which updates from GitHub Releases) is
// read from its releases instead. Either way no per-project configuration
// lives in this repo.

const GITHUB_USER = "portseif";
const RELEASES_SUFFIX = "-releases";
const PAGES_ORIGIN = `https://${GITHUB_USER}.github.io`;
const SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle";
const MAX_RELEASE_NOTES = 5;

// GitHub allows 60 API calls an hour per IP address without a token, and every
// load of this page spent one, so a few reloads (or a shared office network)
// ran it dry and the page showed nothing. The list of apps changes about never,
// so it's kept in the browser for an hour, and when the API refuses — a rate
// limit, an outage — the last copy is used whatever its age. The same goes for
// the releases of an app without an appcast. Up here because main() runs
// before the rest of the file: a constant declared further down is still
// uninitialised when it first reads the cache.
const REPOS_CACHE_KEY = "release-repos.v2";
const RELEASES_CACHE_PREFIX = "releases.v1:";
const API_CACHE_FRESH_MS = 60 * 60 * 1000;
// How many apps the page showed last time, for the loading placeholders. Up
// here for the same reason: main() reads it before its first await.
const APP_COUNT_KEY = "app-count.v1";

// Lucide's arrow-down-to-line, stroked at 2.5 to sit at the same weight as the
// other icons on the page rather than Lucide's own 2. It ships the shaft, the
// chevron and the line under them as three paths, so the two that make up the
// arrow group together and the hover nudge moves them without the line.
//
// The nudge is Aniket Pawar's, from Heroicons Animated (MIT,
// github.com/Aniket-508/heroicons-animated), ported from Motion to a keyframe
// in styles.css since this page carries no animation library.
const DOWNLOAD_ICON = `
  <svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false">
    <g class="download-icon-arrow">
      <path d="M12 17V3" />
      <path d="m6 11 6 6 6-6" />
    </g>
    <path d="M19 21H5" />
  </svg>`;

const CHEVRON_ICON = `
  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="m9 5 7 7-7 7" />
  </svg>`;

const ARROW_OUT_ICON = `
  <svg class="arrow-out" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>`;

const PLUS_ICON = `
  <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 5v14M5 12h14" />
  </svg>`;

const WRENCH_ICON = `
  <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>`;

const listElement = document.getElementById("project-list");

main();

async function main() {
  showSkeletons();

  let releaseRepos;
  try {
    releaseRepos = await fetchReleaseRepos();
  } catch (error) {
    showStatus(
      `${escapeHtml(error.message)} ` +
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
  try {
    localStorage.setItem(APP_COUNT_KEY, String(projects.length));
  } catch {}

  wireChangelogPanel();
  wirePanelDrag();
  wireLightbox();
  wireScreenshotStacks();
  wireToc(projects);
}

function fetchReleaseRepos() {
  return fetchGitHubCached(
    `users/${GITHUB_USER}/repos?per_page=100&type=owner`,
    REPOS_CACHE_KEY,
    (repos) =>
      repos
        .filter((repo) => !repo.fork && !repo.archived && repo.name.endsWith(RELEASES_SUFFIX))
        // Only what the entries read, so the stored copy stays small.
        .map(({ name, description, homepage, html_url, default_branch }) => ({
          name,
          description,
          homepage,
          html_url,
          default_branch,
        }))
  );
}

// Published releases, newest first, trimmed to what an entry reads.
function fetchGitHubReleases(repo) {
  return fetchGitHubCached(
    `repos/${GITHUB_USER}/${repo.name}/releases?per_page=100`,
    RELEASES_CACHE_PREFIX + repo.name,
    (releases) =>
      releases
        .filter((release) => !release.draft && !release.prerelease)
        .map(({ tag_name, published_at, body, assets }) => ({
          tag_name,
          published_at,
          body: body || "",
          assets: assets.map(({ name, size, browser_download_url }) => ({
            name,
            size,
            browser_download_url,
          })),
        }))
  );
}

// A GitHub API answer, kept for an hour, and past that whenever the API
// refuses. `trim` shapes the answer before it is stored.
async function fetchGitHubCached(path, cacheKey, trim) {
  const cached = readCache(cacheKey);
  if (cached && Date.now() - cached.savedAt < API_CACHE_FRESH_MS) return cached.data;

  try {
    const response = await fetch(`https://api.github.com/${path}`);
    if (!response.ok) throw new Error(apiFailureMessage(response));
    const data = trim(await response.json());
    writeCache(cacheKey, data);
    return data;
  } catch (error) {
    if (cached) return cached.data;
    throw error;
  }
}

// A spent rate limit says when it comes back (X-RateLimit-Reset, which GitHub
// exposes to pages on other origins); anything else keeps its status code.
function apiFailureMessage(response) {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (response.headers.get("x-ratelimit-remaining") === "0" && reset) {
    const time = new Date(reset * 1000).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    return `GitHub's hourly limit for this network is used up until ${time}.`;
  }
  return `Could not reach the GitHub API (HTTP ${response.status}).`;
}

// Storage can be off (a private window, blocked site data), so both sides
// treat a failure as no cache.
function readCache(cacheKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(cacheKey));
    return Array.isArray(stored?.data) && typeof stored.savedAt === "number" ? stored : null;
  } catch {
    return null;
  }
}

function writeCache(cacheKey, data) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {}
}

// Reads one repo's latest release, from its appcast or else its GitHub
// Releases, and folds it together with the repo metadata. Returns null when
// neither yields a download, so a half-published project never breaks the page.
async function loadProject(repo) {
  const repoPagesUrl = `${PAGES_ORIGIN}/${repo.name}`;
  const release =
    (await readAppcastRelease(repo, repoPagesUrl)) || (await readGitHubRelease(repo));
  if (!release) return null;

  const hasPublishedDate = Boolean(release.publishedDate && !isNaN(release.publishedDate));
  const name = release.name || repo.name.slice(0, -RELEASES_SUFFIX.length);

  // Both artwork slots prefer a file published alongside the release, so a new
  // app needs no change here, and fall back to one committed to this repo.
  // A missing icon resolves to null and no screenshots to an empty list, and
  // either is simply left out of the entry.
  const [icon, screenshots] = await Promise.all([
    resolveFirstImage([`${repoPagesUrl}/icon.png`, `icons/${name}.png`]),
    resolveScreenshots(repoPagesUrl, name),
  ]);

  return {
    ...release,
    name,
    description: repo.description || "",
    releasedAt: hasPublishedDate ? release.publishedDate : new Date(0),
    hasPublishedDate,
    icon,
    screenshots,
    repoUrl: repo.html_url,
  };
}

// The newest item in the repo's Sparkle appcast on Pages, or null when there
// is no readable appcast (an app that updates some other way).
async function readAppcastRelease(repo, repoPagesUrl) {
  let appcast;
  try {
    const response = await fetch(`${repoPagesUrl}/appcast.xml`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    appcast = new DOMParser().parseFromString(await response.text(), "application/xml");
    if (appcast.querySelector("parsererror")) throw new Error("malformed appcast");
  } catch (error) {
    console.info(`No appcast for ${repo.name} (${error.message}), trying its releases`);
    return null;
  }

  const latestItem = findLatestItem(appcast);
  if (!latestItem) return null;

  const enclosure = latestItem.querySelector("enclosure");
  const downloadUrl = enclosure?.getAttribute("url");
  if (!downloadUrl) return null;

  const publishedText = latestItem.querySelector("pubDate")?.textContent?.trim();

  return {
    name: appcast.querySelector("channel > title")?.textContent?.trim() || "",
    version:
      sparkleText(latestItem, "shortVersionString") || sparkleText(latestItem, "version") || "",
    requires: sparkleText(latestItem, "minimumSystemVersion")
      ? `macOS ${sparkleText(latestItem, "minimumSystemVersion")}`
      : "",
    downloadUrl,
    downloadIsPage: false,
    downloadBytes: Number(enclosure.getAttribute("length")) || 0,
    releaseSummary: "",
    releaseNotes: extractReleaseNotes(latestItem.querySelector("description")?.textContent || ""),
    publishedDate: publishedText ? new Date(publishedText) : null,
    changelogUrl: `${repo.html_url}/blob/${repo.default_branch}/CHANGELOG.md`,
    changelogSource: `${repoPagesUrl}/CHANGELOG.md`,
  };
}

// The newest GitHub Release with a Mac disk image, for an app that updates
// from GitHub Releases (electron-updater) rather than an appcast. Releases
// without a .dmg (a zip-only build, server binaries) are not a Mac download,
// so a repo with none of them stays off the page.
//
// Download goes to the repo's website when it has one, which is how an app
// with an Apple silicon and an Intel build sends people to a page that offers
// both; otherwise to the Apple silicon .dmg, then any .dmg. The history comes
// from the same answer, so the changelog panel costs no extra request.
async function readGitHubRelease(repo) {
  let releases;
  try {
    releases = await fetchGitHubReleases(repo);
  } catch (error) {
    console.warn(`Skipping ${repo.name}: ${error.message}`);
    return null;
  }

  const diskImageOf = (release) =>
    release.assets.find((asset) => /-arm64\.dmg$/i.test(asset.name)) ||
    release.assets.find((asset) => /\.dmg$/i.test(asset.name));
  const latest = releases.find(diskImageOf);
  if (!latest) {
    console.warn(`Skipping ${repo.name}: no appcast and no release with a .dmg`);
    return null;
  }

  const versionOf = (release) => release.tag_name.replace(/^v(?=\d)/i, "");
  const notesOf = (release) =>
    releaseNotesFromMarkdown(
      release.body,
      release.assets.map((asset) => asset.name)
    );

  const diskImage = diskImageOf(latest);
  const version = versionOf(latest);

  // The summary line above a release's bullets introduces them, so on the
  // page it sits under the heading and the bullets are what get sorted into
  // Added and Fixed. A release that is only a paragraph or two shows those.
  const latestNotes = notesOf(latest);
  const bullets = latestNotes.filter((note) => note.bullet).map((note) => note.text);
  const paragraphs = latestNotes.filter((note) => !note.bullet).map((note) => note.text);

  return {
    // electron-builder names its files "<productName>-<version>…", which is
    // the app's own capitalisation rather than the repo's.
    name: diskImage.name.includes(`-${version}`) ? diskImage.name.split(`-${version}`)[0] : "",
    version,
    // A release that also ships a Windows or Linux installer runs anywhere.
    // One with only a disk image says nothing about which macOS it needs.
    requires: latest.assets.some((asset) => /\.(exe|msi|appimage|deb|rpm)$/i.test(asset.name))
      ? "any OS"
      : "",
    downloadUrl: repo.homepage || diskImage.browser_download_url,
    downloadIsPage: Boolean(repo.homepage),
    downloadBytes: diskImage.size || 0,
    releaseSummary: bullets.length ? paragraphs.join(" ") : "",
    releaseNotes: (bullets.length ? bullets : paragraphs).slice(0, MAX_RELEASE_NOTES),
    publishedDate: latest.published_at ? new Date(latest.published_at) : null,
    changelogUrl: `${repo.html_url}/releases`,
    changelog: releases
      .map((release) => ({
        label: versionOf(release),
        date: release.published_at || "",
        notes: notesOf(release).map((note) => note.text),
      }))
      .filter((release) => release.notes.length > 0),
  };
}

// A release's notes from the Markdown GitHub shows. These are written as a
// line or two of summary, the changes as a list, then a list of which file to
// download for which computer. That download list is the first one naming one
// of the release's own files; it, the line leading into it ("Pick the file
// for your computer:") and everything after are left out. What comes before
// it is the notes: each paragraph one note, since a summary line is what makes
// the bullets under it make sense, and each bullet one note, in order and
// marked as which they are.
function releaseNotesFromMarkdown(markdown, assetNames) {
  const blocks = markdown
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const bulletText = (line) => line.match(/^[-*]\s+(.*)$/)?.[1];
  const isList = (block) => bulletText(block.split("\n")[0]) !== undefined;
  // A wrapped bullet's later lines belong to it.
  const listItems = (block) =>
    block.split("\n").reduce((items, line) => {
      const bullet = bulletText(line.trim());
      if (bullet !== undefined) items.push(bullet);
      else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
      return items;
    }, []);

  let end = blocks.findIndex(
    (block) => isList(block) && assetNames.some((name) => block.includes(name))
  );
  if (end === -1) end = blocks.length;
  else if (end > 0 && !isList(blocks[end - 1]) && blocks[end - 1].endsWith(":")) end -= 1;

  return blocks
    .slice(0, end)
    .flatMap((block) =>
      isList(block)
        ? listItems(block).map((text) => ({ text: markdownToText(text), bullet: true }))
        : [{ text: markdownToText(block.replace(/\s*\n\s*/g, " ")), bullet: false }]
    )
    .filter((note) => note.text);
}

// Notes render as text, so links keep their words and emphasis loses its marks.
function markdownToText(markdown) {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .trim();
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
  entry.className = project.screenshots.length ? "project with-screenshot" : "project";
  entry.id = slugOf(project.name);
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
  if (project.requires) specs.push(["Requires", project.requires]);

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
        <p class="actions">
          <a class="download" href="${escapeHtml(project.downloadUrl)}"${
            // A download page is a navigation off the site, so it opens in a
            // new tab like every other external link. A file download does not.
            project.downloadIsPage ? ` target="_blank" rel="noopener noreferrer"` : ""
          }>${DOWNLOAD_ICON}Download for macOS</a>
          <button class="link-arrow" type="button" data-changelog="${escapeHtml(project.name)}">
            Full changelog${CHEVRON_ICON}
          </button>
        </p>
        <dl class="spec">
          ${specs
            .map(
              ([label, value]) =>
                `<div class="spec-row"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`
            )
            .join("")}
          <div class="spec-row spec-link">
            <a href="${escapeHtml(project.repoUrl)}" target="_blank" rel="noopener noreferrer">
              Repository${ARROW_OUT_ICON}
            </a>
          </div>
        </dl>
      </div>
    </div>
    ${renderScreenshots(project, index)}
    ${renderWhatsNew(project)}`;

  return entry;
}

// One shot is a single button that opens the lightbox. Two or more are a stack
// (wired by wireScreenshotStacks): every card sits in the same grid cell, the
// front one is the only one in the tab order, and the dots and arrow keys are
// the way through it for anyone not dragging.
function renderScreenshots(project, index) {
  const shots = project.screenshots;
  if (!shots.length) return "";

  const priority = index === 0 ? "high" : "auto";
  const altFor = (shot, position) =>
    shot.alt ||
    (shots.length > 1
      ? `${project.name} screenshot ${position + 1}`
      : `${project.name} running on macOS`);

  if (shots.length === 1) {
    const [shot] = shots;
    return `<figure class="project-shot">
         <button class="shot-trigger" type="button"
                 aria-label="View the ${escapeHtml(project.name)} screenshot full size">
           <img src="${escapeHtml(shot.url)}" alt="${escapeHtml(altFor(shot, 0))}"
                width="${shot.width}" height="${shot.height}" fetchpriority="${priority}">
         </button>
       </figure>`;
  }

  // Every card takes the first shot's proportions, so one captured at another
  // size crops instead of jutting out of the stack.
  const [first] = shots;
  return `<figure class="project-shot shot-stack" aria-roledescription="carousel"
                  aria-label="${escapeHtml(project.name)} screenshots"
                  style="--shot-ratio: ${first.width} / ${first.height}">
       <div class="shot-deck">
         ${shots
           .map(
             (shot, position) => `
           <button class="shot-trigger shot-card" type="button" data-shot="${position}"
                   aria-label="View screenshot ${position + 1} of ${shots.length} full size">
             <img src="${escapeHtml(shot.url)}" alt="${escapeHtml(altFor(shot, position))}"
                  width="${first.width}" height="${first.height}" draggable="false"
                  fetchpriority="${position === 0 ? priority : "auto"}">
           </button>`
           )
           .join("")}
       </div>
       <div class="shot-dots" role="slider" tabindex="0"
            aria-label="${escapeHtml(project.name)} screenshot"
            aria-valuemin="1" aria-valuemax="${shots.length}">
         ${shots
           .map((_, position) => `<span class="shot-dot" data-shot="${position}"></span>`)
           .join("")}
       </div>
       <p class="sr-only shot-status" aria-live="polite"></p>
     </figure>`;
}

// The changelog is one flat list of bullets, but a release reads better split
// into what arrived and what got repaired. There is no category in the source,
// so it comes from the opening verb: anything that starts by repairing,
// removing or restraining goes to the right, everything else is new work.
const REPAIR_VERBS =
  /^(fix|remove|cap|drop|stop|prevent|correct|quiet|speed|tidy|clean|restore|revert|gate|harden|reduce|avoid|guard|no longer|resolve)\b/i;

// Notes written as sentences ("In Findings, the Select button stays in view")
// have no opening verb to go by, but a repair still gives itself away in how
// it talks about the old behaviour: it used to, it no longer does, it works
// again, it read differently before.
const REPAIR_PHRASES = /\b(used to|no longer|again|fix(?:es|ed)?)\b|\bbefore[,.;]/i;

function splitReleaseNotes(notes) {
  const added = [];
  const fixed = [];
  for (const note of notes) {
    (REPAIR_VERBS.test(note) || REPAIR_PHRASES.test(note) ? fixed : added).push(note);
  }
  return { added, fixed };
}

function renderWhatsNew(project) {
  if (!project.releaseNotes.length) return "";

  const { added, fixed } = splitReleaseNotes(project.releaseNotes);
  const column = (label, notes, icon) =>
    notes.length
      ? `<section class="whats-new-group">
           <h4 class="whats-new-label">${label}</h4>
           <ul class="note-card">
             ${notes.map((note) => `<li>${icon}<span>${escapeHtml(note)}</span></li>`).join("")}
           </ul>
         </section>`
      : "";

  return `
    <section class="whats-new">
      <header class="whats-new-head">
        <div>
          <h3 class="whats-new-title">What's new${
            project.version ? ` in ${escapeHtml(project.version)}` : ""
          }</h3>
          ${
            project.hasPublishedDate
              ? `<p class="whats-new-date">Released ${escapeHtml(
                  project.releasedAt.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                )}</p>`
              : ""
          }
          ${
            project.releaseSummary
              ? `<p class="whats-new-summary">${escapeHtml(project.releaseSummary)}</p>`
              : ""
          }
        </div>
        <button class="link-arrow" type="button" data-changelog="${escapeHtml(project.name)}">
          Full changelog${CHEVRON_ICON}
        </button>
      </header>
      <div class="whats-new-columns">
        ${column("Added", added, PLUS_ICON)}
        ${column("Fixed", fixed, WRENCH_ICON)}
      </div>
    </section>`;
}

// Several shots come from a manifest listing them in the order they show:
// [{ "src": "screenshots/projects.webp", "alt": "…" }, …], each src relative to
// the manifest itself. Like the icon, the one published beside the appcast
// (screenshots.json in the releases repo) wins over one committed here
// (screenshots/<AppName>.json). Without either, or when none of a manifest's
// images load, the single screenshot.webp/.png lookup runs, so an app with one
// shot needs no manifest at all.
async function resolveScreenshots(repoPagesUrl, name) {
  for (const manifestUrl of [`${repoPagesUrl}/screenshots.json`, `screenshots/${name}.json`]) {
    const shots = await loadScreenshotManifest(manifestUrl);
    if (shots.length) return shots;
  }

  const single = await resolveFirstImage([
    `${repoPagesUrl}/screenshot.webp`,
    `${repoPagesUrl}/screenshot.png`,
    `screenshots/${name}.webp`,
    `screenshots/${name}.png`,
  ]);
  return single ? [single] : [];
}

// The shots in one manifest that load, or none when it is missing or malformed.
async function loadScreenshotManifest(manifestUrl) {
  try {
    const response = await fetch(manifestUrl, { cache: "no-cache" });
    if (!response.ok) return [];
    const entries = await response.json();
    if (!Array.isArray(entries)) return [];
    const shots = await Promise.all(
      entries
        .filter((entry) => typeof entry?.src === "string")
        .map(async (entry) => {
          const image = await resolveFirstImage([new URL(entry.src, response.url).href]);
          return image && { ...image, alt: typeof entry.alt === "string" ? entry.alt : "" };
        })
    );
    return shots.filter(Boolean);
  } catch {
    return [];
  }
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

// One placeholder entry per app the page showed last time, so it doesn't load
// as one entry and then grow into two. A first visit, or one with storage off,
// keeps the single placeholder index.html starts with.
function showSkeletons() {
  let count = 1;
  try {
    count = Number(localStorage.getItem(APP_COUNT_KEY)) || 1;
  } catch {}
  const skeleton = listElement.querySelector(".skeleton");
  skeleton.after(...Array.from({ length: count - 1 }, () => skeleton.cloneNode(true)));
}

function showStatus(html) {
  listElement.removeAttribute("aria-busy");
  listElement.innerHTML = `<p class="status">${html}</p>`;
}

// An entry's id, which the table of contents links to: "StackMe" → "stackme".
function slugOf(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
const changelogLatest = document.getElementById("changelog-latest");
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
  changelogLatest.textContent = project.version ? `Latest ${project.version}` : "";
  document.documentElement.classList.add("panel-open");
  changelogDialog.showModal();
  changelogBody.scrollTop = 0;
  updateChangelogEdges();

  // An app read from GitHub Releases already has its history.
  if (project.changelog) {
    renderChangelog(project.changelog);
    return;
  }

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
      const label = (withDate ? withDate[1] : heading[1]).trim();
      releases.push({
        // Headings are written "v1.1.9"; the number alone is the version.
        label: label.replace(/^v(?=\d)/i, ""),
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

// Headings carry whatever the CHANGELOG author typed. Anything a Date can read
// gets the same short form the entry above uses; anything else passes through
// untouched rather than being replaced with "Invalid Date".
function formatReleaseDate(raw) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

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
            ${
              release.date
                ? `<span class="release-date">${escapeHtml(formatReleaseDate(release.date))}</span>`
                : ""
            }
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

   The corner scales with the shot: full size, the image takes the radius the
   thumbnail's 12px corner grows to at that size, so the move animates nothing
   but the transform, and a capture that carries the window's own rounded
   corners (every StackMe shot) stays lined up with its frame. A fixed 12px at
   full size sat well inside a window corner twice that.
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
    // A card behind the front one is a way to move the stack, not to open it.
    if (trigger && !trigger.matches(".shot-card:not(.is-active)")) openLightbox(trigger);
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

// Swaps the shot the open lightbox shows (a stack's arrow keys), keeping the
// card it closes back onto in step with it.
function showInLightbox(trigger) {
  shotThatOpenedLightbox?.classList.remove("shot-trigger-lifted");
  shotThatOpenedLightbox = trigger;
  trigger.classList.add("shot-trigger-lifted");
  const thumbnail = trigger.querySelector("img");
  lightboxImage.src = thumbnail.currentSrc || thumbnail.src;
  lightboxImage.alt = thumbnail.alt;
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
  const presentation = { transform: getComputedStyle(lightboxImage).transform };
  morph?.cancel();

  const full = lightboxImage.getBoundingClientRect();
  const scale = thumbnailRect.width / full.width;
  const offsetX = thumbnailRect.left + thumbnailRect.width / 2 - (full.left + full.width / 2);
  const offsetY = thumbnailRect.top + thumbnailRect.height / 2 - (full.top + full.height / 2);

  lightboxImage.style.borderRadius = `${CORNER_RADIUS / scale}px`;
  const collapsed = { transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})` };
  const expanded = { transform: "none" };
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


/* ---------------------------------------------------------------------------
   Screenshot stack.

   The shots sit fanned: the front one whole, the ones either side of it
   tucked behind, smaller, tilted out from the bottom and sticking out past its
   edges, so there is visibly more to see without a single label saying so.
   With three or more it wraps, so there is always one out on each side.

   A drag (mouse or finger) moves the stack continuously and lets go into the
   same spring the changelog panel uses, carrying the release velocity, and it
   moves one card per flick however hard the flick. A press that never travels
   is a click: on the front card it opens the lightbox, on a card behind it
   brings that one forward. The dots and ← / → do the same for anyone not
   dragging; the arrows work from anywhere on the page, moving the stack in
   view, and in the lightbox, where they swap the shot it shows. A sideways
   two-finger swipe on a trackpad moves one card too. To a screen reader the
   dots are one slider, so VoiceOver on an iPhone moves the stack with a swipe
   up or down, as it does a page control. Every card's place is a function of
   one number, the stack's position in cards, so a drag, a spring and a click
   all just move that number.
   --------------------------------------------------------------------------- */

const STACK_INSET = 0.06; // share of the deck each side left for a peeking card
const STACK_SIDE_SCALE = 0.9;
const STACK_SIDE_TILT = 2; // degrees, pivoting on the card's bottom edge
const STACK_SIDE_OPACITY = 0.6;
const STACK_DRAG_PER_CARD = 0.5; // share of a card's width dragged to move one card
const WHEEL_SWIPE_DISTANCE = 30; // px sideways before a trackpad swipe moves a card
const WHEEL_SWIPE_GAP = 120; // ms without a wheel event that ends a swipe
const SLIDER_STEPS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

function wireScreenshotStacks() {
  const stacks = [...listElement.querySelectorAll(".shot-stack")].map(wireScreenshotStack);
  if (!stacks.length) return;

  const holding = (element) => element && stacks.find((stack) => stack.element.contains(element));

  // The stack the most of which is on screen, if any of one is.
  const mostInView = () => {
    let best = null;
    let bestVisible = 0;
    for (const stack of stacks) {
      const bounds = stack.element.getBoundingClientRect();
      const visible = Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0);
      if (visible > bestVisible) [best, bestVisible] = [stack, visible];
    }
    return best;
  };

  // ← / → from anywhere, not only once a card has focus: the stack the
  // lightbox is showing, else the one holding focus, else the one in view.
  // Never while typing, with a modifier (those belong to the browser), or with
  // the changelog panel up.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (changelogDialog.open) return;

    const stack =
      (lightbox.open && holding(shotThatOpenedLightbox)) || holding(document.activeElement) || mostInView();
    if (!stack) return;
    event.preventDefault();
    stack.step(event.key === "ArrowRight" ? 1 : -1);
  });
}

function wireScreenshotStack(stack) {
  const deck = stack.querySelector(".shot-deck");
  const cards = [...deck.querySelectorAll(".shot-card")];
  const slider = stack.querySelector(".shot-dots");
  const dots = [...slider.querySelectorAll(".shot-dot")];
  const status = stack.querySelector(".shot-status");
  const count = cards.length;
  const wraps = count > 2;

  // How far a side card's centre sits from the front card's, as a percentage of
  // a card's width, for it to stick out exactly into the deck's inset.
  const peek = STACK_INSET / (1 - 2 * STACK_INSET);
  const sideShift = (0.5 + peek - STACK_SIDE_SCALE / 2) * 100;
  deck.style.paddingInline = `${STACK_INSET * 100}%`;

  let position = 0;
  // Where the stack is heading, in cards: the next arrow press counts from
  // here, so quick presses each move a card instead of rounding back to where
  // the spring happens to be mid-flight.
  let heading = 0;
  let active = 0;
  let settle = null;
  // Off while the slider itself moves the stack: a screen reader already reads
  // out the slider's new value, and the live region would say it twice.
  let announce = true;

  const normalise = (index) => ((index % count) + count) % count;

  // A card's distance from the front in cards, the short way round when the
  // stack wraps.
  const offsetOf = (cardIndex, at) => {
    const distance = cardIndex - at;
    return wraps ? distance - count * Math.round(distance / count) : distance;
  };

  const stepWidth = () => cards[0].getBoundingClientRect().width * STACK_DRAG_PER_CARD || 1;

  function render(at) {
    position = at;
    cards.forEach((card, index) => {
      const offset = offsetOf(index, at);
      const distance = Math.abs(offset);
      const towardSide = Math.min(distance, 1);
      const side = Math.sign(offset);
      const scale = 1 - (1 - STACK_SIDE_SCALE) * towardSide;
      // Front to side, the card dims; past the side slot it fades out behind
      // the one there, so a card crossing to the other side never shows.
      const opacity =
        distance <= 1
          ? 1 - (1 - STACK_SIDE_OPACITY) * distance
          : Math.max(0, STACK_SIDE_OPACITY * (1.5 - distance) * 2);

      card.style.transform =
        `translateX(${side * towardSide * sideShift}%) ` +
        `rotate(${side * towardSide * STACK_SIDE_TILT}deg) scale(${scale})`;
      card.style.opacity = opacity;
      card.style.zIndex = String(100 - Math.round(distance * 10));
      card.style.visibility = opacity === 0 ? "hidden" : "";
    });
  }

  function setActive(index) {
    active = normalise(index);
    cards.forEach((card, cardIndex) => {
      const isFront = cardIndex === active;
      card.classList.toggle("is-active", isFront);
      card.tabIndex = isFront ? 0 : -1;
      card.setAttribute("aria-hidden", String(!isFront));
    });
    dots.forEach((dot, dotIndex) => {
      if (dotIndex === active) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    slider.setAttribute("aria-valuenow", String(active + 1));
    slider.setAttribute(
      "aria-valuetext",
      `${active + 1} of ${count}: ${cards[active].querySelector("img").alt}`
    );
    status.textContent = announce ? `Screenshot ${active + 1} of ${count}` : "";
  }

  // `target` is in cards and may run past either end when the stack wraps;
  // `velocity` is in px/s along the direction position grows.
  function go(target, velocity = 0) {
    settle?.stop();
    settle = null;
    const destination = wraps ? target : Math.max(0, Math.min(count - 1, target));
    heading = destination;
    setActive(destination);

    const rest = () => {
      settle = null;
      heading = normalise(destination);
      render(heading);
    };

    if (prefersReducedMotion.matches) {
      rest();
      return;
    }

    const step = stepWidth();
    settle = spring({
      from: position * step,
      to: destination * step,
      velocity,
      response: 0.38,
      // A flick earns a touch of overshoot; a click, a dot or a key does not.
      damping: velocity ? 0.85 : 1,
      onFrame: (pixels) => render(pixels / step),
      onRest: rest,
    });
  }

  // The nearest copy of `cardIndex` to where the stack is, so a wrapped stack
  // always travels the short way round.
  const nearest = (cardIndex) => {
    const at = Math.round(position);
    return at + offsetOf(cardIndex, at);
  };

  let pointerId = null;
  let dragging = false;
  let interrupted = false;
  let startX = 0;
  let startPosition = 0;
  let trail = [];
  let swallowClick = false;

  deck.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    // The open hand closes on the press, before any drag has begun.
    deck.classList.add("pressed");
    startX = event.clientX;
    trail = [{ x: event.clientX, at: event.timeStamp }];

    // Taking hold of a stack that is still moving starts from where it is.
    interrupted = settle !== null;
    settle?.stop();
    settle = null;
    startPosition = position;
  });

  deck.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;

    const travelled = event.clientX - startX;
    if (!dragging) {
      if (Math.abs(travelled) < DRAG_THRESHOLD) return;
      dragging = true;
      try {
        deck.setPointerCapture(pointerId);
      } catch {}
    }

    trail.push({ x: event.clientX, at: event.timeStamp });
    trail = trail.filter((point) => event.timeStamp - point.at <= VELOCITY_WINDOW);

    const step = stepWidth();
    let next = startPosition - travelled / step;
    // Two cards don't wrap, so past either end the stack gives less and less.
    if (!wraps) {
      if (next < 0) next = -rubberband(-next * step, step) / step;
      else if (next > count - 1) next = count - 1 + rubberband((next - count + 1) * step, step) / step;
    }
    render(next);
  });

  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    deck.classList.remove("pressed");

    if (!dragging) {
      // A click that caught the stack mid-flight lets it finish the move.
      if (interrupted) go(Math.round(position));
      return;
    }

    dragging = false;
    // The click that follows a drag's pointerup is the drag, not a click.
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);

    const oldest = trail[0];
    const span = (event.timeStamp - oldest.at) / 1000;
    const pointerVelocity = span > 0 ? (event.clientX - oldest.x) / span : 0;
    const step = stepWidth();

    // Decide on where the flick was heading, one card at most either way.
    const from = Math.round(startPosition);
    const flickedTo = position - project(pointerVelocity) / step;
    const target = Math.max(from - 1, Math.min(from + 1, Math.round(flickedTo)));
    go(target, -pointerVelocity);
  };

  // On the window, so a press let go outside the deck before it became a drag
  // (no capture yet) still ends, and the hand opens again.
  addEventListener("pointerup", finish);
  addEventListener("pointercancel", finish);

  deck.addEventListener("click", (event) => {
    if (swallowClick) {
      event.stopPropagation();
      event.preventDefault();
      swallowClick = false;
      return;
    }
    const card = event.target.closest(".shot-card");
    if (card && !card.classList.contains("is-active")) {
      event.stopPropagation();
      go(nearest(Number(card.dataset.shot)));
    }
  });

  dots.forEach((dot) =>
    dot.addEventListener("click", () => go(nearest(Number(dot.dataset.shot))))
  );

  // One card along, from the arrow keys. The lightbox, when it is showing this
  // stack, swaps to the new front card; focus on a card follows it (the old
  // one leaves the tab order).
  function step(delta) {
    const hadFocus = cards.includes(document.activeElement);
    go(heading + delta);
    const front = cards[active];
    if (lightbox.open && cards.includes(shotThatOpenedLightbox)) showInLightbox(front);
    else if (hadFocus) front.focus({ preventScroll: true });
  }

  // The dots are one slider, the way a page control is one adjustable element
  // on iOS. When VoiceOver's swipe up or down (or any screen reader's
  // increment) lands on an ARIA slider, WebKit and Chromium both send it a real
  // → or ← keydown and leave the value to the page (WebKit's
  // postKeyboardKeysForValueChange, Chromium's AlterSliderOrSpinButtonValue),
  // so the keys are the whole contract. ↑ / ↓ and Home / End are the rest of a
  // slider's keyboard, for anyone tabbing to it. Handled here rather than by
  // the page-wide arrows, which would move whichever stack is most in view.
  slider.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const delta = SLIDER_STEPS[event.key];
    const end = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
    if (!delta && end === null) return;
    event.preventDefault();
    announce = false;
    if (delta) step(delta);
    else go(nearest(end));
    announce = true;
  });

  // A sideways two-finger swipe moves one card however far it goes, like a
  // flick. Whether a swipe is the stack's or the page's is settled by its
  // first event, mostly sideways or not, because browsers only let a gesture's
  // first wheel event be cancelled (cancelling it is also what keeps Safari
  // from taking the swipe as Back). The momentum that follows the fingers lifting
  // is still the same swipe, until the events stop. A pinch arrives as a wheel
  // event with ctrlKey and stays the browser's zoom.
  let swipe = null;
  let lastWheelAt = -Infinity;

  stack.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || pointerId !== null) return;
      if (event.timeStamp - lastWheelAt > WHEEL_SWIPE_GAP) swipe = null;
      lastWheelAt = event.timeStamp;

      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? innerWidth
            : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      if (!swipe) {
        if (!dx && !dy) return;
        swipe = { ours: event.cancelable && Math.abs(dx) > Math.abs(dy), travel: 0, moved: false };
      }
      if (!swipe.ours) return;
      event.preventDefault();

      // Momentum never turns round, so a swipe back is a new one.
      if (swipe.moved && dx && Math.sign(dx) !== Math.sign(swipe.travel)) {
        swipe.travel = 0;
        swipe.moved = false;
      }
      if (swipe.moved) return;
      swipe.travel += dx;
      if (Math.abs(swipe.travel) < WHEEL_SWIPE_DISTANCE) return;
      swipe.moved = true;
      step(Math.sign(swipe.travel));
    },
    { passive: false }
  );

  setActive(0);
  render(0);
  return { element: stack, step };
}


/* ---------------------------------------------------------------------------
   Table of contents.

   The apps listed down the far left on wide screens, styled like a settings
   sidebar: the one in view in full text colour with a dot beside it, the rest
   muted. They are plain in-page links, so they keep working without this
   script's help, put the app in the address bar, and scroll with the page's
   own smooth scrolling (which reduced motion turns off). One app needs no
   contents, so the list only appears from two.

   The app in view is the last one whose top has passed a line 40% of the way
   down the window, or the last one once the page can scroll no further: a
   short last entry may never reach the line, and the dot should still get
   there when the reader does.
   --------------------------------------------------------------------------- */

const tocElement = document.getElementById("toc");
const TOC_LINE = 0.4; // share of the window's height

function wireToc(projects) {
  if (projects.length < 2) return;

  const tocList = tocElement.querySelector(".toc-list");
  tocList.innerHTML = projects
    .map(
      (project) =>
        `<li><a class="toc-link" href="#${slugOf(project.name)}">${escapeHtml(project.name)}</a></li>`
    )
    .join("");
  document.documentElement.classList.add("has-toc");

  const entries = [...listElement.querySelectorAll(".project")];
  const links = [...tocList.querySelectorAll(".toc-link")];
  let current = -1;
  let frame = 0;

  const update = () => {
    frame = 0;
    const scroller = document.documentElement;
    let index = 0;
    if (innerHeight + scroller.scrollTop >= scroller.scrollHeight - 2) {
      index = entries.length - 1;
    } else {
      entries.forEach((entry, entryIndex) => {
        if (entry.getBoundingClientRect().top <= innerHeight * TOC_LINE) index = entryIndex;
      });
    }
    if (index === current) return;
    links[current]?.removeAttribute("aria-current");
    links[index].setAttribute("aria-current", "true");
    current = index;
  };

  // At most once a frame, however fast the scroll events come.
  const schedule = () => {
    frame ||= requestAnimationFrame(update);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  update();
}
