# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`portseif.github.io` used to be a static GitHub Pages landing page listing Chris's apps with downloads and release notes. That list moved to portseif.io (`/apps/`, plus a page per app at `/apps/<slug>/`, built from `APPS` in `scripts/build_pages.py` in the portseif.io repo) in November 2026, and this repo is now only a redirect. `index.html` is an instant `<meta http-equiv="refresh">` to https://portseif.io/apps/, a `<link rel="canonical">` to the same URL and a plain link; GitHub Pages can't send a 301. `.nojekyll` makes Pages serve the files as-is, and pushing `main` deploys. Don't remove the redirect: StackMe's About window links to https://portseif.github.io.

Edit the app pages in the portseif.io repo, not here. `README.md` says where each app's downloads live.

## What must keep working

- `https://portseif.github.io/StackMe-releases/` is a separate Pages site from the `StackMe-releases` repo. Its `appcast.xml` and disk images are what installed copies of StackMe update from, and portseif.io's download button reads that appcast. Nothing in this repo serves or affects it; don't touch the `StackMe-releases`, `elevenpoint-releases` or `skills-buddy` repos from here.
- No email address goes on this site, the redirect page included. The old page's footer had a `mailto:` link; it was removed before the redirect.

## History

The old page (`app.js`, `styles.css`, `icons/`, `screenshots/`, and `README.md`'s design record: the GitHub API and appcast lookups, the screenshot stack, the changelog panel) is in git history; `git log -- app.js` finds its last version. portseif.io's app icons and screenshots for StackMe, Elevenpoint and Skills Buddy were copied from it.

## Code style

Commit messages are short, lowercase, and describe the visible change. The repo is public, so they follow Chris's humanizer style.

`_design/` (a Pencil `.pen` file plus reference images) and `.claude/` are gitignored and not part of the site.
