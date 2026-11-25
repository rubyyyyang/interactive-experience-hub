/**
 * Discovery Performance Diagnostics
 *
 * Read-only diagnostic functions to measure index construction,
 * serialization, compression, and caching performance.
 *
 * USAGE:
 * 1. Copy this file content into Apps Script editor
 * 2. Run runDiscoveryPerformanceDiagnostics() from Script Editor
 * 3. View results in Execution log (View → Executions)
 *
 * SAFETY:
 * - Read-only: does not modify any sheet data
 * - Uses test cache keys (PERF_TEST_*) to avoid polluting production cache
 * - Can be run multiple times without side effects
 */

/**
 * Main diagnostic function - runs all performance measurements
 */
function runDiscoveryPerformanceDiagnostics() {
  console.log('=== DISCOVERY PERFORMANCE DIAGNOSTICS ===\n');

  const results = {
    timestamp: new Date().toISOString(),
    measurements: {}
  };

  try {
    // 1. Record count
    results.measurements.recordCount = measureRecordCount();

    // 2. Sheet read performance
    results.measurements.sheetRead = measureSheetReadPerformance();

    // 3. Index construction
    results.measurements.indexConstruction = measureIndexConstruction();

    // 4. Serialization
    results.measurements.serialization = measureSerialization(results.measurements.indexConstruction.bundle);

    // 5. Compression (if LZString available)
    if (typeof LZString !== 'undefined') {
      results.measurements.compression = measureCompression(results.measurements.serialization.json);
    } else {
      console.log('⚠️ LZString not available - skipping compression tests');
      results.measurements.compression = { skipped: true, reason: 'LZString not loaded' };
    }

    // 6. Cache operations
    results.measurements.cache = measureCacheOperations(
      results.measurements.serialization.json,
      results.measurements.compression?.compressed
    );

    // 7. Cold vs warm request simulation
    results.measurements.requestLatency = measureRequestLatency();

    // Print summary
    printDiagnosticSummary(results);

    // Store results in document properties for later retrieval
    PropertiesService.getDocumentProperties().setProperty(
      'PERF_DIAGNOSTICS_RESULTS',
      JSON.stringify(results)
    );

    console.log('\n✅ Diagnostics complete. Results saved to document properties.');
    console.log('Retrieve with: PropertiesService.getDocumentProperties().getProperty("PERF_DIAGNOSTICS_RESULTS")');

    return results;

  } catch (error) {
    console.error('❌ Diagnostic failed:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
}

/**
 * Measure record counts from Request_Master and YouTube_Responses
 */
function measureRecordCount() {
  console.log('\n📊 Measuring record counts...');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestMaster = ss.getSheetByName('Request_Master');
  const youtubeResponses = ss.getSheetByName('YouTube_Responses');

  const counts = {
    requestMaster: {
      totalRows: requestMaster ? requestMaster.getLastRow() - 1 : 0, // Exclude header
      totalColumns: requestMaster ? requestMaster.getLastColumn() : 0
    },
    youtubeResponses: {
      totalRows: youtubeResponses ? youtubeResponses.getLastRow() - 1 : 0,
      totalColumns: youtubeResponses ? youtubeResponses.getLastColumn() : 0
    }
  };

  counts.total = counts.requestMaster.totalRows + counts.youtubeResponses.totalRows;

  console.log(`  Request_Master: ${counts.requestMaster.totalRows} rows × ${counts.requestMaster.totalColumns} columns`);
  console.log(`  YouTube_Responses: ${counts.youtubeResponses.totalRows} rows × ${counts.youtubeResponses.totalColumns} columns`);
  console.log(`  Total records: ${counts.total}`);

  return counts;
}

/**
 * Measure sheet read performance (getValues vs getDisplayValues)
 */
function measureSheetReadPerformance() {
  console.log('\n📖 Measuring sheet read performance...');

  const sheet = getMasterSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const rowCount = Math.min(lastRow - 1, 100); // Sample first 100 rows

  if (rowCount <= 0) {
    return { skipped: true, reason: 'No data rows' };
  }

  const range = sheet.getRange(2, 1, rowCount, lastCol);

  // Test getDisplayValues()
  const displayStart = Date.now();
  const displayValues = range.getDisplayValues();
  const displayTime = Date.now() - displayStart;

  // Test getValues()
  const valuesStart = Date.now();
  const rawValues = range.getValues();
  const valuesTime = Date.now() - valuesStart;

  // Test getFormulas() to identify formula-heavy columns
  const formulasStart = Date.now();
  const formulas = range.getFormulas();
  const formulasTime = Date.now() - formulasStart;

  // Count formula cells
  let formulaCount = 0;
  for (let i = 0; i < formulas.length; i++) {
    for (let j = 0; j < formulas[i].length; j++) {
      if (formulas[i][j]) formulaCount++;
    }
  }

  const results = {
    rowCount: rowCount,
    columnCount: lastCol,
    cellCount: rowCount * lastCol,
    displayValuesTime: displayTime,
    rawValuesTime: valuesTime,
    formulasTime: formulasTime,
    formulaCellCount: formulaCount,
    speedup: displayTime > 0 ? ((displayTime - valuesTime) / displayTime * 100).toFixed(1) + '%' : 'N/A'
  };

  console.log(`  Sample size: ${rowCount} rows × ${lastCol} columns = ${results.cellCount} cells`);
  console.log(`  getDisplayValues(): ${displayTime}ms`);
  console.log(`  getValues(): ${valuesTime}ms`);
  console.log(`  getFormulas(): ${formulasTime}ms`);
  console.log(`  Formula cells: ${formulaCount} (${(formulaCount / results.cellCount * 100).toFixed(1)}%)`);
  console.log(`  Potential speedup: ${results.speedup}`);

  return results;
}

/**
 * Measure index construction time
 */
function measureIndexConstruction() {
  console.log('\n🏗️ Measuring index construction...');

  const start = Date.now();

  // Call existing index builder
  const bundle = getDiscoveryIndexBundle_();

  const totalTime = Date.now() - start;

  const results = {
    totalTime: totalTime,
    recordCount: bundle.index ? bundle.index.length : 0,
    facetCount: bundle.facetMaps ? Object.keys(bundle.facetMaps).length : 0,
    searchTermCount: bundle.searchIndex?.terms ? Object.keys(bundle.searchIndex.terms).length : 0,
    bundle: bundle // Keep for downstream tests
  };

  console.log(`  Total time: ${totalTime}ms`);
  console.log(`  Records indexed: ${results.recordCount}`);
  console.log(`  Facet dimensions: ${results.facetCount}`);
  console.log(`  Search terms: ${results.searchTermCount}`);
  console.log(`  Time per record: ${results.recordCount > 0 ? (totalTime / results.recordCount).toFixed(2) : 'N/A'}ms`);

  return results;
}

/**
 * Measure serialization size
 */
function measureSerialization(bundle) {
  console.log('\n📦 Measuring serialization...');

  const start = Date.now();
  const json = JSON.stringify(bundle);
  const serializeTime = Date.now() - start;

  const deserializeStart = Date.now();
  const deserialized = JSON.parse(json);
  const deserializeTime = Date.now() - deserializeStart;

  const sizeBytes = new Blob([json]).size;
  const sizeKB = sizeBytes / 1024;
  const sizeMB = sizeKB / 1024;

  const results = {
    sizeBytes: sizeBytes,
    sizeKB: parseFloat(sizeKB.toFixed(2)),
    sizeMB: parseFloat(sizeMB.toFixed(4)),
    serializeTime: serializeTime,
    deserializeTime: deserializeTime,
    exceedsCacheLimit: sizeBytes > 100000,
    chunksNeeded: Math.ceil(sizeBytes / 90000),
    json: json // Keep for compression test
  };

  console.log(`  Size: ${sizeBytes.toLocaleString()} bytes (${results.sizeKB.toFixed(2)} KB)`);
  console.log(`  Serialization: ${serializeTime}ms`);
  console.log(`  Deserialization: ${deserializeTime}ms`);
  console.log(`  Exceeds 100KB cache limit: ${results.exceedsCacheLimit ? 'YES ⚠️' : 'No'}`);

  if (results.exceedsCacheLimit) {
    console.log(`  Chunks needed (90KB each): ${results.chunksNeeded}`);
  }

  return results;
}

/**
 * Measure compression (requires LZString library)
 */
function measureCompression(json) {
  if (typeof LZString === 'undefined') {
    return { skipped: true, reason: 'LZString not available' };
  }

  console.log('\n🗜️ Measuring compression...');

  const originalSize = new Blob([json]).size;

  // Test compress
  const compressStart = Date.now();
  const compressed = LZString.compress(json);
  const compressTime = Date.now() - compressStart;

  // Test decompress
  const decompressStart = Date.now();
  const decompressed = LZString.decompress(compressed);
  const decompressTime = Date.now() - decompressStart;

  const compressedSize = new Blob([compressed]).size;
  const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

  const results = {
    originalSize: originalSize,
    compressedSize: compressedSize,
    compressionRatio: compressionRatio + '%',
    compressTime: compressTime,
    decompressTime: decompressTime,
    totalOverhead: compressTime + decompressTime,
    exceedsCacheLimit: compressedSize > 100000,
    chunksNeeded: Math.ceil(compressedSize / 90000),
    worthwhile: compressedSize < originalSize * 0.8, // >20% reduction
    compressed: compressed // Keep for cache test
  };

  console.log(`  Original: ${originalSize.toLocaleString()} bytes`);
  console.log(`  Compressed: ${compressedSize.toLocaleString()} bytes`);
  console.log(`  Compression ratio: ${compressionRatio}%`);
  console.log(`  Compress time: ${compressTime}ms`);
  console.log(`  Decompress time: ${decompressTime}ms`);
  console.log(`  Total overhead: ${results.totalOverhead}ms`);
  console.log(`  Exceeds cache limit: ${results.exceedsCacheLimit ? 'YES ⚠️' : 'No'}`);
  console.log(`  Worthwhile: ${results.worthwhile ? 'Yes' : 'No (< 20% reduction)'}`);

  return results;
}

/**
 * Measure cache write/read operations
 */
function measureCacheOperations(json, compressed) {
  console.log('\n💾 Measuring cache operations...');

  const cache = CacheService.getScriptCache();
  const results = {
    raw: {},
    compressed: {},
    chunked: {}
  };

  // Test 1: Raw JSON (if under 100KB)
  if (new Blob([json]).size <= 100000) {
    const writeStart = Date.now();
    cache.put('PERF_TEST_RAW', json, 300);
    results.raw.writeTime = Date.now() - writeStart;

    const readStart = Date.now();
    const retrieved = cache.get('PERF_TEST_RAW');
    results.raw.readTime = Date.now() - readStart;
    results.raw.success = !!retrieved;

    cache.remove('PERF_TEST_RAW'); // Cleanup

    console.log(`  Raw JSON write: ${results.raw.writeTime}ms`);
    console.log(`  Raw JSON read: ${results.raw.readTime}ms`);
    console.log(`  Success: ${results.raw.success ? 'Yes' : 'No'}`);
  } else {
    results.raw.skipped = true;
    results.raw.reason = 'Exceeds 100KB limit';
    console.log(`  Raw JSON: Skipped (exceeds 100KB limit)`);
  }

  // Test 2: Compressed (if available and under 100KB)
  if (compressed && new Blob([compressed]).size <= 100000) {
    const writeStart = Date.now();
    cache.put('PERF_TEST_COMPRESSED', compressed, 300);
    results.compressed.writeTime = Date.now() - writeStart;

    const readStart = Date.now();
    const retrieved = cache.get('PERF_TEST_COMPRESSED');
    results.compressed.readTime = Date.now() - readStart;
    results.compressed.success = !!retrieved;

    cache.remove('PERF_TEST_COMPRESSED'); // Cleanup

    console.log(`  Compressed write: ${results.compressed.writeTime}ms`);
    console.log(`  Compressed read: ${results.compressed.readTime}ms`);
    console.log(`  Success: ${results.compressed.success ? 'Yes' : 'No'}`);
  } else if (compressed) {
    results.compressed.skipped = true;
    results.compressed.reason = 'Exceeds 100KB limit';
    console.log(`  Compressed: Skipped (exceeds 100KB limit)`);
  } else {
    results.compressed.skipped = true;
    results.compressed.reason = 'No compressed data';
  }

  // Test 3: Chunked strategy
  const chunkSize = 90000;
  const chunks = [];
  for (let i = 0; i < json.length; i += chunkSize) {
    chunks.push(json.substring(i, i + chunkSize));
  }

  // Write chunks
  const chunkWriteStart = Date.now();
  cache.put('PERF_TEST_CHUNK_META', JSON.stringify({ count: chunks.length }), 300);
  for (let i = 0; i < chunks.length; i++) {
    cache.put(`PERF_TEST_CHUNK_${i}`, chunks[i], 300);
  }
  results.chunked.writeTime = Date.now() - chunkWriteStart;

  // Read chunks
  const chunkReadStart = Date.now();
  const meta = JSON.parse(cache.get('PERF_TEST_CHUNK_META') || '{}');
  const reconstructed = [];
  for (let i = 0; i < (meta.count || 0); i++) {
    const chunk = cache.get(`PERF_TEST_CHUNK_${i}`);
    if (!chunk) {
      results.chunked.success = false;
      break;
    }
    reconstructed.push(chunk);
  }
  results.chunked.readTime = Date.now() - chunkReadStart;
  results.chunked.success = reconstructed.length === chunks.length;
  results.chunked.chunkCount = chunks.length;

  // Cleanup chunks
  cache.remove('PERF_TEST_CHUNK_META');
  for (let i = 0; i < chunks.length; i++) {
    cache.remove(`PERF_TEST_CHUNK_${i}`);
  }

  console.log(`  Chunked (${chunks.length} chunks):`);
  console.log(`    Write: ${results.chunked.writeTime}ms`);
  console.log(`    Read: ${results.chunked.readTime}ms`);
  console.log(`    Success: ${results.chunked.success ? 'Yes' : 'No'}`);

  return results;
}

/**
 * Measure cold vs warm request latency
 */
function measureRequestLatency() {
  console.log('\n⏱️ Measuring request latency...');

  // Clear in-memory cache
  if (typeof DISCOVERY_RUNTIME_MEMO !== 'undefined') {
    DISCOVERY_RUNTIME_MEMO.versionKey = '';
    DISCOVERY_RUNTIME_MEMO.bundle = null;
  }

  const results = {
    cold: {},
    warm: {}
  };

  // Cold request (rebuild index)
  const coldStart = Date.now();
  const coldResult = listDiscoveryPage_({
    q: '',
    formats: [],
    products: [],
    tdps: [],
    creatorNames: [],
    marketingPrograms: [],
    salesTactics: [],
    page: 1,
    pageSize: 20
  });
  results.cold.latency = Date.now() - coldStart;
  results.cold.recordCount = coldResult?.items?.length || 0;

  console.log(`  Cold request (index rebuild): ${results.cold.latency}ms`);
  console.log(`    Records returned: ${results.cold.recordCount}`);

  // Warm request (cached index)
  const warmStart = Date.now();
  const warmResult = listDiscoveryPage_({
    q: '',
    formats: [],
    products: [],
    tdps: [],
    creatorNames: [],
    marketingPrograms: [],
    salesTactics: [],
    page: 1,
    pageSize: 20
  });
  results.warm.latency = Date.now() - warmStart;
  results.warm.recordCount = warmResult?.items?.length || 0;

  console.log(`  Warm request (in-memory cache): ${results.warm.latency}ms`);
  console.log(`    Records returned: ${results.warm.recordCount}`);
  console.log(`  Speedup: ${results.cold.latency > 0 ? ((results.cold.latency - results.warm.latency) / results.cold.latency * 100).toFixed(1) : 'N/A'}%`);

  // Filtered request
  const filterStart = Date.now();
  const filterResult = listDiscoveryPage_({
    q: 'openshift',
    formats: ['Interactive Demo'],
    products: [],
    tdps: [],
    creatorNames: [],
    marketingPrograms: [],
    salesTactics: [],
    page: 1,
    pageSize: 20
  });
  results.filtered = {
    latency: Date.now() - filterStart,
    recordCount: filterResult?.items?.length || 0
  };

  console.log(`  Filtered request (q="openshift", format="Interactive Demo"): ${results.filtered.latency}ms`);
  console.log(`    Records returned: ${results.filtered.recordCount}`);

  return results;
}

/**
 * Print diagnostic summary
 */
function printDiagnosticSummary(results) {
  console.log('\n' + '='.repeat(60));
  console.log('DIAGNOSTIC SUMMARY');
  console.log('='.repeat(60));

  const m = results.measurements;

  console.log(`\n📊 DATA VOLUME:`);
  console.log(`  Total records: ${m.recordCount?.total || 'N/A'}`);
  console.log(`  Request_Master: ${m.recordCount?.requestMaster?.totalRows || 'N/A'} rows`);
  console.log(`  YouTube_Responses: ${m.recordCount?.youtubeResponses?.totalRows || 'N/A'} rows`);

  console.log(`\n⚡ PERFORMANCE:`);
  console.log(`  Index construction: ${m.indexConstruction?.totalTime || 'N/A'}ms`);
  console.log(`  Sheet read (getDisplayValues): ${m.sheetRead?.displayValuesTime || 'N/A'}ms`);
  console.log(`  Sheet read (getValues): ${m.sheetRead?.rawValuesTime || 'N/A'}ms`);
  console.log(`  Potential speedup: ${m.sheetRead?.speedup || 'N/A'}`);

  console.log(`\n💾 CACHING:`);
  console.log(`  Index size: ${m.serialization?.sizeKB || 'N/A'} KB`);
  console.log(`  Exceeds 100KB limit: ${m.serialization?.exceedsCacheLimit ? 'YES ⚠️' : 'No'}`);
  console.log(`  Chunks needed: ${m.serialization?.chunksNeeded || 1}`);

  if (m.compression && !m.compression.skipped) {
    console.log(`  Compressed size: ${(m.compression.compressedSize / 1024).toFixed(2)} KB`);
    console.log(`  Compression ratio: ${m.compression.compressionRatio}`);
    console.log(`  Compression overhead: ${m.compression.totalOverhead}ms`);
  }

  console.log(`\n🚀 REQUEST LATENCY:`);
  console.log(`  Cold (rebuild): ${m.requestLatency?.cold?.latency || 'N/A'}ms`);
  console.log(`  Warm (cached): ${m.requestLatency?.warm?.latency || 'N/A'}ms`);
  console.log(`  Filtered: ${m.requestLatency?.filtered?.latency || 'N/A'}ms`);

  console.log(`\n💡 RECOMMENDATIONS:`);

  if (m.serialization?.exceedsCacheLimit) {
    console.log(`  ⚠️ Bundle exceeds 100KB - chunking required`);
    console.log(`     Implement ${m.serialization.chunksNeeded}-chunk strategy`);
  } else {
    console.log(`  ✅ Bundle fits in single cache key`);
  }

  if (m.compression && !m.compression.skipped && m.compression.worthwhile) {
    console.log(`  ✅ Compression recommended (${m.compression.compressionRatio} reduction)`);
  } else if (m.compression && !m.compression.skipped) {
    console.log(`  ❌ Compression not worthwhile (<20% reduction)`);
  }

  const coldLatency = m.requestLatency?.cold?.latency || 0;
  const warmLatency = m.requestLatency?.warm?.latency || 0;
  if (coldLatency > warmLatency * 3) {
    console.log(`  ✅ Caching provides ${((coldLatency - warmLatency) / coldLatency * 100).toFixed(0)}% speedup - recommend implementation`);
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Retrieve previous diagnostic results
 */
function getPreviousDiagnosticResults() {
  const json = PropertiesService.getDocumentProperties().getProperty('PERF_DIAGNOSTICS_RESULTS');
  if (!json) {
    console.log('No previous diagnostic results found');
    return null;
  }

  const results = JSON.parse(json);
  console.log('Previous diagnostic run:', results.timestamp);
  printDiagnosticSummary(results);
  return results;
}
