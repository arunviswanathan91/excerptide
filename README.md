# Excerptide

**Highlight once. Keep it connected.**

A Chrome/Edge extension and Obsidian plugin for research clippings, backed by the same Supabase account as your personal dashboard. Version 0.1.0 is an installable alpha, not yet a browser-store or Obsidian Community Plugins listing.

## Install — no build required

Download this repository using **Code → Download ZIP**, extract it, and keep the folder somewhere permanent. Ready-to-install builds are included in `dist/`.

### Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select `dist/browser` (the folder containing `manifest.json`).
3. Pin Excerptide to the toolbar. Open it and sign in with your existing personal-dashboard email and password. The correct Supabase connection is prefilled.
4. Refresh any article tabs opened before installation. Select text, right-click → **Highlight with Excerptide**, or press **Alt + Shift + H**.
5. The passage becomes yellow immediately after it is saved or queued. Refreshing or revisiting the same page restores the highlight.

On temporary network failures, clippings remain in an account-specific local retry queue. Keep the extension installed until they sync. Use **Sync now** to check pending items. Logging out does not discard your queue; sign back into the same account to resume.

### Obsidian

1. In your vault, create `.obsidian/plugins/excerptide/`.
2. Copy `main.js` and `manifest.json` from `dist/obsidian/excerptide/` into that folder.
3. Reload Obsidian. In Settings → Community plugins, enable **Excerptide Sync**. You may need to disable Restricted mode to run community plugins.
4. Open Excerptide settings, sign in with the same dashboard account, and click **Sync now**.
5. Notes appear in `Excerptide/<account-id>/`. Sync repeats every minute while Obsidian is open. The command palette also offers **Excerptide Sync: Sync clippings**.

Each clipping has its own stable Markdown file. The managed block contains its excerpt, source links, identifiers, dashboard note, tags, and Zotero link. Write your own content below **My notes**: sync preserves everything outside the managed block. It does not push vault edits back to Supabase or delete local notes when remote records disappear. Removing managed markers opts that file out of updates.

### Personal dashboard

Open [your dashboard’s Clippings section](https://arunviswanathan91.github.io/dashboard/#clippings). Search excerpts, paper titles, identifiers, notes, and tags. Edit notes and tags here; Obsidian imports these on its next sync. The view refreshes every 30 seconds and has a manual Refresh button.

### Zotero

1. Create a dedicated **read-only** personal-library key at <https://www.zotero.org/settings/keys/new>.
2. Enter that key and your numeric Zotero user ID in the extension’s **Connection settings**.
3. On a clipped paper’s page, open Excerptide and click **Match this page to Zotero**.

The extension searches your online Zotero library and accepts an exact DOI, PMID, or PMCID match. PMID/PMCID must be present in Zotero’s Extra field as `PMID: ...` or `PMCID: PMC...`. Sync Zotero Desktop with Zotero online first. Duplicate exact matches are marked ambiguous rather than guessed; absent matches remain unlinked. Title-only suggestions, manual item selection, group libraries, and automatic background reference matching are not yet implemented.

The saved Zotero item link appears in the dashboard and imported Obsidian note. It selects the library item in Zotero Desktop; it does not create PDF annotations. The Zotero key stays in browser-local extension storage, never in Supabase or webpage scripts.

## What is saved

- Original URL, including query parameters and its original fragment.
- A separate page lookup key (URL without fragment).
- Selected text, prefix and suffix context, text start/end offsets, DOM endpoint paths.
- Page/paper title, DOI, PMID, PMCID when supplied by page metadata or recognized NCBI URLs.
- User ownership, timestamps, note, tags, and optional Zotero item reference.

“Go to highlight” creates a separate URL with an Excerptide fragment. The original URL remains unchanged in the record. With the extension installed and signed in, this opens the source, restores highlights and scrolls to the matching excerpt. Without the extension, it still opens the page.

Restoration verifies text offsets, then searches exact text with surrounding context. Ambiguous repeated passages and removed text are not guessed. DOM positions are retained for future anchoring improvements. Pages that substantially rewrite article text may not restore a highlight. Layout changes alone are generally tolerated.

## Scope and privacy

- Supports ordinary HTML webpages, including PubMed and PMC article pages. Browser internal pages, browser PDF viewers, frames, shadow DOM, editable fields, and some heavily dynamic pages are unsupported.
- Only explicitly selected excerpts and associated metadata are uploaded; it does not upload full articles or browsing history. Page URLs are used to look up your saved highlights.
- The extension runs a content script on HTTP/HTTPS pages to restore highlights. Only the background worker can read extension credentials.
- Supabase uses a public publishable key plus a signed-in session. Database row-level policies isolate each user. **Never enter a service-role or secret key.**
- Browser sessions and Zotero credentials are stored locally. Obsidian session tokens are stored in the plugin’s `data.json`; keep that file private and out of public repositories/shared vault exports.
- Deleting local browser data before queued clips sync can lose those clips. No extension-store publishing or paid services are required for manual installation.

## Development

```sh
npm ci
npm test
npm run build
```

`dist/` is committed so installation does not require Node. Regenerate it after source changes. `shared/` contains auth, API, reference matching, anchoring, and safe Markdown rendering. Dependencies are pinned in `package-lock.json`.

For a different Supabase project, apply `sql/setup.sql` once and change connection settings in both clients. The supplied personal-dashboard project already has this schema. The dashboard integration lives in `arunviswanathan91/arunviswanathan91.github.io`.

## Verification

Automated tests cover cross-element selection, page changes, duplicate passages, URL preservation, exact reference matching, Markdown escaping, refreshed sessions, and account isolation in queued writes. The dashboard’s existing checks and production build also pass. Live database verification uses transaction rollback and checks owner writes plus denial of other-user reads. End-to-end use with your own Obsidian vault and Zotero account requires local installation and sign-in.
