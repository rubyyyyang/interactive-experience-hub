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

### 5. Version-Based Invalidation Verification

**Current versionKey composition:**
```javascript
function getDiscoverySheetVersion_(sheet) {
  const props = PropertiesService.getDocumentProperties();
  const version = props.getProperty("DISCOVERY_DATA_VERSION") || "1";
  var ytRows = 0;
  try {
    var yt = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("YouTube_Responses");
    if (yt) ytRows = yt.getLastRow();
  } catch (_) {}
  return [
    DISCOVERY_CACHE_SCHEMA_VERSION,  // Constant: 3
    sheet.getSheetId(),               // Sheet ID (constant for Request_Master)
    sheet.getLastRow(),               // Changes on row add/delete
    sheet.getLastColumn(),            // Changes on column add/delete
    version,                          // Manual bump via bumpDiscoveryDataVersion_()
    ytRows                            // Changes when YouTube rows added
  ].join(":");
}
```

**Invalidation scenarios to verify:**

| Scenario | versionKey changes? | Cache invalidated? | Correct? |
|----------|-------------------|-------------------|----------|
| Edit existing Request_Master cell | ❌ No (lastRow/lastColumn unchanged) | ❌ No | ⚠️ **Stale cache** |
| Add row to Request_Master | ✅ Yes (lastRow increments) | ✅ Yes | ✅ Correct |
| Delete row from Request_Master | ✅ Yes (lastRow decrements) | ✅ Yes | ✅ Correct |
| Add column to Request_Master | ✅ Yes (lastColumn increments) | ✅ Yes | ✅ Correct |
| Edit existing YouTube_Responses cell | ❌ No (ytRows unchanged) | ❌ No | ⚠️ **Stale cache** |
| Add row to YouTube_Responses | ✅ Yes (ytRows increments) | ✅ Yes | ✅ Correct |
| Manual `forceInvalidateDiscoveryCache()` | ✅ Yes (version bumped) | ✅ Yes | ✅ Correct |
| Greg's batch update (overwrites cells) | ❌ No (row count unchanged) | ❌ No | ⚠️ **Stale cache** |

**Critical finding:** **Editing existing cells does NOT invalidate cache.**

**Impact:**
- User edits title/description/status → cache remains stale
- Greg's batch refresh (overwrites existing rows) → cache remains stale
- Cache stays stale until next row add/delete OR manual invalidation

**Solutions:**

1. **Monitor lastEdit timestamp** (not available in Apps Script without Apps Script Advanced Services)
2. **Lower TTL** (e.g., 5 minutes instead of 30 minutes) - accepts staleness window
3. **Trigger-based invalidation** - Add onEdit trigger to bump version
4. **Manual invalidation workflow** - Document when to call `forceInvalidateDiscoveryCache()`

**Recommendation:** Add onEdit trigger to bump DISCOVERY_DATA_VERSION on Request_Master or YouTube_Responses edits.

**Code to add to RM_Triggers.js:**
```javascript
function onEditDiscoveryInvalidation(e) {
  if (!e) return;
  const sheetName = e.source.getActiveSheet().getName();
  if (sheetName === 'Request_Master' || sheetName === 'YouTube_Responses') {
    // Only bump on actual cell edits, not formula recalculations
    if (e.changeType === 'EDIT' || e.changeType === 'INSERT_ROW' || e.changeType === 'REMOVE_ROW') {
      bumpDiscoveryDataVersion_();
    }
  }
}
```

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

## Deployment Verification Procedure

Since deployment access is required for measurements:

1. **Add instrumentation code** to DiscoveryWebApp.js
2. **Deploy to dev/test environment** via `clasp push --dev`
3. **Run test scenarios:**
   - Cold start: Clear cache, load Discovery page → measure rebuild time + bundle size
   - Warm cache: Reload page → measure cache hit time
   - Concurrent: Open 3 tabs simultaneously → count rebuilds
   - Prefetch: Monitor console for prefetch rebuild count
4. **Collect logs** from Apps Script execution logs (View → Executions)
5. **Analyze findings:**
   - If bundle <100 KB: proceed with full bundle caching
   - If bundle >100 KB: implement chunking strategy
   - If compression beneficial (time saved > compression overhead): add LZString
6. **Report measurements** in PERFORMANCE_RESULTS.md

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
