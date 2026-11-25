# Performance Investigation - Feasibility Analysis

## Objective

Evaluate cross-execution index caching feasibility within Google Apps Script and CacheService constraints.

## Investigation Plan

### 1. Measure Index Bundle Size

**Method:** Add instrumentation to `getDiscoveryIndexBundle_()` to measure serialized bundle size in bytes.

**Code to add:**
```javascript
// In getDiscoveryIndexBundle_() after building bundle
const bundleJson = JSON.stringify(bundle);
const bundleSize = new Blob([bundleJson]).size;
console.log(`Index bundle size: ${bundleSize} bytes (${(bundleSize/1024).toFixed(2)} KB)`);
```

**Expected size range:** Unknown - requires measurement with actual production data

**Concerns:**
- CacheService has 100 KB per-key limit
- If bundle > 100 KB, need chunking or compression strategy

---

### 2. Evaluate Compression Overhead

**Apps Script Compression Options:**

Apps Script does NOT have native gzip/deflate support. Available options:

1. **Utilities.base64Encode/Decode** (built-in) - Increases size by ~33%, not helpful
2. **LZString library** (third-party) - JavaScript-based compression
   - Pro: Can achieve 50-70% compression for JSON
   - Con: Adds compression/decompression CPU time
   - Con: Requires bundling external library
3. **Manual optimization:**
   - Remove whitespace from JSON
   - Use short property names
   - Remove redundant data

**Measurement needed:**
- Compression time (ms)
- Decompression time (ms)
- Compressed size vs. raw size
- Compare: is compression overhead < index rebuild time?

**Test approach:**
```javascript
const start = Date.now();
const compressed = LZString.compress(JSON.stringify(bundle));
const compressTime = Date.now() - start;
const compressedSize = new Blob([compressed]).size;

const decompressStart = Date.now();
const decompressed = JSON.parse(LZString.decompress(compressed));
const decompressTime = Date.now() - decompressStart;

console.log(`Compression: ${compressTime}ms, size: ${compressedSize} bytes`);
console.log(`Decompression: ${decompressTime}ms`);
```

---

### 3. CacheService Limits and Eviction

**Known limits:**
- **Per-key limit:** 100 KB (100,000 bytes)
- **Total cache size:** 10 MB per script
- **TTL:** 6 hours maximum
- **Eviction:** LRU (Least Recently Used) when cache is full

**Key questions to verify:**

1. **Do existing cache writes silently fail when exceeding 100 KB?**
   - Method: Check CacheService.getScriptCache().put() return value
   - Hypothesis: Apps Script may silently fail without error
   - Test: Try to cache 150 KB payload, verify retrieval fails

2. **What is current cache usage?**
   - Bootstrap data: Unknown size
   - Filter options: Unknown size
   - List results: Unknown size per entry × 40 max entries
   - Remaining space for index bundle: Unknown

3. **How often is cache evicted under real usage?**
   - Cannot measure without production logging
   - Mitigation: Instrument cache hit/miss rates

**Verification code:**
```javascript
function testCacheLimits() {
  const cache = CacheService.getScriptCache();
  
  // Test 1: Measure current cache usage by key
  const bootstrapSize = (cache.get('bootstrap:...') || '').length;
  console.log(`Bootstrap cache size: ${bootstrapSize} bytes`);
  
  // Test 2: Try to cache 150 KB (over limit)
  const largePayload = JSON.stringify(Array(150000).fill('x'));
  cache.put('test_large', largePayload, 300);
  const retrieved = cache.get('test_large');
  console.log(`Large cache write ${retrieved ? 'succeeded' : 'FAILED'}`);
  
  // Test 3: Chunk strategy - split into 50 KB chunks
  const chunks = chunkString(largePayload, 50000);
  chunks.forEach((chunk, i) => cache.put(`test_chunk_${i}`, chunk, 300));
  const reconstructed = chunks.map((_, i) => cache.get(`test_chunk_${i}`)).join('');
  console.log(`Chunked cache ${reconstructed === largePayload ? 'succeeded' : 'FAILED'}`);
}

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.substring(i, i + size));
  }
  return chunks;
}
```

---

### 4. Duplicate Index Rebuilds During Concurrent Requests

**Hypothesis:** Background prefetching may trigger multiple concurrent index rebuilds.

**Code analysis:**

Current prefetching code (discovery_js.html lines 609-649):
```javascript
prefetchExperienceTypes_() {
  const typesToPrefetch = ['Interactive Demo', 'Video Demo', 'YouTube'];
  typesToPrefetch.forEach((type, index) => {
    setTimeout(() => {
      google.script.run
        .withSuccessHandler(...)
        .listDiscoveryPage(filters);
    }, 500 + (index * 300));
  });
}
```

**Problem:**
- Prefetch fires 3 requests within 1.4 seconds
- Each request may spawn new Apps Script execution
- Each new execution has empty `DISCOVERY_RUNTIME_MEMO`
- Result: 3 index rebuilds for prefetch alone

**Measurement needed:**
- Log index rebuild count per execution
- Track whether prefetch hits cache vs. triggers rebuild
- Measure: does prefetch benefit outweigh rebuild cost?

**Instrumentation:**
```javascript
let INDEX_REBUILD_COUNT = 0;

function getDiscoveryIndexBundle_() {
  // ... existing checks ...
  
  if (needsRebuild) {
    INDEX_REBUILD_COUNT++;
    console.log(`Index rebuild #${INDEX_REBUILD_COUNT} in this execution`);
  }
  
  // ... build bundle ...
}
```

**Expected findings:**
- Without Script Cache: 1 rebuild per new execution = 3-4 rebuilds for prefetch
- With Script Cache: 0-1 rebuilds (only if cache miss)

---

### 5. Version-Based Invalidation - CORRECTED ANALYSIS

**Existing implementation in `RM_Triggers.js` (lines 84-160):**

The `handleSpreadsheetEdit()` installable trigger ALREADY calls `bumpDiscoveryDataVersion_()` on line 131 for Request_Master single-cell edits.

**Current behavior:**

```javascript
function handleSpreadsheetEdit(event) {
  // For Request_Master (lines 97-133)
  if (sheetName === masterSheetName) {
    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
      console.log("Ignoring multi-cell edit to prevent trigger storms");
      return; // ⚠️ DOES NOT bump version for multi-cell edits
    }
    
    // ... process single-cell edit ...
    bumpDiscoveryDataVersion_(); // ✅ Bumps version for single-cell edits
    return;
  }
  
  // For YouTube_Responses (lines 136-148)
  if (sheetName === 'YouTube_Responses') {
    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
      console.log("Ignoring multi-cell edit to prevent trigger storms");
      return; // ⚠️ DOES NOT bump version for multi-cell edits
    }
    
    processYouTubeStatusEdit(event, sheet);
    return; // ⚠️ DOES NOT bump version for ANY YouTube edits
  }
}
```

**Invalidation scenarios - CORRECTED:**

| Scenario | versionKey changes? | Cache invalidated? | Status |
|----------|-------------------|-------------------|--------|
| **Request_Master single-cell edit** | ✅ Yes (version bumped line 131) | ✅ Yes | ✅ **Working** |
| **Request_Master multi-cell edit** | ❌ No (early return line 103-105) | ❌ No | ⚠️ **Gap #1** |
| Request_Master row add/delete | ✅ Yes (lastRow changes) | ✅ Yes | ✅ Working |
| Request_Master column add/delete | ✅ Yes (lastColumn changes) | ✅ Yes | ✅ Working |
| **YouTube_Responses single-cell edit** | ❌ No (no bump call) | ❌ No | ⚠️ **Gap #2** |
| **YouTube_Responses multi-cell edit** | ❌ No (early return line 142-144) | ❌ No | ⚠️ **Gap #3** |
| YouTube_Responses row add/delete | ✅ Yes (ytRows changes) | ✅ Yes | ✅ Working |
| **Programmatic writes (Intake, workflows)** | ❌ No (triggers don't fire) | ❌ No | ⚠️ **Gap #4** |
| **Greg's batch update (overwrites cells)** | ❌ No (programmatic write) | ❌ No | ⚠️ **Gap #5** |
| Manual `forceInvalidateDiscoveryCache()` | ✅ Yes (version bumped) | ✅ Yes | ✅ Working |

**Confirmed gaps:**

1. **Request_Master multi-cell edits** - Trigger ignores to prevent storms, no version bump
2. **YouTube_Responses single-cell edits** - Processed but no version bump
3. **YouTube_Responses multi-cell edits** - Trigger ignores, no version bump
4. **Programmatic writes** - Apps Script triggers don't fire for `setValue()` calls from scripts
5. **Greg's batch update** - Programmatic overwrite, no trigger fired

**Client-side cache investigation:**

Client uses `localStorage` with 30-min TTL (discovery_js.html lines 1324-1377):

```javascript
const BOOTSTRAP_CACHE_KEY = 'discovery_bootstrap_cache';
const BOOTSTRAP_CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutes

function getCachedBootstrap_() {
  const raw = localStorage.getItem(BOOTSTRAP_CACHE_KEY);
  const cached = JSON.parse(raw);
  if (Date.now() - (cached._ts || 0) > BOOTSTRAP_CACHE_MAX_AGE) {
    localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
    return null; // ✅ Expires after 30 min
  }
  return cached;
}
```

**Does client cache respect backend version changes?**

❌ **No - client localStorage is TTL-only, NOT version-aware**

Client cache remains valid for 30 minutes regardless of backend DISCOVERY_DATA_VERSION changes. User could see stale data for up to 30 minutes after backend update.

**Mitigation:** Background refresh updates cache without blocking user (line 1424-1447), but user may still see stale data initially.

---

**Smallest proposed fixes:**

**Fix #1: Add version bump for YouTube_Responses edits**

In `RM_Triggers.js`, line 147 (after `processYouTubeStatusEdit`):

```javascript
// Handle YouTube_Responses
if (sheetName === 'YouTube_Responses') {
  if (range.getRow() <= 1) return;
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
    console.log("Ignoring multi-cell edit to prevent trigger storms");
    return;
  }
  
  processYouTubeStatusEdit(event, sheet);
  bumpDiscoveryDataVersion_(); // ← ADD THIS LINE
  return;
}
```

**Fix #2: Bump version for multi-cell edits (selective)**

Replace early return with selective version bump:

```javascript
// For Request_Master
if (sheetName === masterSheetName) {
  if (range.getRow() <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return;
  
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
    console.log("Multi-cell edit detected - bumping discovery version only");
    bumpDiscoveryDataVersion_(); // ← Bump but skip detailed processing
    return;
  }
  
  // ... continue with single-cell processing ...
}
```

**Fix #3: Document programmatic write invalidation**

Programmatic writes (Intake submissions, Greg's batch, lifecycle workflows) CANNOT be detected by triggers.

**Recommendation:** Document manual invalidation procedure:

```javascript
// In any script that performs bulk data updates:
function afterBulkUpdate() {
  // ... write data to Request_Master ...
  
  // Invalidate discovery cache
  if (typeof bumpDiscoveryDataVersion_ === 'function') {
    bumpDiscoveryDataVersion_();
  }
}
```

**Locations to add manual invalidation:**
- `RM_CreatorIntake.js` - After writing Intake submission to Request_Master
- `RM_Workflow.js` - After status/link updates
- `RM_Datasync.js` - After Greg's batch refresh
- Any other script that calls `sheet.getRange().setValue()`

**Fix #4: Client-side version-aware caching (optional, more complex)**

Add version check to client cache:

```javascript
function getCachedBootstrap_() {
  const raw = localStorage.getItem(BOOTSTRAP_CACHE_KEY);
  const cached = JSON.parse(raw);
  
  // Check both TTL and version
  if (Date.now() - (cached._ts || 0) > BOOTSTRAP_CACHE_MAX_AGE) {
    return null;
  }
  
  // Fetch current version from server (requires new endpoint)
  google.script.run
    .withSuccessHandler((serverVersion) => {
      if (cached.version !== serverVersion) {
        localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
        // Trigger refresh
      }
    })
    .getDiscoveryDataVersion();
  
  return cached;
}
```

**Trade-off:** Adds server roundtrip on every page load, defeats purpose of cache.

**Better alternative:** Keep TTL-only cache, accept 30-min staleness window as reasonable for internal tool.

---

**Summary of confirmed gaps:**

| Gap | Impact | Proposed Fix | Priority |
|-----|--------|--------------|----------|
| YouTube_Responses edits | Medium - YouTube data stale until row add/delete | Add `bumpDiscoveryDataVersion_()` after line 147 | High |
| Request_Master multi-cell edits | Low - rare user action | Bump version on multi-cell edit | Medium |
| YouTube_Responses multi-cell edits | Low - rare user action | Bump version on multi-cell edit | Medium |
| Programmatic writes | High - Greg's batch, Intake, workflows | Add manual bump in each script | High |
| Client localStorage | Medium - 30 min stale window | Accept as-is OR add version check | Low |

**Recommendation:** Implement Fix #1 (YouTube bump) and Fix #3 (document manual invalidation) as smallest, safest improvements.

---

### 6. Compare Caching Strategies

**Strategy A: Full Index Bundle in Script Cache**

| Aspect | Details |
|--------|---------|
| **What to cache** | Full bundle: index array, facet maps, record map, search index |
| **Cache key** | `index_bundle:{versionKey}` |
| **Size estimate** | Unknown - needs measurement, likely 100-500 KB |
| **Chunk strategy** | If >100 KB: split into N chunks, store with `index_chunk_0:{versionKey}`, etc. |
| **Retrieval time** | 50-200ms (deserialize JSON + reconstruct from chunks) |
| **Rebuild time** | 1-3 seconds (Sheets read + index build) |
| **Benefit** | Avoids Sheets read on cache hit |
| **Risk** | Cache eviction under heavy usage, chunking complexity |

**Strategy B: Precomputed Snapshot (Lightweight)**

| Aspect | Details |
|--------|---------|
| **What to cache** | Minimal snapshot: just sorted record IDs + facet counts |
| **Cache key** | `snapshot:{versionKey}` |
| **Size estimate** | ~10-50 KB (much smaller than full bundle) |
| **Retrieval time** | 10-50ms (smaller payload) |
| **Rebuild time** | Still requires Sheets read to build full records (500ms-1s) |
| **Benefit** | Fits in single cache key, lower eviction risk |
| **Trade-off** | Partial benefit - still reads Sheets for record details |

**Strategy C: Hybrid (Best of Both)**

| Aspect | Details |
|--------|---------|
| **Layer 1** | In-memory DISCOVERY_RUNTIME_MEMO (current, 0ms) |
| **Layer 2** | Script Cache for facet maps + search index (~20-50 KB) |
| **Layer 3** | Always read Sheets for record data (1-2s) |
| **Benefit** | Caches expensive search structures, keeps records fresh |
| **Trade-off** | Doesn't eliminate Sheets read, but makes searches faster |

**Recommendation:** Start with Strategy C (Hybrid) as safest incremental improvement.

---

### 7. Failure Recovery and Concurrency

**Cache write failures:**

Apps Script CacheService.put() does NOT throw errors on failure. Need to verify success:

```javascript
function putScriptCacheJson_(key, value, ttl) {
  try {
    const json = JSON.stringify(value);
    const cache = CacheService.getScriptCache();
    cache.put(key, json, ttl);
    
    // Verify write succeeded
    const retrieved = cache.get(key);
    if (!retrieved) {
      console.warn(`Cache write failed for key: ${key}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Cache error: ${e}`);
    return false;
  }
}
```

**Concurrency issues:**

Multiple Apps Script executions may try to rebuild index simultaneously:

1. User A requests page → Execution 1 starts index rebuild
2. User B requests page (concurrent) → Execution 2 starts index rebuild
3. Both read Sheets independently (double CPU cost)
4. Both write to Script Cache (race condition, last write wins)

**Mitigation:**
- Script Cache is atomic per-key (last write wins, no corruption)
- Duplicate rebuilds are wasteful but not incorrect
- Cannot prevent with locking (Apps Script has no cross-execution locks)
- Acceptable trade-off: waste CPU occasionally vs. always rebuild

**Lock-free optimization:**
```javascript
// Before rebuilding, check if cache was populated by another execution
const bundleJson = getScriptCacheJson_(cacheKey);
if (bundleJson) {
  // Another execution just populated cache, use it
  return bundleJson;
}

// Still need rebuild, proceed
```

---

## Summary of Investigation Requirements

### Measurements Needed (Requires Deployment)

1. ✅ **Index bundle size** - Add logging to production
2. ✅ **Compression overhead** - Test with LZString library
3. ✅ **Cache write success rate** - Verify 100 KB limit behavior
4. ✅ **Concurrent rebuild frequency** - Log rebuild count per execution
5. ✅ **Actual latency improvement** - Measure cache hit vs. miss times

### Verification Needed (Can Do Locally)

1. ✅ **Version invalidation gaps** - Identified: cell edits don't bump version
2. ✅ **Cache chunking strategy** - Design if bundle >100 KB
3. ✅ **Failure recovery** - Verify cache write success, fallback on failure

### Recommended Next Steps

1. **Measure first:** Deploy instrumentation to log bundle size, rebuild count, cache hit rate
2. **Analyze data:** Confirm bundle size, identify actual bottlenecks
3. **Choose strategy:** Based on measurements, pick full bundle vs. hybrid vs. snapshot
4. **Fix invalidation:** Add onEdit trigger to bump version on cell edits
5. **Implement incrementally:** Start with safest strategy (hybrid or snapshot)

---

## Instrumentation Code

### Add to DiscoveryWebApp.js

```javascript
// Global counters for this execution
var PERF_INDEX_REBUILD_COUNT = 0;
var PERF_CACHE_HIT_COUNT = 0;
var PERF_CACHE_MISS_COUNT = 0;

function getDiscoveryIndexBundle_() {
  const sh = getMasterSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow <= DISCOVERY_WEBAPP_CONFIG.HEADER_ROW) {
    return { /* empty bundle */ };
  }

  const versionKey = getDiscoverySheetVersion_(sh);
  
  // Check in-memory cache
  if (DISCOVERY_RUNTIME_MEMO.versionKey === versionKey && DISCOVERY_RUNTIME_MEMO.bundle) {
    console.log('[PERF] In-memory cache HIT');
    return DISCOVERY_RUNTIME_MEMO.bundle;
  }

  // Check Script Cache (NEW)
  const cacheKey = "index_bundle:" + versionKey;
  const startCacheRead = Date.now();
  const cached = getScriptCacheJson_(cacheKey);
  const cacheReadTime = Date.now() - startCacheRead;
  
  if (cached) {
    PERF_CACHE_HIT_COUNT++;
    console.log(`[PERF] Script Cache HIT - read in ${cacheReadTime}ms`);
    DISCOVERY_RUNTIME_MEMO.versionKey = versionKey;
    DISCOVERY_RUNTIME_MEMO.bundle = cached;
    return cached;
  }

  PERF_CACHE_MISS_COUNT++;
  PERF_INDEX_REBUILD_COUNT++;
  console.log('[PERF] Cache MISS - rebuilding index from Sheets');
  
  // Rebuild from Sheets (slow path)
  const startRebuild = Date.now();
  const bundle = buildIndexBundleFromSheets_(); // Extract to separate function
  const rebuildTime = Date.now() - startRebuild;
  
  // Measure bundle size
  const bundleJson = JSON.stringify(bundle);
  const bundleSize = bundleJson.length; // Characters = bytes for ASCII JSON
  console.log(`[PERF] Index rebuilt in ${rebuildTime}ms, size: ${bundleSize} bytes (${(bundleSize/1024).toFixed(2)} KB)`);
  
  // Store in caches
  DISCOVERY_RUNTIME_MEMO.versionKey = versionKey;
  DISCOVERY_RUNTIME_MEMO.bundle = bundle;
  
  // Try to store in Script Cache
  const startCacheWrite = Date.now();
  const writeSuccess = putScriptCacheJson_(cacheKey, bundle, DISCOVERY_WEBAPP_CONFIG.INDEX_CACHE_SECONDS);
  const cacheWriteTime = Date.now() - startCacheWrite;
  
  if (writeSuccess) {
    console.log(`[PERF] Script Cache write succeeded in ${cacheWriteTime}ms`);
  } else {
    console.warn(`[PERF] Script Cache write FAILED (likely >100KB or cache full)`);
  }
  
  return bundle;
}

function buildIndexBundleFromSheets_() {
  // Move existing index-building code here (lines 1016-1130)
  // ... (unchanged from current implementation)
}

// Enhanced cache write with size check
function putScriptCacheJson_(key, value, ttl) {
  try {
    const json = JSON.stringify(value);
    const size = json.length;
    
    if (size > 100000) {
      console.warn(`[PERF] Payload too large for single key: ${size} bytes - chunking required`);
      return putScriptCacheJsonChunked_(key, value, ttl);
    }
    
    const cache = CacheService.getScriptCache();
    cache.put(key, json, ttl);
    
    // Verify write
    const retrieved = cache.get(key);
    return !!retrieved;
  } catch (e) {
    console.error(`[PERF] Cache write error: ${e}`);
    return false;
  }
}

function putScriptCacheJsonChunked_(key, value, ttl) {
  try {
    const json = JSON.stringify(value);
    const chunkSize = 90000; // Leave buffer under 100 KB limit
    const chunks = [];
    
    for (let i = 0; i < json.length; i += chunkSize) {
      chunks.push(json.substring(i, i + chunkSize));
    }
    
    const cache = CacheService.getScriptCache();
    const metadata = { chunkCount: chunks.length };
    cache.put(key + ':meta', JSON.stringify(metadata), ttl);
    
    for (let i = 0; i < chunks.length; i++) {
      cache.put(key + ':chunk:' + i, chunks[i], ttl);
    }
    
    console.log(`[PERF] Wrote ${chunks.length} chunks for key: ${key}`);
    return true;
  } catch (e) {
    console.error(`[PERF] Chunked cache write error: ${e}`);
    return false;
  }
}

function getScriptCacheJson_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const direct = cache.get(key);
    
    if (direct) {
      return JSON.parse(direct);
    }
    
    // Try chunked read
    const metaJson = cache.get(key + ':meta');
    if (!metaJson) return null;
    
    const metadata = JSON.parse(metaJson);
    const chunks = [];
    
    for (let i = 0; i < metadata.chunkCount; i++) {
      const chunk = cache.get(key + ':chunk:' + i);
      if (!chunk) {
        console.warn(`[PERF] Missing chunk ${i} for key: ${key}`);
        return null;
      }
      chunks.push(chunk);
    }
    
    const reconstructed = chunks.join('');
    console.log(`[PERF] Reconstructed ${chunks.length} chunks for key: ${key}`);
    return JSON.parse(reconstructed);
  } catch (e) {
    console.error(`[PERF] Cache read error: ${e}`);
    return null;
  }
}

// Log performance summary at end of execution
function logPerformanceSummary() {
  console.log(`[PERF] Execution summary: ${PERF_INDEX_REBUILD_COUNT} rebuilds, ${PERF_CACHE_HIT_COUNT} cache hits, ${PERF_CACHE_MISS_COUNT} cache misses`);
}

// Call at end of doGet()
function doGet(e) {
  // ... existing code ...
  const result = template.evaluate()...;
  logPerformanceSummary();
  return result;
}
```

---

## Executable Performance Diagnostics

### Local Tests (No Deployment Required)

**Static code analysis completed:**
- ✅ Cache invalidation gaps identified and documented
- ✅ Trigger behavior analyzed against existing implementation
- ✅ Client-side cache TTL vs. version-awareness verified

### Runtime Measurements (Deployment Required)

**Diagnostic function:** `DiscoveryPerformanceDiagnostics.js`

This read-only diagnostic measures:
- Record count (Request_Master + YouTube_Responses)
- Sheet read performance (getDisplayValues vs. getValues)
- Index construction time
- Serialized index size (bytes, KB, MB)
- Compression ratio and overhead (if LZString available)
- Cache write/read success and timing
- Cold vs. warm request latency

**Execution Instructions:**

### Step 1: Deploy Diagnostic Code

```bash
# From repository root
cd /Users/rubyyang/Arcade\ Finder

# Copy diagnostic code to Apps Script project
# (Manual step - copy content of DiscoveryPerformanceDiagnostics.js)
```

In Apps Script editor:
1. Open project in Apps Script editor
2. Create new script file: `DiscoveryPerformanceDiagnostics.js`
3. Paste entire content from local file
4. Save (Ctrl/Cmd + S)

### Step 2: Run Diagnostics

In Apps Script editor:
1. Select function: `runDiscoveryPerformanceDiagnostics`
2. Click Run (▶️)
3. Grant permissions if prompted (read-only access to Sheets and Cache)
4. Wait for execution to complete (~10-30 seconds depending on data size)

### Step 3: View Results

**Option A: Execution Log (Real-time)**

1. Go to View → Executions
2. Click most recent execution
3. View detailed logs with measurements

**Option B: Stored Results (Retrievable Later)**

In Apps Script editor:
1. Run function: `getPreviousDiagnosticResults`
2. View formatted summary in log

**Option C: Raw JSON (For Analysis)**

```javascript
// In Apps Script editor console
const json = PropertiesService.getDocumentProperties().getProperty('PERF_DIAGNOSTICS_RESULTS');
console.log(JSON.parse(json));
```

### Step 4: Collect Measurements

**Expected output format:**

```
=== DISCOVERY PERFORMANCE DIAGNOSTICS ===

📊 Measuring record counts...
  Request_Master: 523 rows × 48 columns
  YouTube_Responses: 87 rows × 32 columns
  Total records: 610

📖 Measuring sheet read performance...
  Sample size: 100 rows × 48 columns = 4800 cells
  getDisplayValues(): 1247ms
  getValues(): 1053ms
  getFormulas(): 892ms
  Formula cells: 1203 (25.1%)
  Potential speedup: 15.5%

🏗️ Measuring index construction...
  Total time: 2341ms
  Records indexed: 587
  Facet dimensions: 7
  Search terms: 1842
  Time per record: 3.99ms

📦 Measuring serialization...
  Size: 324,581 bytes (316.97 KB)
  Serialization: 47ms
  Deserialization: 31ms
  Exceeds 100KB cache limit: YES ⚠️
  Chunks needed (90KB each): 4

🗜️ Measuring compression...
  Original: 324,581 bytes
  Compressed: 142,039 bytes
  Compression ratio: 56.2%
  Compress time: 234ms
  Decompress time: 187ms
  Total overhead: 421ms
  Exceeds cache limit: YES ⚠️
  Worthwhile: Yes

💾 Measuring cache operations...
  Raw JSON: Skipped (exceeds 100KB limit)
  Compressed: Skipped (exceeds 100KB limit)
  Chunked (4 chunks):
    Write: 123ms
    Read: 89ms
    Success: Yes

⏱️ Measuring request latency...
  Cold request (index rebuild): 2456ms
    Records returned: 20
  Warm request (in-memory cache): 42ms
    Records returned: 20
  Speedup: 98.3%
  Filtered request (q="openshift", format="Interactive Demo"): 67ms
    Records returned: 15

============================================================
DIAGNOSTIC SUMMARY
============================================================

📊 DATA VOLUME:
  Total records: 610
  Request_Master: 523 rows
  YouTube_Responses: 87 rows

⚡ PERFORMANCE:
  Index construction: 2341ms
  Sheet read (getDisplayValues): 1247ms
  Sheet read (getValues): 1053ms
  Potential speedup: 15.5%

💾 CACHING:
  Index size: 316.97 KB
  Exceeds 100KB limit: YES ⚠️
  Chunks needed: 4
  Compressed size: 138.71 KB
  Compression ratio: 56.2%
  Compression overhead: 421ms

🚀 REQUEST LATENCY:
  Cold (rebuild): 2456ms
  Warm (cached): 42ms
  Filtered: 67ms

💡 RECOMMENDATIONS:
  ⚠️ Bundle exceeds 100KB - chunking required
     Implement 4-chunk strategy
  ✅ Compression recommended (56.2% reduction)
  ✅ Caching provides 98% speedup - recommend implementation

============================================================
```

### Step 5: Interpret Results

Based on measurements, choose implementation strategy:

**Decision Matrix:**

| Measurement | Threshold | Action |
|-------------|-----------|--------|
| Index size | <100 KB | Single-key cache strategy |
| Index size | 100-200 KB | Chunked cache strategy (2-3 chunks) |
| Index size | 200-400 KB | Chunked + compressed strategy |
| Index size | >400 KB | Hybrid strategy (facets only) OR accept performance trade-off |
| Compression ratio | >30% AND overhead <500ms | Use compression |
| Compression ratio | <30% OR overhead >1000ms | Skip compression |
| getValues speedup | >20% | Switch from getDisplayValues |
| getValues speedup | <20% | Keep getDisplayValues (data compatibility) |
| Warm speedup | >80% | High-priority implementation |
| Warm speedup | 50-80% | Medium-priority implementation |
| Warm speedup | <50% | Low-priority, investigate other bottlenecks |

### Step 6: Document Findings

Create `PERFORMANCE_RESULTS.md` with:
1. Copy-paste diagnostic summary output
2. Chosen implementation strategy with rationale
3. Expected improvement estimates
4. Implementation plan and risk assessment

### Safety Notes

- ✅ Diagnostic is read-only (no data modification)
- ✅ Uses isolated test cache keys (`PERF_TEST_*`)
- ✅ Cleans up test cache entries after measurements
- ✅ Can be run multiple times without side effects
- ✅ Results stored in document properties (retrievable later)

### Troubleshooting

**"ReferenceError: getMasterSheet_ is not defined"**
- Ensure diagnostic code is in same Apps Script project as DiscoveryWebApp.js
- Run from Apps Script editor, not standalone

**"ReferenceError: LZString is not defined"**
- Compression tests will be skipped automatically
- To test compression: add LZString library to Apps Script project
- Library ID: `1Yo6vQRwkG7-tvPZKdJwY8OiOYvF0SRL6VhY8SYi1N6KBw7drlaHNmbLF`

**Cache write failures:**
- Expected if bundle >100 KB
- Diagnostic will report failure and recommend chunking
- Not an error, just confirms need for chunking strategy

---

## Conclusion

**Static analysis findings:**
- ✅ Identified cache invalidation gaps (cell edits don't bump version)
- ✅ Designed chunking strategy for >100 KB payloads
- ✅ Identified concurrent rebuild risk during prefetch
- ✅ Designed failure recovery for cache writes

**Requires deployment to measure:**
- ⏸️ Actual index bundle size
- ⏸️ Cache hit/miss latency
- ⏸️ Compression overhead
- ⏸️ Cache eviction rate under real usage

**Recommended design** (pending measurements):
- **If bundle <100 KB:** Full bundle in Script Cache (Strategy A)
- **If bundle >100 KB:** Chunked storage with metadata key
- **Fix invalidation:** Add onEdit trigger to bump version
- **Fallback:** Always works without cache (graceful degradation)

**Do NOT implement yet** - return measurements first for review.
