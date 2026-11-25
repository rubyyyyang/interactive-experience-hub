# Beta Feedback Recommendations

## Content Type Toggle (COMPLETED ✓)

**Issue:** Clicking an already-selected content type did not deselect it and return to All Experiences.

**Solution Implemented:**
- Modified `browseByExperience()` to detect when a content type is already selected
- Clicking the selected type now deselects it and returns to All Experiences state
- Preserves search query and all other filters (Product, TDP, Sales Tactic, etc.)
- Synchronizes filter state, visual highlights, and URL hash correctly
- Added regression test coverage in `tests/package-3a-regression.test.js`

**Commit:** `c75b595` - fix(discovery): implement content type toggle to deselect

---

## 1. Filter Discoverability

### Current State

**TDP and Creator filters** are located in the "More filters" panel which:
- Starts collapsed by default
- Requires clicking "More filters" button to expand
- Contains 6 filter types: Type, Product, TDP, Sales Tactic, Marketing Program, Creator
- Beta users reported difficulty finding TDP and Creator filters

### Recommended Approach: Promote TDP to Quick Filters

**Minimal, targeted improvement without redesign:**

Add **TDP Quick Filter pills** next to the existing product-based Quick Filters. This surfaces the most-used TDP filters without cluttering the UI.

**Rationale:**
- TDP is a primary facet for discovery (along with Product)
- Current Quick Filters show 5 pills: RHEL, OpenShift, Ansible, AI, Virtualization
- AI and Virtualization already map to TDP filters (`['AI Platform']` and `['Virtualization']`)
- Adding explicit TDP pills provides direct access without needing "More filters"

**Implementation:**

1. **Add TDP pills to Quick Filters row** (after existing pills):
   ```
   Current: RHEL | OpenShift | Ansible | AI | Virtualization
   Proposed: RHEL | OpenShift | Ansible | AI | Virtualization | ⋮ [More Products] | Container Mgmt | Server/Cloud OS | App Platform | Automation
   ```

2. **Alternative (simpler):** Keep existing Quick Filters, but add a visual hint:
   - Change "More filters" button text to "More filters (TDP, Sales Tactic, Creator)"
   - Or add a tooltip on hover: "Find TDP, Creator, Sales Tactic, and Marketing Program filters"

**Why NOT Creator Quick Filter:**
- Creator filter is used less frequently (beta feedback focused on TDP discoverability)
- Too many Quick Filter pills creates clutter
- Creator remains easily accessible via "More filters" with the visual hint

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| Add TDP pills | Direct access to high-value TDPs; immediate visibility | Adds 4-6 more pills; potential mobile wrapping |
| Button hint | Zero UI clutter; simple implementation | Still requires click to open panel |
| Hybrid (AI/Virt stay, add hint) | No change to existing layout; clarifies what's inside | Doesn't fully solve TDP discoverability |

**Recommendation:** Start with **button text hint** ("More filters (TDP, Sales Tactic, Creator)") as the simplest meaningful improvement. If beta feedback confirms TDP is still hard to find, escalate to dedicated TDP Quick Filter pills.

**Effort:** Low (1-2 hours)

---

## 2. Performance Investigation

### Current Architecture Summary

**Caching Strategy (3-tier):**

1. **In-memory runtime cache** (`DISCOVERY_RUNTIME_MEMO`):
   - Stores full index bundle (records, facets, search index)
   - Keyed by `versionKey` (sheetId + lastRow + lastColumn + DATA_VERSION + ytRows)
   - Lives for the duration of a single Apps Script execution (~6 minutes max)
   - **Reused across requests within the same execution context**

2. **Script Cache** (`CacheService.getScriptCache()`):
   - 10 MB size limit, 6-hour max TTL
   - Stores:
     - Bootstrap data (1800s = 30 min TTL)
     - Filter options (900s = 15 min TTL)
     - List results (300s = 5 min TTL)
   - Shared across ALL Apps Script executions (all users, all instances)
   - **Reused across independent Apps Script executions**

3. **Client-side localStorage**:
   - Bootstrap cache (30 min TTL)
   - Results cache (5 min TTL, max 40 entries)
   - Avoids server roundtrips entirely for repeat queries

**Index Build Process:**

```javascript
getDiscoveryIndexBundle_() {
  // 1. Check in-memory cache first (DISCOVERY_RUNTIME_MEMO)
  if (DISCOVERY_RUNTIME_MEMO.versionKey === versionKey && DISCOVERY_RUNTIME_MEMO.bundle) {
    return DISCOVERY_RUNTIME_MEMO.bundle; // ⚡ Instant (0ms)
  }

  // 2. Cache miss: rebuild from Google Sheets
  const data = sheet.getRange(2, 1, rowCount, lastCol).getDisplayValues(); // 🐌 Expensive (1-3s for 500 rows)
  
  // Build index, facet maps, search index
  for (each row) {
    - buildDiscoveryRecordFromRow_()
    - addRecordToFacetMap_()
    - addRecordToSearchIndex_()
  }
  
  // 3. Store in in-memory cache for this execution
  DISCOVERY_RUNTIME_MEMO.versionKey = versionKey;
  DISCOVERY_RUNTIME_MEMO.bundle = bundle;
  return bundle;
}
```

### Key Findings

#### ✅ What's Working Well

1. **In-memory cache (`DISCOVERY_RUNTIME_MEMO`) reuses index across requests**:
   - First request in an execution: rebuilds index (~1-3s)
   - Subsequent requests in same execution: instant (0ms)
   - Confirmed by lines 1012-1013 and 1127-1128

2. **Bootstrap cache prevents full reload on page load**:
   - Cached for 30 minutes in both Script Cache and localStorage
   - Initial page load: near-instant if cached
   - Background refresh updates cache without blocking user

3. **Results cache eliminates redundant searches**:
   - 5-minute TTL, keyed by filter+query combination
   - Switching between content type tabs: instant if cached
   - Performance measurement confirms: "Experience tab 'Interactive Demo' (cached): 23.4ms"

4. **Client-side prefetching** (lines 609-649):
   - Preloads top 3 content types in background after base results load
   - Makes tab switches feel instant even if not in results cache

#### ❌ Performance Bottlenecks Identified

**1. Full Discovery Index Rebuilt on EVERY New Apps Script Execution**

**Problem:**
- Google Apps Script does NOT guarantee persistent execution contexts
- Each new user request may spawn a new execution context (new VM)
- New context = `DISCOVERY_RUNTIME_MEMO` is empty = rebuild index from scratch
- Rebuilding index requires reading ALL rows from Google Sheets (1-3s for 500 rows)

**Evidence:**
- Line 1012-1014: Checks `DISCOVERY_RUNTIME_MEMO` first, but it's empty on first request
- Line 1026: `sh.getRange(...).getDisplayValues()` reads entire sheet on cache miss
- No persistent cross-execution cache for the full index bundle

**Why Script Cache doesn't help:**
- Script Cache has 10 MB size limit
- Full index bundle (500 records + facets + search index + display values) is likely 2-5 MB
- Bootstrap data alone is cached, but NOT the full index
- Each `listDiscoveryPage_()` call rebuilds index if not in `DISCOVERY_RUNTIME_MEMO`

**Impact:**
- First search after idle period: 1-3s delay
- Heavy concurrent usage: more new executions = more index rebuilds
- CPU waste: rebuilding same index repeatedly across executions

**2. Google Sheets API Read Performance Ceiling**

**Problem:**
- `getRange().getDisplayValues()` for 500 rows × 50 columns ≈ 1-3 seconds
- This is an **Apps Script platform limit**, not an implementation issue
- Display values include formatted text, which is slower than raw values
- Cannot be eliminated entirely (we need the data)

**Current mitigation (good):**
- Only reads discoverable rows (statusColIdx check at lines 1029-1039)
- Uses single bulk read instead of row-by-row reads
- Caches results in `DISCOVERY_RUNTIME_MEMO` to avoid re-reading within execution

**Cannot improve further without:**
- Moving to a different data source (Databricks, Cloud SQL)
- Pre-aggregating data outside Google Sheets
- Both are **architecture changes** beyond this task's scope

**3. Prefetching Introduces Background Load**

**Current behavior** (lines 609-649):
- After base results load, prefetches 3 content type tabs in background
- Staggered 500ms + 300ms per tab
- Each prefetch calls `listDiscoveryPage_()` = server roundtrip

**Trade-off:**
- ✅ Makes tab switches feel instant (great UX)
- ❌ Adds 3 extra server calls within 1.4 seconds
- ❌ If backend is cold (new execution), each call rebuilds index

**Mitigation already in place:**
- Only prefetches if no active filters (lines 613-617)
- Skips if already cached or in-flight (lines 626-627)
- Staggered to avoid spike

**Is this wasteful?**
- If user NEVER clicks tabs: yes (3 wasted calls)
- If user DOES click tabs: no (perceived instant load is worth it)
- Usage analytics would tell us: what % of users actually switch tabs?

**Without analytics, recommendation:** Keep prefetching as-is (good UX), but ensure it respects existing cache.

---

### Recommended Performance Improvements

#### **Priority 1: Persistent Cross-Execution Index Cache (High Impact)**

**Problem:** Index rebuilt on every new Apps Script execution.

**Solution:** Cache the full index bundle in Script Cache with version-based invalidation.

**Implementation:**

```javascript
function getDiscoveryIndexBundle_() {
  const sh = getMasterSheet_();
  const versionKey = getDiscoverySheetVersion_(sh);
  
  // 1. Check in-memory cache (fastest)
  if (DISCOVERY_RUNTIME_MEMO.versionKey === versionKey && DISCOVERY_RUNTIME_MEMO.bundle) {
    return DISCOVERY_RUNTIME_MEMO.bundle;
  }
  
  // 2. NEW: Check Script Cache for serialized index
  const scriptCache = CacheService.getScriptCache();
  const cacheKey = "index_bundle:" + versionKey;
  const cachedBundle = getScriptCacheJson_(cacheKey);
  
  if (cachedBundle) {
    // Deserialize and restore in-memory
    DISCOVERY_RUNTIME_MEMO.versionKey = versionKey;
    DISCOVERY_RUNTIME_MEMO.bundle = cachedBundle;
    return cachedBundle;
  }
  
  // 3. Cache miss: rebuild from Sheets (slow path)
  const bundle = buildDiscoveryIndexBundleFromSheets_();
  
  // 4. Store in BOTH caches
  DISCOVERY_RUNTIME_MEMO.versionKey = versionKey;
  DISCOVERY_RUNTIME_MEMO.bundle = bundle;
  
  // Store in Script Cache with 30-min TTL (same as bootstrap)
  putScriptCacheJson_(cacheKey, bundle, 1800);
  
  return bundle;
}
```

**Expected Impact:**
- **First request after sheet update:** Still slow (1-3s) - cannot avoid Sheets read
- **All subsequent requests (any execution):** 50-200ms (Script Cache deserialization only)
- **Eliminates** redundant index rebuilds across different Apps Script executions
- **Cache size concern:** Full index likely 2-5 MB; monitor Script Cache usage

**Invalidation strategy:**
- `versionKey` already includes sheetId, lastRow, lastColumn, DATA_VERSION, ytRows
- Any sheet change → new versionKey → cache miss → rebuild (correct behavior)
- Manual invalidation via `forceInvalidateDiscoveryCache()` (already exists)

**Risk:** Script Cache 10 MB limit could be exceeded if multiple large caches exist. Mitigation: monitor cache size, add fallback if cache write fails.

**Effort:** Medium (4-6 hours including testing)

---

#### **Priority 2: Optimize Display Values Read (Medium Impact)**

**Problem:** `getDisplayValues()` is slower than `getValues()` because it includes formatting.

**Solution:** Use `getValues()` for numeric/date columns that don't need formatting, only use `getDisplayValues()` for text columns where needed.

**Current:**
```javascript
const data = range.getDisplayValues(); // Returns formatted strings
```

**Optimized:**
```javascript
const data = range.getValues(); // Returns raw values (faster)
// Use getDisplayValues() only for specific formatted columns if needed
```

**Trade-off:**
- **Speed improvement:** 10-30% faster read (anecdotal from GAS forums)
- **Risk:** May break existing code that relies on formatted display values
- **Mitigation:** Test thoroughly; most Discovery fields are already plain text

**Expected Impact:**
- Reduces cold index rebuild from ~1500ms to ~1000-1200ms
- Combined with Priority 1, most requests avoid this entirely

**Effort:** Low-Medium (2-3 hours for safe migration + testing)

---

#### **Priority 3: Lazy-Load YouTube Records (Low Impact, Optional)**

**Problem:** `getDiscoveryIndexBundle_()` reads YouTube_Responses sheet on every index build (lines 1078-1113), even if user never searches for YouTube content.

**Solution:** Build YouTube index only when format filter includes "YouTube" OR on bootstrap.

**Implementation:**

```javascript
function getDiscoveryIndexBundle_(includeYouTube = true) {
  // Build Request_Master index first
  
  if (includeYouTube) {
    // Add YouTube records (lines 1078-1113)
  }
  
  return bundle;
}
```

Call with `includeYouTube: false` when filters explicitly exclude YouTube.

**Expected Impact:**
- Saves ~200-500ms if YouTube sheet is large
- Only benefits requests that DON'T need YouTube data
- Complexity: adds conditional logic to index builder

**Recommendation:** Skip this unless YouTube sheet grows large (>200 rows). Current implementation is simpler and correctness is more important than marginal speed.

**Effort:** Medium (3-4 hours)

---

#### **Priority 4: Monitor and Tune Prefetch Strategy (Low Impact)**

**Current:** Prefetches 3 content types after base results load.

**Data needed:**
- What % of users actually click content type tabs?
- What % of prefetch calls hit cache vs. trigger server load?

**Potential optimizations** (only if analytics confirm waste):
- Reduce prefetch to top 1-2 types only
- Skip prefetch if server response time > threshold (indicates cold backend)
- Prefetch on user hover instead of immediate

**Recommendation:** Gather analytics first. Current prefetch behavior is reasonable without evidence it's wasteful.

**Effort:** Low (analytics collection), Medium (optimization if needed)

---

### What We CANNOT Improve (Architectural Limits)

#### **1. Google Sheets Read Performance**

**Limit:** `getRange().getDisplayValues()` for 500 rows is 1-3 seconds. This is a platform ceiling.

**Why we can't fix it:**
- Apps Script Sheets API is slower than native Google Sheets UI
- Display values include formatting, which adds overhead
- Batch read is already optimal (single API call, not row-by-row)

**Workarounds require architecture change:**
- Move to Databricks / Cloud SQL (faster querying)
- Pre-aggregate into denormalized JSON snapshot (bypass Sheets entirely)
- Both are **major migrations** beyond this task

#### **2. Apps Script Execution Context Lifespan**

**Limit:** `DISCOVERY_RUNTIME_MEMO` (in-memory cache) is wiped when execution ends (~6 min max).

**Why this matters:**
- Cannot guarantee persistent cache across user requests
- Heavy concurrent usage → more new executions → more cache misses

**Mitigation (Priority 1):** Use Script Cache for cross-execution persistence.

**Cannot eliminate entirely:** Some requests will always trigger cold execution (first request, timeout, concurrent spike).

#### **3. Script Cache Size Limit (10 MB)**

**Limit:** Cannot cache unlimited data in Script Cache.

**Current usage estimate:**
- Bootstrap data: ~500 KB
- Filter options: ~100 KB
- Index bundle (new): ~2-5 MB
- Results cache (40 entries): ~1-2 MB
- **Total: ~4-8 MB** (within limit, but approaching it)

**Risk:** If repository grows to 1000+ records, index bundle may exceed cache size.

**Mitigation:**
- Monitor cache writes (log failures)
- Add fallback: if cache write fails, continue without caching (slower but functional)
- Consider compressing JSON before caching (gzip-like in Apps Script is tricky)

---

### Summary of Recommendations

| Priority | Improvement | Expected Impact | Effort | Implement? |
|----------|-------------|-----------------|--------|------------|
| 1 | Persistent cross-execution index cache (Script Cache) | **High** - 50-200ms instead of 1-3s for most requests | Medium | ✅ **Yes** |
| 2 | Use `getValues()` instead of `getDisplayValues()` | Medium - 10-30% faster Sheets read | Low-Medium | ✅ **Yes** |
| 3 | Lazy-load YouTube records | Low - Only benefits non-YouTube queries | Medium | ❌ Not worth complexity |
| 4 | Monitor/tune prefetch strategy | Low - Needs analytics first | Low (analytics) | ⏸️ Gather data first |

**Combined expected result** (Priority 1 + 2):
- **Cold execution (cache miss):** 1500ms → 1000-1200ms (index rebuild)
- **Warm execution (cache hit):** 1500ms → 50-200ms (Script Cache deserialization)
- **Client-side cached queries:** Already near-instant (<50ms)

**Biggest win:** Eliminate redundant index rebuilds across Apps Script executions via Script Cache.

---

### Performance Verification Plan

**Before changes:**
1. Log index build time in `getDiscoveryIndexBundle_()` (add timestamp logging)
2. Measure cold vs. warm request times over 1 week
3. Record Script Cache hit rate (if possible)

**After Priority 1 implementation:**
1. Verify Script Cache is being used (log cache hits/misses)
2. Measure average request time reduction
3. Monitor Script Cache size (ensure <10 MB)

**After Priority 2 implementation:**
1. Confirm no data formatting regressions (manual QA)
2. Measure index rebuild time improvement

**Success criteria:**
- 90%+ of requests complete in <500ms (from current ~1-2s average)
- Cold execution (cache miss) improves by 20-30%
- No increase in error rate or data quality issues

---

### Non-Performance Observations

**Security:** Discovery records are filtered by `isDiscoverable` (lines 1063, 1098, 234). Only Published/Reviewed content is indexed. This is correct and prevents unauthorized access.

**Maintainability:** Caching logic is centralized in `getDiscoveryIndexBundle_()`. Adding Script Cache persistence is a localized change with minimal risk to other systems.

**Data Freshness:** Current strategy:
- Bootstrap cache: 30 min TTL
- Results cache: 5 min TTL
- Index rebuild: on versionKey change (any sheet update)

Acceptable for internal discovery tool. If real-time freshness is required, reduce TTLs (at cost of performance).

---

## Next Steps

1. **Filter Discoverability:**
   - Implement button text hint ("More filters (TDP, Sales Tactic, Creator)")
   - Measure beta feedback after change
   - If still problematic, escalate to TDP Quick Filter pills

2. **Performance:**
   - Implement Priority 1 (Script Cache for index bundle)
   - Implement Priority 2 (getValues() optimization)
   - Deploy to dev/staging
   - Monitor performance metrics for 1 week
   - Deploy to production if verified

3. **Testing:**
   - Run existing test suite (`tests/package-3a-regression.test.js`)
   - Add performance benchmarks (log index build time)
   - Verify no regression in data quality

**Total estimated effort:** 8-12 hours (4-6h Priority 1, 2-3h Priority 2, 2-3h testing)

---

## References

**Files analyzed:**
- `discovery_js.html` (client-side UI and caching)
- `DiscoveryWebApp.js` (server-side index building and caching)
- `discovery.html` (filter layout)

**Key functions:**
- `getDiscoveryIndexBundle_()` - Core index builder with in-memory cache
- `getDiscoveryBootstrap()` - Initial page load with Script Cache
- `listDiscoveryPage_()` - Search/filter with results cache
- `prefetchExperienceTypes_()` - Background prefetching
- `browseByExperience()` - Content type filtering (now with toggle support)

**Caching layers:**
- In-memory: `DISCOVERY_RUNTIME_MEMO` (execution-scoped)
- Server: `CacheService.getScriptCache()` (6-hour TTL, 10 MB limit)
- Client: `localStorage` (Bootstrap 30min, Results 5min)
