# Arcade Finder Improvements — Design Spec

**Date:** 2026-06-15
**Scope:** 7 improvements to search, caching, performance, and UI
**Build order:** Cache invalidation → Search → Relevance ranking → Empty state → URL state → Sheet reads → Dark mode

---

## 1. Auto Cache Invalidation on Sheet Edits

### Problem

The search index is cached and only invalidated when `bumpDiscoveryDataVersion_()` is manually called. Content edits to `Request_Master` can serve stale data for up to 15 minutes.

### Design

Use a simple `onEdit(e)` trigger. Simple triggers can access `CacheService` (though not `PropertiesService`), so no installable trigger setup is needed.

**Server changes in `DiscoveryWebApp.gs`:**

- Add `onEdit(e)` function (simple trigger, auto-runs on any edit):
  - Check `e.source.getActiveSheet().getName() === "Request_Master"`
  - If yes, call `CacheService.getScriptCache().put("DISCOVERY_DIRTY", "1", 900)`
- Modify `getDiscoveryIndexBundle_()`:
  - After loading the version key, check for the dirty flag: `CacheService.getScriptCache().get("DISCOVERY_DIRTY")`
  - If dirty, remove the flag and force a rebuild by clearing `DISCOVERY_RUNTIME_MEMO`
- No manual trigger setup needed — simple triggers activate automatically when named `onEdit`

**No frontend changes.**

### Files affected

- `DiscoveryWebApp.gs`: new `onSheetEdit(e)`, modify `getDiscoveryIndexBundle_()`

---

## 2. Smarter Search — Synonym Expansion & Prefix Matching

### Problem

Substring-only search is brittle. "k8s" doesn't find "Kubernetes", "AAP" doesn't find "Ansible Automation Platform", short prefixes like "auto" don't find "automation".

### Design

Three additive layers in the search pipeline:

#### 2a. Synonym/abbreviation map

- Define `DISCOVERY_SYNONYM_MAP` as a server-side constant:
  ```js
  var DISCOVERY_SYNONYM_MAP = {
    "k8s": ["kubernetes"],
    "kube": ["kubernetes"],
    "ocp": ["openshift container platform", "openshift"],
    "aap": ["ansible automation platform"],
    "rhel": ["red hat enterprise linux"],
    "eap": ["jboss enterprise application platform"],
    "acm": ["advanced cluster management"],
    "acs": ["advanced cluster security"],
    "quay": ["quay container registry"],
    // extensible — add more as zero-result analytics reveal gaps
  };
  ```
- Reverse map also built at startup: `"kubernetes" → ["k8s", "kube"]`

#### 2b. Query expansion

- In `normalizeDiscoveryParams_()`, after tokenizing the query, expand each token:
  - Look up token in synonym map (forward and reverse)
  - Produce expanded token groups: `[["k8s", "kubernetes"], ["security"]]`
- Store expanded groups on the normalized params object as `qGroups` alongside `q`

#### 2c. Matching changes

- Replace `matchesAllTokens_()` with `matchesAllGroups_(blob, groups, blobWords)`:
  - For each group, at least one token in the group must appear in the blob (OR within group)
  - All groups must match (AND across groups)
  - Check substring first; if token is < 6 chars and no substring match, try prefix matching against `blobWords` (pre-split word array)
- Add `blobWords` field to record at index build time: `searchBlob.split(/\s+/)` stored as an array for prefix matching

#### 2d. Compound-word handling

- Already implemented: hyphens stripped from both query and searchBlob
- No additional changes needed

### Files affected

- `DiscoveryWebApp.gs`: new `DISCOVERY_SYNONYM_MAP` constant, new `buildSynonymReverseLookup_()`, modify `normalizeDiscoveryParams_()`, replace `matchesAllTokens_()` with `matchesAllGroups_()`, add `blobWords` to record in `buildDiscoveryRecordFromRow_()`

---

## 3. Relevance-Ranked Search Results

### Problem

Results are always sorted by Featured/Latest status then by Number. When searching, users expect the best matches first.

### Design

- Add `scoreSearchMatch_(item, qGroups)` function:
  - Title token match: +10 per group matched in title
  - Product token match: +5 per group matched in product
  - Other field match: +2 per group matched elsewhere in blob
  - All groups matched in title: +15 bonus
  - Prefix-only match (not substring): half points for that group
  - Return total score

- In `buildDiscoveryListResultFromBundle_()`:
  - When `qGroups` is present, compute `relevanceScore` for each matched item
  - Sort matched items by `relevanceScore` descending, then `sortPriority` ascending, then `number` descending as final tiebreaker
  - When no query (browsing mode), keep current sort unchanged

- The `relevanceScore` is not returned to the frontend — it only affects ordering. Card rendering stays the same.

### Files affected

- `DiscoveryWebApp.gs`: new `scoreSearchMatch_()`, modify sort logic in `buildDiscoveryListResultFromBundle_()`

---

## 4. Empty State with Suggestions

### Problem

Zero-result searches show a generic "No Arcades found" message with no guidance.

### Design

Three types of suggestions, checked in order:

#### 4a. Synonym suggestion ("Did you mean?")

- When results are zero and query is present, check if any query token has synonyms (from Section 2's map)
- If yes, display: "No results for **[query]**. Try searching for **[synonym]**?" with the synonym as a clickable link that populates the search box

#### 4b. Filter conflict hint

- When results are zero and filters are active, identify the problematic combination:
  - Try removing each active filter one at a time via quick `listDiscoveryPage()` server calls
  - If removing a filter produces results, suggest: "No arcades match all your filters. Try removing **[filter name]**."

#### 4c. Relaxed results

- If no synonym or filter fix applies, drop the most restrictive filter (or shorten query to first token) and show up to 5 "Related arcades" cards below the message
- Label: "Showing related arcades instead"

#### 4d. Analytics

- Track a `zero_results` event with: query text, active filters, which suggestion type was shown
- Over time, use this data to expand the synonym map

### Implementation location

- Primarily frontend (`discovery.html`): after `reloadResultsWithCallback()` returns zero results, render the suggestion UI
- The synonym map needs to be accessible on the frontend — include it in the bootstrap payload (`getDiscoveryBootstrap()` returns a `synonyms` field) so no extra server round-trip is needed
- Relaxed-results fallback fires a second `listDiscoveryPage()` call with loosened params

### Files affected

- `discovery.html`: new empty-state rendering logic, synonym suggestion UI, relaxed-query fallback call
- `DiscoveryWebApp.gs`: include synonym map in bootstrap response

---

## 5. URL-Based Filter State (Shareable Links)

### Problem

Search and filter state isn't reflected in the URL. Users can't bookmark, share, or browser-back through filtered views.

### Design

#### Hash-based state

Use the URL fragment (`#`), not query params. Apps Script's `HtmlService` doesn't forward query params to the frontend, but the hash is fully client-side and works inside the iframe.

#### State format

```
#q=ansible&products=RHEL,OpenShift&tdps=AI&page=2
```

- Keys: `q`, `products`, `events`, `tdps`, `marketingPrograms`, `salesTactics`, `creatorNames`, `page`
- Multi-values: comma-separated, URL-encoded
- Empty/default values omitted from hash

#### New frontend functions

- `pushFilterStateToHash_()`: called after every filter change, search, or page navigation. Serializes current `filterState` + search query + page to hash. Uses `history.replaceState()` to avoid polluting history on every keystroke; uses `history.pushState()` only on explicit filter apply or search submit.
- `restoreFilterStateFromHash_()`: called once after bootstrap completes. Parses hash, applies values to `filterState` and UI controls (dropdowns, search input, instant filter pills), then triggers a search reload.
- `hashchange` event listener: calls `restoreFilterStateFromHash_()` to support browser back/forward.

#### Copy link button

- Small link icon next to the search bar
- Copies current URL (with hash) to clipboard
- Shows existing notification toast: "Link copied!"

### Files affected

- `discovery.html`: new hash serialization/deserialization functions, `hashchange` listener, copy-link button in toolbar, call `pushFilterStateToHash_()` from existing filter/search/pagination code

---

## 6. Performance — Optimized Sheet Reads

### Problem

`getDiscoveryIndexBundle_()` reads all rows and columns at once. Link extraction uses per-cell API calls. This gets slow past a few thousand rows and risks Apps Script timeouts.

### Design

#### 6a. Early status filtering

- Read the `Status` column first (single column range)
- Build a set of row numbers where status normalizes to "IE Published" or "IE Reviewed"
- Only process those rows for the full record build
- Typical reduction: 40-60% of rows skipped (drafts, retired, closed)

#### 6b. Batched formula reads for links

- Instead of calling `extractUrlFromCell_()` per cell (which calls `getRichTextValue()` + `getFormulas()` individually), batch-read formulas for each link column:
  ```js
  var formulaRange = sheet.getRange(startRow, col, numRows, 1).getFormulas();
  ```
- Extract URLs from HYPERLINK formulas via regex: `=HYPERLINK\("([^"]+)"` 
- Fall back to display values only for cells without HYPERLINK formulas
- Reduces API calls from ~5n individual calls to 5 bulk reads

#### 6c. Process only needed columns

- Read the full range once (single API call), but after building the header map, only access the ~25 column indices actually needed when constructing records
- Avoids the overhead of per-column `getRange()` calls while still skipping unnecessary data processing

#### 6d. No structural changes

- The output of `getDiscoveryIndexBundle_()` remains identical
- `recordMap`, `facetMaps`, `sortedRecordIds` — same schema
- Caching, API contract, frontend — no changes

### Files affected

- `DiscoveryWebApp.gs`: refactor internals of `getDiscoveryIndexBundle_()` and `buildDiscoveryRecordFromRow_()`, modify `extractUrlFromCell_()` to accept pre-read formula data

---

## 7. Dark Mode

### Problem

No dark mode support. All CSS assumes light backgrounds. No `prefers-color-scheme` media query.

### Design

#### 7a. Automatic dark mode via media query

Add `@media (prefers-color-scheme: dark)` block overriding CSS custom properties:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111827;
    --surface: #1f2937;
    --ink: #f3f4f6;
    --muted: #9ca3af;
    --border: #374151;
    --accent: #8b5cf6;
    --accent2: #2e1065;
    --featured-bg: #1e1338;
    --featured-text: #c4b5fd;
    --latest-bg: #0c2a30;
    --latest-text: #67e8f9;
  }
}
```

#### 7b. Manual toggle

- Sun/moon icon button in the header area (near the saved arcades button)
- Three states: Auto (system) → Light → Dark, cycling on click
- Applied via `data-theme` attribute on `<html>`:
  - `data-theme="auto"` (default): media query controls colors
  - `data-theme="light"`: force light variables
  - `data-theme="dark"`: force dark variables
- CSS selectors: `[data-theme="dark"]` overrides `:root` variables; `[data-theme="light"]` sets light values explicitly
- Preference stored in `localStorage` key `eventArcadeTheme`

#### 7c. Edge cases

- **Skeleton shimmer:** gradient colors need dark variants (darker gray range)
- **Modal backdrops:** use `rgba` with adjusted opacity for dark mode
- **Print / PDF export:** force light theme with `@media print { :root { /* light values */ } }`
- **Notification toasts:** text/background contrast check for both modes
- **Input fields:** background and border colors need dark overrides
- **Scrollbar styling:** if custom scrollbars exist, override for dark

#### 7d. Color choices

Palette follows existing Red Hat / purple brand identity but darkened. Accent purple shifts lighter (#8b5cf6 instead of #6d28d9) for sufficient contrast on dark backgrounds. All text colors target WCAG AA contrast ratio (4.5:1 minimum).

### Files affected

- `discovery.html`: new CSS media query and `[data-theme]` selector blocks, theme toggle button in header HTML, toggle JS function, localStorage persistence

---

## Build Order & Dependencies

```
1. Cache invalidation     ─── standalone
2. Smarter search         ─── standalone
3. Relevance ranking      ─── depends on #2 (token groups infrastructure)
4. Empty state            ─── depends on #2 (synonym map), #3 (scoring)
5. URL filter state       ─── standalone (but easier to test after search improvements)
6. Paginated sheet reads  ─── standalone server optimization
7. Dark mode              ─── standalone CSS/JS
```

Items 1, 2, 5, 6, 7 can be built independently. Items 3 and 4 must follow item 2.

---

## Out of Scope

- Full fuzzy/Levenshtein matching (diminishing returns with synonyms + prefix)
- Offline/service worker support
- Accessibility hardening (separate initiative)
- Filter result counts in dropdowns (separate initiative)
- Saved filter presets (separate initiative)
