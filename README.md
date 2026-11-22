# portseif.github.io

This used to be the landing page listing my apps and their downloads. The list
has moved to [portseif.io/apps](https://portseif.io/apps/), with a page for
each app, and this site is now only a redirect there.

GitHub Pages can't send a 301, so `index.html` is an instant
`<meta http-equiv="refresh">` with a `<link rel="canonical">` to the new page
and a plain link for anything that doesn't follow the refresh. StackMe's About
window still links to https://portseif.github.io, so the redirect has to stay.

The downloads haven't moved. Each app still publishes its builds where it
always has, and the apps on portseif.io link to them there:

- StackMe's Sparkle appcast and disk images are on its own Pages site,
  https://portseif.github.io/StackMe-releases/, from the `StackMe-releases`
  repo. Installed copies update from that appcast, so it has to keep working.
  It's a separate repo and nothing here touches it.
- Elevenpoint's installers go through https://elevenpoint.app/download/.
- Skills Buddy's builds are on its own repo's GitHub Releases.

The old page (`app.js`, `styles.css`, `icons/`, `screenshots/` and the design
notes that were in this file) is in git history. `git log -- app.js` shows the
commit that removed it, and the one before that has the whole page.
