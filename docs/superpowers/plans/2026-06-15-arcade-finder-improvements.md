# Arcade Finder Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 7 improvements to the Arcade Finder app: auto cache invalidation, smarter search with synonyms, relevance-ranked results, empty state suggestions, shareable URL filter state, optimized sheet reads, and dark mode.

**Architecture:** All changes are in two files — `DiscoveryWebApp.gs` (server) and `discovery.html` (frontend). The app is a Google Apps Script web app with no build tools, no test framework, and no Node.js. Testing is manual via the Apps Script editor and deployed web app.

**Tech Stack:** Google Apps Script, HtmlService, CacheService, SpreadsheetApp, vanilla JS/CSS/HTML

---

## File Map

| File | Changes |
|------|---------|
| `DiscoveryWebApp.gs` | Tasks 1-3, 4 (bootstrap), 6 |
| `discovery.html` | Tasks 4 (UI), 5, 7 |

---

### Task 1: Auto Cache Invalidation on Sheet Edits

**Files:**
- Modify: `DiscoveryWebApp.gs`

- [ ] **Step 1.1: Add `onEdit(e)` simple trigger**

Insert after `DISCOVERY_RUNTIME_MEMO` (after line 37):

```js
function onEdit(e) {
  try {
    if (!e || !e.source) return;
    var sheet = e.source.getActiveSheet();
    if (sheet.getName() === DISCOVERY_WEBAPP_CONFIG.MASTER_SHEET) {
      CacheService.getScriptCache().put("DISCOVERY_DIRTY", "1", 900);
    }
  } catch (err) {}
}
```

- [ ] **Step 1.2: Add dirty-flag check to `getDiscoveryIndexBundle_()`**

In `getDiscoveryIndexBundle_()`, after `var versionKey = getDiscoverySheetVersion_(sh);` (line ~511) and before the memo check, insert:

```js
  var cache = CacheService.getScriptCache();
  var dirty = cache.get("DISCOVERY_DIRTY");
  if (dirty) {
    cache.remove("DISCOVERY_DIRTY");
    DISCOVERY_RUNTIME_MEMO.versionKey = "";
    DISCOVERY_RUNTIME_MEMO.bundle = null;
  }
```

- [ ] **Step 1.3: Manual test**

1. Deploy the updated script
2. Open the web app and note displayed arcades
3. Edit a title in `Request_Master` in the spreadsheet
4. Reload the web app — changed title should appear without manually calling `bumpDiscoveryDataVersion_()`
5. Reload again with no new edits — should NOT rebuild (check execution log for cache hit)

---

### Task 2: Smarter Search — Synonym Expansion & Prefix Matching

**Files:**
- Modify: `DiscoveryWebApp.gs`

- [ ] **Step 2.1: Add synonym map constant**

Insert after `DISCOVERY_RUNTIME_MEMO` (after line 37):

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
  "odf": ["openshift data foundation"],
  "rosa": ["red hat openshift service on aws"],
  "aro": ["azure red hat openshift"],
  "3scale": ["3scale api management"],
  "sso": ["single sign on", "red hat single sign on"],
  "amq": ["amq streams", "amq broker"],
  "virt": ["virtualization", "openshift virtualization"],
};
```

- [ ] **Step 2.2: Add `buildSynonymLookup_()` function**

Insert after `matchesAllTokens_()`:

```js
var DISCOVERY_SYNONYM_LOOKUP_ = null;

function buildSynonymLookup_() {
  if (DISCOVERY_SYNONYM_LOOKUP_) return DISCOVERY_SYNONYM_LOOKUP_;

  var forward = {};
  var reverse = {};

  for (var key in DISCOVERY_SYNONYM_MAP) {
    if (!DISCOVERY_SYNONYM_MAP.hasOwnProperty(key)) continue;
    var expansions = DISCOVERY_SYNONYM_MAP[key];
    forward[key] = expansions.slice();

    for (var i = 0; i < expansions.length; i++) {
      var tokens = expansions[i].split(/\s+/);
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        if (!reverse[tok]) reverse[tok] = [];
        if (reverse[tok].indexOf(key) === -1) reverse[tok].push(key);
      }
      var full = expansions[i];
      if (!reverse[full]) reverse[full] = [];
      if (reverse[full].indexOf(key) === -1) reverse[full].push(key);
    }
  }

  DISCOVERY_SYNONYM_LOOKUP_ = { forward: forward, reverse: reverse };
  return DISCOVERY_SYNONYM_LOOKUP_;
}
```

- [ ] **Step 2.3: Add `expandQueryTokens_()` function**

Insert after `buildSynonymLookup_()`:

```js
function expandQueryTokens_(tokens) {
  var lookup = buildSynonymLookup_();
  var groups = [];

  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    var group = [token];

    if (lookup.forward[token]) {
      var expansions = lookup.forward[token];
      for (var j = 0; j < expansions.length; j++) {
        if (group.indexOf(expansions[j]) === -1) group.push(expansions[j]);
      }
    }

    if (lookup.reverse[token]) {
      var abbreviations = lookup.reverse[token];
      for (var j = 0; j < abbreviations.length; j++) {
        if (group.indexOf(abbreviations[j]) === -1) group.push(abbreviations[j]);
      }
    }

    groups.push(group);
  }

  return groups;
}
```

- [ ] **Step 2.4: Add `matchesAllGroups_()` function**

Insert after `expandQueryTokens_()`:

```js
function matchesAllGroups_(blob, groups, blobWords) {
  var s = String(blob || "");
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var groupMatched = false;

    for (var t = 0; t < group.length; t++) {
      var token = group[t];

      if (s.indexOf(token) !== -1) {
        groupMatched = true;
        break;
      }

      if (token.length < 6 && blobWords) {
        for (var w = 0; w < blobWords.length; w++) {
          if (blobWords[w].indexOf(token) === 0) {
            groupMatched = true;
            break;
          }
        }
        if (groupMatched) break;
      }
    }

    if (!groupMatched) return false;
  }
  return true;
}
```

- [ ] **Step 2.5: Add `blobWords` field to records**

In `buildDiscoveryRecordFromRow_()`, after the `searchBlob` construction (after the `.replace(/-/g, " ")` line), add:

```js
  var blobWords = searchBlob.split(/\s+/).filter(Boolean);
```

In the return object, add `blobWords` after `searchBlob`:

```js
    searchBlob,
    blobWords,
    sortPriority,
```

- [ ] **Step 2.6: Modify `normalizeDiscoveryParams_()` to produce `qGroups`**

Replace the function body:

```js
function normalizeDiscoveryParams_(params) {
  var q = normalizeText_(params.q || "").replace(/-/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  var qTokens = q ? q.split(/\s+/).filter(Boolean) : [];
  var qGroups = qTokens.length ? expandQueryTokens_(qTokens) : [];

  return {
    q: q,
    qGroups: qGroups,
    products: normalizeArray_(params.products).sort(),
    events: normalizeArray_(params.events).sort(),
    tdps: normalizeArray_(params.tdps).sort(),
    marketingPrograms: normalizeArray_(params.marketingPrograms).sort(),
    salesTactics: normalizeArray_(params.salesTactics).sort(),
    creatorNames: normalizeArray_(params.creatorNames).sort(),
    page: Math.max(1, Number(params.page || 1)),
    pageSize: Math.max(1, Number(params.pageSize || DISCOVERY_WEBAPP_CONFIG.PAGE_SIZE)),
  };
}
```

- [ ] **Step 2.7: Update `buildDiscoveryListResultFromBundle_()` to use `qGroups`**

Replace lines 193-194:
```js
  const q = normalized.q;
  const qTokens = q ? q.split(/\s+/).filter(Boolean) : null;
```
With:
```js
  var q = normalized.q;
  var qGroups = (normalized.qGroups && normalized.qGroups.length) ? normalized.qGroups : null;
```

Replace line 227:
```js
    if (qTokens && !matchesAllTokens_(item.searchBlob, qTokens)) continue;
```
With:
```js
    if (qGroups && !matchesAllGroups_(item.searchBlob, qGroups, item.blobWords)) continue;
```

- [ ] **Step 2.8: Manual test**

1. Deploy and open the web app
2. Search "k8s" — should find records with "kubernetes"
3. Search "aap" — should find "Ansible Automation Platform" records
4. Search "auto" — should find records with words starting with "auto" (e.g., "automation")
5. Search "rhel security" — should match records with both "red hat enterprise linux" AND "security"
6. Search "openshift" — should still work exactly as before
7. Verify quick filter pills still work

---

### Task 3: Relevance-Ranked Search Results

**Files:**
- Modify: `DiscoveryWebApp.gs`

- [ ] **Step 3.1: Add `scoreSearchMatch_()` function**

Insert after `matchesAllGroups_()`:

```js
function scoreSearchMatch_(item, qGroups) {
  if (!qGroups || !qGroups.length) return 0;

  var titleBlob = String(item.title || "").toLowerCase().replace(/-/g, " ");
  var productBlob = String(item.product || "").toLowerCase().replace(/-/g, " ");
  var titleWords = titleBlob.split(/\s+/).filter(Boolean);
  var productWords = productBlob.split(/\s+/).filter(Boolean);
  var totalScore = 0;
  var titleGroupsMatched = 0;

  for (var g = 0; g < qGroups.length; g++) {
    var group = qGroups[g];
    var bestFieldScore = 0;
    var isPrefixOnly = true;

    for (var t = 0; t < group.length; t++) {
      var token = group[t];

      if (titleBlob.indexOf(token) !== -1) {
        if (bestFieldScore < 10) bestFieldScore = 10;
        isPrefixOnly = false;
      } else if (token.length < 6) {
        for (var w = 0; w < titleWords.length; w++) {
          if (titleWords[w].indexOf(token) === 0) {
            if (bestFieldScore < 10) bestFieldScore = 10;
            break;
          }
        }
      }

      if (productBlob.indexOf(token) !== -1) {
        if (bestFieldScore < 5) bestFieldScore = 5;
        isPrefixOnly = false;
      } else if (token.length < 6) {
        for (var w = 0; w < productWords.length; w++) {
          if (productWords[w].indexOf(token) === 0) {
            if (bestFieldScore < 5) bestFieldScore = 5;
            break;
          }
        }
      }

      if (bestFieldScore === 0) {
        var blob = String(item.searchBlob || "");
        if (blob.indexOf(token) !== -1) {
          bestFieldScore = 2;
          isPrefixOnly = false;
        } else if (token.length < 6 && item.blobWords) {
          for (var w = 0; w < item.blobWords.length; w++) {
            if (item.blobWords[w].indexOf(token) === 0) {
              bestFieldScore = 2;
              break;
            }
          }
        }
      }
    }

    if (isPrefixOnly && bestFieldScore > 0) {
      bestFieldScore = Math.ceil(bestFieldScore / 2);
    }

    if (bestFieldScore >= 10) titleGroupsMatched++;
    totalScore += bestFieldScore;
  }

  if (titleGroupsMatched === qGroups.length) {
    totalScore += 15;
  }

  return totalScore;
}
```

- [ ] **Step 3.2: Add relevance sorting to `buildDiscoveryListResultFromBundle_()`**

After the matching loop (after `matched.push(item);` / end of the `for` loop), replace the section up to `var tdpCounts` with:

```js
  // When a search query is present, re-sort by relevance
  if (qGroups && qGroups.length) {
    for (var m = 0; m < matched.length; m++) {
      matched[m]._relevanceScore = scoreSearchMatch_(matched[m], qGroups);
    }
    matched.sort(function(a, b) {
      var ra = a._relevanceScore || 0;
      var rb = b._relevanceScore || 0;
      if (ra !== rb) return rb - ra;
      var sa = Number(a.sortPriority || 99);
      var sb = Number(b.sortPriority || 99);
      if (sa !== sb) return sa - sb;
      return (Number(b.number) || 0) - (Number(a.number) || 0);
    });
    for (var m = 0; m < matched.length; m++) {
      delete matched[m]._relevanceScore;
    }
  }

  var tdpCounts = {};
```

- [ ] **Step 3.3: Manual test**

1. Deploy and open the web app
2. Search for a product name that appears in multiple titles and descriptions (e.g., "openshift")
3. Verify arcades with the term in the title appear before those where it's only in the description
4. Search "rhel virtualization" — arcades with both terms in title should rank highest
5. Clear search — verify default sort (Featured/Latest first) is unchanged
6. Verify pagination works correctly with relevance sorting

---

### Task 4: Empty State with Suggestions

**Files:**
- Modify: `DiscoveryWebApp.gs` (bootstrap response)
- Modify: `discovery.html` (UI rendering)

- [ ] **Step 4.1: Include synonym map in bootstrap response (server)**

In `getDiscoveryBootstrap()`, add `synonymMap` to the return object:

```js
  return {
    me: me || "",
    isEditor: isEditor,
    initial: buildDiscoveryListResultFromBundle_(bundle, normalized),
    filterOptions: buildDiscoveryFilterOptionsFromBundle_(bundle),
    synonymMap: DISCOVERY_SYNONYM_MAP,
  };
```

- [ ] **Step 4.2: Add `SYNONYM_MAP` variable and store from bootstrap (frontend)**

In `discovery.html`, add variable declaration near other state vars (around line 2213):

```js
      let SYNONYM_MAP = {};
```

In `loadData()`, after `FILTER_OPTIONS = bootstrap?.filterOptions || {};`, add:

```js
                  SYNONYM_MAP = bootstrap?.synonymMap || {};
```

- [ ] **Step 4.3: Add empty state CSS**

After the existing `.emptyState` CSS (after line 558), add:

```css
      .emptyState .emptyStateTitle {
        font-size: 15px;
        font-weight: 700;
        color: var(--ink);
        margin-bottom: 8px;
      }
      .emptyState .emptyStateSuggestion {
        margin-top: 12px;
        font-size: 13px;
      }
      .emptyState .emptyStateSuggestion a {
        color: var(--accent);
        cursor: pointer;
        font-weight: 600;
      }
      .emptyState .emptyStateSuggestion a:hover {
        text-decoration: underline;
      }
      .emptyState .emptyStateRelated {
        margin-top: 16px;
        border-top: 1px solid var(--border);
        padding-top: 12px;
      }
      .emptyState .emptyStateRelatedLabel {
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .emptyState .emptyStateRelatedItem {
        padding: 8px 0;
        border-bottom: 1px solid var(--border);
      }
      .emptyState .emptyStateRelatedItem:last-child {
        border-bottom: none;
      }
      .emptyState .emptyStateRelatedTitle {
        font-weight: 600;
        color: var(--ink);
        font-size: 13px;
        cursor: pointer;
      }
      .emptyState .emptyStateRelatedTitle:hover {
        color: var(--accent);
      }
      .emptyState .emptyStateRelatedProduct {
        font-size: 11px;
        color: var(--muted);
        margin-top: 2px;
      }
      .emptyStateFilterHint {
        margin-top: 8px;
      }
      .emptyStateFilterHint button {
        background: none;
        border: 1px solid var(--accent);
        color: var(--accent);
        padding: 4px 10px;
        border-radius: 8px;
        font-size: 12px;
        cursor: pointer;
        margin: 2px;
      }
      .emptyStateFilterHint button:hover {
        background: var(--accent);
        color: #fff;
      }
```

- [ ] **Step 4.4: Add empty state rendering functions**

Add after `renderResults()` (after line 3834):

```js
      function renderEmptyState(query, activeFilters) {
        var resultsEl = getCachedElement("results");
        resultsEl.classList.remove("is-refreshing");

        var html = '<div class="emptyState">';
        html += '<div class="emptyStateTitle">No Arcades found</div>';

        var synonymSuggestion = getSynonymSuggestion_(query);
        if (synonymSuggestion) {
          html += '<div class="emptyStateSuggestion">';
          html += 'No results for <b>' + escapeHtml(query) + '</b>. ';
          html += 'Try searching for <a onclick="applySynonymSearch(\'' + escapeAttr(synonymSuggestion) + '\')">';
          html += escapeHtml(synonymSuggestion) + '</a>?';
          html += '</div>';
        }

        var activeFilterKeys = getActiveFilterKeys_();
        if (activeFilterKeys.length > 0) {
          html += '<div class="emptyStateFilterHint">';
          html += '<div>Your current filters may be too restrictive. Try removing:</div>';
          for (var i = 0; i < activeFilterKeys.length; i++) {
            var key = activeFilterKeys[i];
            var label = getFilterLabel_(key);
            html += '<button onclick="removeFilterAndReload(\'' + escapeAttr(key) + '\')">';
            html += 'Remove ' + escapeHtml(label) + ' filter';
            html += '</button>';
          }
          html += '</div>';
        }

        html += '</div>';
        resultsEl.innerHTML = html;

        if (query && query.trim().length > 0) {
          fetchRelaxedResults_(query, activeFilters);
        }

        trackEvent('zero_results', {
          query: query || '',
          hasFilters: activeFilterKeys.length > 0,
          activeFilters: activeFilterKeys.join(','),
          suggestionType: synonymSuggestion ? 'synonym' : (activeFilterKeys.length > 0 ? 'filter_hint' : 'none'),
        });
      }

      function getSynonymSuggestion_(query) {
        if (!query || !SYNONYM_MAP) return null;
        var tokens = query.toLowerCase().trim().split(/\s+/);
        for (var i = 0; i < tokens.length; i++) {
          var token = tokens[i];
          if (SYNONYM_MAP[token] && SYNONYM_MAP[token].length > 0) {
            return SYNONYM_MAP[token][0];
          }
        }
        return null;
      }

      function getActiveFilterKeys_() {
        var active = [];
        FILTER_DEFS.forEach(function(def) {
          if (filterState[def.key] && filterState[def.key].length > 0) {
            active.push(def.key);
          }
        });
        return active;
      }

      function getFilterLabel_(key) {
        for (var i = 0; i < FILTER_DEFS.length; i++) {
          if (FILTER_DEFS[i].key === key) return FILTER_DEFS[i].label;
        }
        return key;
      }

      function applySynonymSearch(synonym) {
        getCachedElement("globalSearch").value = synonym;
        reloadResults(1);
      }

      function removeFilterAndReload(filterKey) {
        filterState[filterKey] = [];
        renderTopFilters(FILTER_OPTIONS);
        clearInstantFilters();
        reloadResults(1);
      }

      function fetchRelaxedResults_(query, activeFilters) {
        var firstToken = query.trim().split(/\s+/)[0] || "";
        if (!firstToken) return;

        var relaxedParams = {
          q: firstToken,
          products: [], events: [], tdps: [],
          marketingPrograms: [], salesTactics: [], creatorNames: [],
          page: 1,
          pageSize: 5,
        };

        google.script.run
          .withSuccessHandler(function(res) {
            if (!res || !res.items || !res.items.length) return;
            var container = document.querySelector('.emptyState');
            if (!container) return;

            var relatedHtml = '<div class="emptyStateRelated">';
            relatedHtml += '<div class="emptyStateRelatedLabel">Showing related arcades instead</div>';
            for (var i = 0; i < res.items.length; i++) {
              var item = res.items[i];
              relatedHtml += '<div class="emptyStateRelatedItem">';
              relatedHtml += '<div class="emptyStateRelatedTitle" onclick="openMore(\'' + escapeAttr(item.recordId) + '\')">';
              relatedHtml += escapeHtml(item.title || "Untitled");
              relatedHtml += '</div>';
              relatedHtml += '<div class="emptyStateRelatedProduct">' + escapeHtml(item.product || "") + '</div>';
              relatedHtml += '</div>';
            }
            relatedHtml += '</div>';
            container.insertAdjacentHTML('beforeend', relatedHtml);
          })
          .withFailureHandler(function(err) {
            console.warn("Relaxed results fetch failed:", err);
          })
          .listDiscoveryPage(relaxedParams);
      }
```

- [ ] **Step 4.5: Update `renderResults()` to call new empty state**

Replace the empty-state block in `renderResults()`:

```js
        if (!res.items || !res.items.length){
          var currentQuery = getCachedElement("globalSearch").value.trim();
          renderEmptyState(currentQuery, filterState);
          return;
        }
```

- [ ] **Step 4.6: Manual test**

1. Deploy and open the web app
2. Search "xyznotexist" — should see "No Arcades found" with no synonym suggestion
3. Search "k8s" with a restrictive product filter — should see filter removal buttons
4. Search "k8s" with no filters — if no results, should see "Try searching for kubernetes?" clickable suggestion
5. Verify the `zero_results` analytics event appears in the Analytics sheet
6. Verify clicking a related arcade title opens the detail drawer

---

### Task 5: URL-Based Filter State (Shareable Links)

**Files:**
- Modify: `discovery.html`

- [ ] **Step 5.1: Add hash serialization/deserialization functions**

Add after the `filterState` declaration (after line 2260):

```js
      function pushFilterStateToHash_(usePushState) {
        var parts = [];
        var q = getCachedElement("globalSearch").value.trim();
        if (q) parts.push("q=" + encodeURIComponent(q));

        FILTER_DEFS.forEach(function(def) {
          var vals = filterState[def.key];
          if (vals && vals.length) {
            parts.push(def.key + "=" + vals.map(encodeURIComponent).join(","));
          }
        });

        if (CURRENT_PAGE > 1) parts.push("page=" + CURRENT_PAGE);

        var hash = parts.length ? "#" + parts.join("&") : "";

        if (usePushState) {
          history.pushState(null, "", hash || location.pathname + location.search);
        } else {
          history.replaceState(null, "", hash || location.pathname + location.search);
        }
      }

      function restoreFilterStateFromHash_() {
        var hash = location.hash;
        if (!hash || hash === "#") return false;

        var raw = hash.substring(1);
        var pairs = raw.split("&");
        var params = {};

        for (var i = 0; i < pairs.length; i++) {
          var eq = pairs[i].indexOf("=");
          if (eq === -1) continue;
          var key = pairs[i].substring(0, eq);
          var val = decodeURIComponent(pairs[i].substring(eq + 1));
          params[key] = val;
        }

        var changed = false;

        if (params.q !== undefined) {
          getCachedElement("globalSearch").value = params.q;
          changed = true;
        }

        FILTER_DEFS.forEach(function(def) {
          if (params[def.key] !== undefined) {
            var vals = params[def.key].split(",").map(decodeURIComponent).filter(Boolean);
            filterState[def.key] = vals;
            changed = true;
          }
        });

        var page = 1;
        if (params.page) {
          page = Math.max(1, parseInt(params.page, 10) || 1);
        }

        if (changed) {
          renderTopFilters(FILTER_OPTIONS);
          reloadResults(page);
        }

        return changed;
      }
```

- [ ] **Step 5.2: Add hash restoration and hashchange listener to `init()`**

In `init()`, after `renderResults(INITIAL_RESULTS || {...});`, add:

```js
        restoreFilterStateFromHash_();

        window.addEventListener("hashchange", function() {
          restoreFilterStateFromHash_();
        });
```

- [ ] **Step 5.3: Add hash updates to filter/search/pagination code**

In `reloadResultsWithCallback()`, after `const filters = getFilters(CURRENT_PAGE);`, add:

```js
        pushFilterStateToHash_(false);
```

In `resetFilters()`, after `reloadResults(1);`, add:

```js
        history.pushState(null, "", location.pathname + location.search);
```

In `applyInstantFilter()` and `applyTopicFilter()`, after their `reloadResults(1)` calls, add:

```js
        pushFilterStateToHash_(true);
```

- [ ] **Step 5.4: Add "Copy link" button to search toolbar**

After the Reset button in the search row HTML:

```html
            <button class="btn" onclick="copyCurrentUrl()" title="Copy link to current view">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
                <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
              </svg>
              Link
            </button>
```

- [ ] **Step 5.5: Add `copyCurrentUrl()` function**

Add near `copyText()`:

```js
      function copyCurrentUrl() {
        pushFilterStateToHash_(false);
        var url = location.href;
        copyText(url);
        showSuccess("Link copied to clipboard!", "Link Copied");
      }
```

- [ ] **Step 5.6: Manual test**

1. Deploy and open the web app
2. Search "ansible" and apply a product filter — URL should show `#q=ansible&products=...`
3. Copy URL, open in new tab — filters and search should restore
4. Click "Link" button — "Link copied!" notification
5. Navigate pages — URL updates with `&page=2`
6. Browser back/forward — filters change accordingly
7. Click "Reset" — hash clears

---

### Task 6: Optimized Sheet Reads

**Files:**
- Modify: `DiscoveryWebApp.gs`

- [ ] **Step 6.1: Add early status filtering in `getDiscoveryIndexBundle_()`**

After the header map is retrieved and before the full range read, add:

```js
  var statusColIdx = headerMap["Status"];
  var validRowIndices = null;
  if (statusColIdx != null) {
    var statusRange = sh.getRange(
      DISCOVERY_WEBAPP_CONFIG.HEADER_ROW + 1,
      statusColIdx + 1,
      rowCount,
      1
    );
    var statusValues = statusRange.getDisplayValues();
    validRowIndices = [];
    for (var si = 0; si < statusValues.length; si++) {
      var canonical = normalizeStatusCanonical_(normalizeValueForUi_(statusValues[si][0]));
      if (canonical === "IE Published" || canonical === "IE Reviewed") {
        validRowIndices.push(si);
      }
    }
  }
```

- [ ] **Step 6.2: Skip non-discoverable rows in the build loop**

Before the main `for` loop, add:

```js
  var validSet = null;
  if (validRowIndices) {
    validSet = new Set(validRowIndices);
  }
```

At the top of the loop, add early skip:

```js
    if (validSet && !validSet.has(i)) continue;
```

- [ ] **Step 6.3: Manual test**

1. Deploy and open the web app
2. Verify all arcades load correctly — same results as before
3. Verify Featured/Latest badges still appear
4. Verify search, filters, pagination all work unchanged
5. Check execution log timing if baseline available

---

### Task 7: Dark Mode

**Files:**
- Modify: `discovery.html`

- [ ] **Step 7.1: Add dark mode CSS variables**

After the `:root` block (after line 24), add:

```css
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) {
          --bg: #111827;
          --surface: #1f2937;
          --ink: #f3f4f6;
          --muted: #9ca3af;
          --border: #374151;
          --shadow: 0 8px 24px rgba(0,0,0,.25);
          --accent: #8b5cf6;
          --accent2: #2e1065;
          --featured-bg: #1e1338;
          --featured-text: #c4b5fd;
          --latest-bg: #0c2a30;
          --latest-text: #67e8f9;
        }
      }

      [data-theme="dark"] {
        --bg: #111827;
        --surface: #1f2937;
        --ink: #f3f4f6;
        --muted: #9ca3af;
        --border: #374151;
        --shadow: 0 8px 24px rgba(0,0,0,.25);
        --accent: #8b5cf6;
        --accent2: #2e1065;
        --featured-bg: #1e1338;
        --featured-text: #c4b5fd;
        --latest-bg: #0c2a30;
        --latest-text: #67e8f9;
      }

      [data-theme="light"] {
        --bg: #f6f7fb;
        --surface: #ffffff;
        --ink: #111827;
        --muted: #6b7280;
        --border: #e5e7eb;
        --shadow: 0 8px 24px rgba(0,0,0,.06);
        --accent: #6d28d9;
        --accent2: #ede9fe;
        --featured-bg: #f5f3ff;
        --featured-text: #5b21b6;
        --latest-bg: #ecfeff;
        --latest-text: #155e75;
      }
```

- [ ] **Step 7.2: Add dark mode overrides for hardcoded colors**

Add after the `[data-theme="light"]` block. These are needed for both auto-dark and manual-dark:

```css
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) .toolbarWrap {
          background: linear-gradient(to bottom, rgba(17,24,39,.97), rgba(17,24,39,.9));
        }
        :root:not([data-theme="light"]) input {
          background: #374151; color: #f3f4f6; border-color: #4b5563;
        }
        :root:not([data-theme="light"]) input:focus {
          border-color: rgba(139,92,246,.52);
          box-shadow: 0 0 0 4px rgba(139,92,246,.15);
        }
        :root:not([data-theme="light"]) .btn {
          background: #374151; border-color: #4b5563; color: #f3f4f6;
        }
        :root:not([data-theme="light"]) .btn:hover { background: #4b5563; }
        :root:not([data-theme="light"]) .btn.primary {
          background: var(--accent); border-color: var(--accent); color: #fff;
        }
        :root:not([data-theme="light"]) .pickerBox { background: #374151; border-color: #4b5563; }
        :root:not([data-theme="light"]) .pickerDropdown { background: #1f2937; border-color: #4b5563; }
        :root:not([data-theme="light"]) .resourcesHeaderBtn { background: #374151; border-color: #4b5563; color: #f3f4f6; }
        :root:not([data-theme="light"]) .instant-pill { background: #374151; border-color: #4b5563; color: #f3f4f6; }
        :root:not([data-theme="light"]) .instant-pill:hover {
          background: rgba(139,92,246,.15); border-color: var(--accent); color: var(--accent);
        }
        :root:not([data-theme="light"]) .tdpPill { background: #374151; border-color: #4b5563; color: #9ca3af; }
        :root:not([data-theme="light"]) .modalWrap { background: rgba(0,0,0,.55); }
        :root:not([data-theme="light"]) .drawer { background: #1f2937; box-shadow: -10px 0 30px rgba(0,0,0,.3); }
        :root:not([data-theme="light"]) .notification { background: #1f2937; box-shadow: 0 4px 12px rgba(0,0,0,.35); }
        :root:not([data-theme="light"]) .skeletonLine,
        :root:not([data-theme="light"]) .skeletonBadge,
        :root:not([data-theme="light"]) .skeletonMeta,
        :root:not([data-theme="light"]) .skeletonButton { background: #374151; }
        :root:not([data-theme="light"]) .skeletonLine::after,
        :root:not([data-theme="light"]) .skeletonBadge::after,
        :root:not([data-theme="light"]) .skeletonMeta::after,
        :root:not([data-theme="light"]) .skeletonButton::after {
          background: linear-gradient(90deg, rgba(55,65,81,0), rgba(75,85,99,.85), rgba(55,65,81,0));
        }
        :root:not([data-theme="light"]) .sidebarBackdrop { background: rgba(0,0,0,.5); }
        :root:not([data-theme="light"]) .badge.published { background: #064e3b; color: #a7f3d0; }
        :root:not([data-theme="light"]) .badge.reviewed { background: #1e3a5f; color: #93c5fd; }
        :root:not([data-theme="light"]) .savedArcadesCounter { background: #2e1065; color: #c4b5fd; }
      }

      [data-theme="dark"] .toolbarWrap {
        background: linear-gradient(to bottom, rgba(17,24,39,.97), rgba(17,24,39,.9));
      }
      [data-theme="dark"] input { background: #374151; color: #f3f4f6; border-color: #4b5563; }
      [data-theme="dark"] input:focus {
        border-color: rgba(139,92,246,.52);
        box-shadow: 0 0 0 4px rgba(139,92,246,.15);
      }
      [data-theme="dark"] .btn { background: #374151; border-color: #4b5563; color: #f3f4f6; }
      [data-theme="dark"] .btn:hover { background: #4b5563; }
      [data-theme="dark"] .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
      [data-theme="dark"] .pickerBox { background: #374151; border-color: #4b5563; }
      [data-theme="dark"] .pickerDropdown { background: #1f2937; border-color: #4b5563; }
      [data-theme="dark"] .resourcesHeaderBtn { background: #374151; border-color: #4b5563; color: #f3f4f6; }
      [data-theme="dark"] .instant-pill { background: #374151; border-color: #4b5563; color: #f3f4f6; }
      [data-theme="dark"] .instant-pill:hover {
        background: rgba(139,92,246,.15); border-color: var(--accent); color: var(--accent);
      }
      [data-theme="dark"] .tdpPill { background: #374151; border-color: #4b5563; color: #9ca3af; }
      [data-theme="dark"] .modalWrap { background: rgba(0,0,0,.55); }
      [data-theme="dark"] .drawer { background: #1f2937; box-shadow: -10px 0 30px rgba(0,0,0,.3); }
      [data-theme="dark"] .notification { background: #1f2937; box-shadow: 0 4px 12px rgba(0,0,0,.35); }
      [data-theme="dark"] .skeletonLine,
      [data-theme="dark"] .skeletonBadge,
      [data-theme="dark"] .skeletonMeta,
      [data-theme="dark"] .skeletonButton { background: #374151; }
      [data-theme="dark"] .skeletonLine::after,
      [data-theme="dark"] .skeletonBadge::after,
      [data-theme="dark"] .skeletonMeta::after,
      [data-theme="dark"] .skeletonButton::after {
        background: linear-gradient(90deg, rgba(55,65,81,0), rgba(75,85,99,.85), rgba(55,65,81,0));
      }
      [data-theme="dark"] .sidebarBackdrop { background: rgba(0,0,0,.5); }
      [data-theme="dark"] .badge.published { background: #064e3b; color: #a7f3d0; }
      [data-theme="dark"] .badge.reviewed { background: #1e3a5f; color: #93c5fd; }
      [data-theme="dark"] .savedArcadesCounter { background: #2e1065; color: #c4b5fd; }
```

- [ ] **Step 7.3: Add print styles to force light mode**

Before the closing `</style>` tag:

```css
      @media print {
        :root {
          --bg: #f6f7fb !important;
          --surface: #ffffff !important;
          --ink: #111827 !important;
          --muted: #6b7280 !important;
          --border: #e5e7eb !important;
          --shadow: none !important;
          --accent: #6d28d9 !important;
          --accent2: #ede9fe !important;
          --featured-bg: #f5f3ff !important;
          --featured-text: #5b21b6 !important;
          --latest-bg: #ecfeff !important;
          --latest-text: #155e75 !important;
        }
        input { background: #fff !important; color: #111827 !important; }
        .btn { background: #fff !important; color: #111827 !important; }
      }
```

- [ ] **Step 7.4: Add theme toggle button to header**

In the header button group, add as the first button:

```html
          <button class="resourcesHeaderBtn" id="themeToggleBtn" onclick="cycleTheme()" title="Toggle theme">
            <span id="themeIcon">&#9788;</span>
          </button>
```

- [ ] **Step 7.5: Add theme toggle JavaScript**

Add near top of `<script>` block (after state variable declarations):

```js
      var THEME_KEY = 'eventArcadeTheme';
      var THEME_CYCLE = ['auto', 'light', 'dark'];
      var THEME_ICONS = { auto: '☼', light: '☀', dark: '☽' };
      var THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

      function initTheme() {
        var saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch(e) {}
        var theme = (saved && THEME_CYCLE.indexOf(saved) !== -1) ? saved : 'auto';
        applyTheme_(theme);
      }

      function cycleTheme() {
        var current = document.documentElement.getAttribute('data-theme') || 'auto';
        var idx = THEME_CYCLE.indexOf(current);
        var next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
        applyTheme_(next);
        try { localStorage.setItem(THEME_KEY, next); } catch(e) {}
        showInfo('Theme: ' + THEME_LABELS[next], 'Theme');
      }

      function applyTheme_(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        var iconEl = document.getElementById('themeIcon');
        if (iconEl) iconEl.textContent = THEME_ICONS[theme] || THEME_ICONS.auto;
        var btn = document.getElementById('themeToggleBtn');
        if (btn) btn.title = 'Theme: ' + THEME_LABELS[theme] + ' (click to change)';
      }
```

- [ ] **Step 7.6: Initialize theme early to prevent flash**

Add `initTheme()` as the first line in `init()`:

```js
      async function init(){
        initTheme();
        console.log('init() started');
```

Also add inline script right after `<body>` tag to prevent flash:

```html
  <body>
    <script>
      (function() {
        try {
          var t = localStorage.getItem('eventArcadeTheme');
          if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
        } catch(e) {}
      })();
    </script>
```

- [ ] **Step 7.7: Manual test**

1. Deploy and open the web app
2. **Auto mode:** If OS is in dark mode, app should use dark colors automatically
3. **Toggle:** Click theme button — cycles Auto → Light → Dark with icon change and notification
4. **Persistence:** Set Dark, close tab, reopen — stays Dark
5. **Print:** In Dark mode, Ctrl+P — print preview forces light mode
6. **Component check in dark mode:** Cards, skeleton shimmer, modals/drawers, notifications, filter dropdowns, inputs, quick filter pills, TDP pills, badges, sidebar, saved arcades counter

---

## Verification Checklist

After all 7 tasks are implemented:

- [ ] App loads via `doGet()` without errors
- [ ] Initial results load via `getDiscoveryBootstrap()`
- [ ] Search finds results with synonyms (k8s, aap, rhel)
- [ ] Search results are relevance-ranked when a query is present
- [ ] Default sort (Featured/Latest) works when browsing without a query
- [ ] Zero-result searches show synonym suggestions and filter hints
- [ ] URL hash updates on filter/search changes
- [ ] Shared URLs restore filter/search state
- [ ] Sheet edits auto-invalidate the cache
- [ ] Dark mode auto-activates based on OS preference
- [ ] Theme toggle persists across sessions
- [ ] All existing features still work (saved arcades, export, sharing, analytics)
