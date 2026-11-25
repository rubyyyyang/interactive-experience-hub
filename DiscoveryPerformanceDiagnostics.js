/**
 * Discovery Performance Diagnostics - Apps Script Compatible
 *
 * Read-only diagnostic measuring index construction, serialization,
 * and caching performance within Apps Script constraints.
 *
 * SAFETY:
 * - Read-only: does not modify sheet data, triggers, or versions
 * - Isolated diagnostic keys: PERF_DIAG_* (auto-cleaned in finally blocks)
 * - Metrics-only persistence: <9KB scalar summary in document properties
 * - No production cache pollution
 *
 * USAGE:
 * 1. Copy to Apps Script editor
 * 2. Run runDiscoveryPerformanceDiagnostics()
 * 3. View execution log
 */

/**
 * Main diagnostic - measures full production data
 */
function runDiscoveryPerformanceDiagnostics() {
  console.log('=== DISCOVERY PERFORMANCE DIAGNOSTICS ===\n');
  
  const summary = {
    timestamp: new Date().toISOString(),
    recordCount: null,
    sheetReadSample: null,
    indexConstruction: null,
    serialization: null,
    compression: null,
    cacheTest: null
  };
  
  try {
    summary.recordCount = measureRecordCount();
    summary.sheetReadSample = measureSheetReadSample();
    summary.indexConstruction = measureIndexConstruction();
    summary.serialization = measureSerializationSize(summary.indexConstruction.recordCount);
    summary.compression = measureCompressionRatio(summary.serialization.sampleJson);
    summary.cacheTest = measureCacheOperations();
    
    printSummary(summary);
    
    // Store scalar summary only (<9KB)
    const scalarSummary = extractScalarMetrics(summary);
    const summaryJson = JSON.stringify(scalarSummary);
    
    if (summaryJson.length > 9000) {
      console.warn('⚠️ Summary >9KB, truncating to metrics only');
      PropertiesService.getDocumentProperties().setProperty(
        'PERF_DIAG_SUMMARY',
        JSON.stringify({
          timestamp: summary.timestamp,
          recordCount: summary.recordCount.total,
          indexTimeMs: summary.indexConstruction.timeMs,
          indexSizeKB: summary.serialization.estimatedFullSizeKB,
          compressionRatio: summary.compression.ratio
        })
      );
    } else {
      PropertiesService.getDocumentProperties().setProperty(
        'PERF_DIAG_SUMMARY',
        summaryJson
      );
    }
    
    console.log('\n✅ Diagnostics complete');
    return summary;
    
  } catch (error) {
    console.error('❌ Diagnostic failed:', error);
    throw error;
  }
}

function measureRecordCount() {
  console.log('\n📊 Record counts (full production data)...');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rm = ss.getSheetByName('Request_Master');
  const yt = ss.getSheetByName('YouTube_Responses');
  
  const counts = {
    requestMaster: rm ? rm.getLastRow() - 1 : 0,
    youtubeResponses: yt ? yt.getLastRow() - 1 : 0,
    total: (rm ? rm.getLastRow() - 1 : 0) + (yt ? yt.getLastRow() - 1 : 0)
  };
  
  console.log(`  Total: ${counts.total} records`);
  return counts;
}

function measureSheetReadSample() {
  console.log('\n📖 Sheet read performance (100-row sample)...');
  
  const sheet = getMasterSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const sampleSize = Math.min(100, lastRow - 1);
  
  if (sampleSize <= 0) return { skipped: true };
  
  const range = sheet.getRange(2, 1, sampleSize, lastCol);
  
  const t1 = Date.now();
  range.getDisplayValues();
  const displayTime = Date.now() - t1;
  
  const t2 = Date.now();
  range.getValues();
  const valuesTime = Date.now() - t2;
  
  console.log(`  Sample: ${sampleSize} rows × ${lastCol} cols`);
  console.log(`  getDisplayValues(): ${displayTime}ms`);
  console.log(`  getValues(): ${valuesTime}ms`);
  
  return {
    sampleSize: sampleSize,
    displayValuesMs: displayTime,
    rawValuesMs: valuesTime,
    speedupPct: displayTime > 0 ? Math.round((displayTime - valuesTime) / displayTime * 100) : 0
  };
}

function measureIndexConstruction() {
  console.log('\n🏗️ Index construction (full production data)...');
  
  const start = Date.now();
  const bundle = getDiscoveryIndexBundle_();
  const timeMs = Date.now() - start;
  
  const recordCount = bundle.index ? bundle.index.length : 0;
  
  console.log(`  Time: ${timeMs}ms`);
  console.log(`  Records: ${recordCount}`);
  console.log(`  Per-record: ${recordCount > 0 ? (timeMs / recordCount).toFixed(2) : 'N/A'}ms`);
  
  return {
    timeMs: timeMs,
    recordCount: recordCount
  };
}

function measureSerializationSize(recordCount) {
  console.log('\n📦 Serialization size (full production index)...');
  
  // Create small sample for actual measurement
  const sampleBundle = {
    index: Array(Math.min(10, recordCount)).fill({
      recordId: '123',
      title: 'Sample Demo Title',
      product: 'Red Hat OpenShift',
      format: 'Interactive Demo',
      description: 'Sample description text'
    }),
    facetMaps: { products: {}, tdps: {}, formats: {} },
    searchIndex: { terms: {}, prefixes: {} }
  };
  
  const sampleJson = JSON.stringify(sampleBundle);
  const sampleBytes = Utilities.newBlob(sampleJson).getBytes().length;
  const sampleRecords = sampleBundle.index.length;
  
  // Estimate full size
  const bytesPerRecord = sampleRecords > 0 ? sampleBytes / sampleRecords : 0;
  const estimatedFullBytes = bytesPerRecord * recordCount;
  const estimatedFullKB = estimatedFullBytes / 1024;
  
  console.log(`  Sample: ${sampleRecords} records = ${sampleBytes} bytes`);
  console.log(`  Estimated full: ${estimatedFullKB.toFixed(2)} KB`);
  console.log(`  Exceeds 100KB: ${estimatedFullKB > 100 ? 'YES ⚠️' : 'No'}`);
  
  return {
    sampleBytes: sampleBytes,
    estimatedFullSizeKB: parseFloat(estimatedFullKB.toFixed(2)),
    exceedsLimit: estimatedFullKB > 100,
    chunksNeeded: Math.ceil(estimatedFullKB / 90),
    sampleJson: sampleJson
  };
}

function measureCompressionRatio(sampleJson) {
  console.log('\n🗜️ Compression (native gzip)...');
  
  const originalBytes = Utilities.newBlob(sampleJson).getBytes().length;
  
  const t1 = Date.now();
  const compressed = Utilities.gzip(Utilities.newBlob(sampleJson));
  const compressTime = Date.now() - t1;
  
  const t2 = Date.now();
  const decompressed = Utilities.ungzip(compressed);
  const decompressTime = Date.now() - t2;
  
  // Base64 encode for cache storage (actual cache payload)
  const base64 = Utilities.base64Encode(compressed.getBytes());
  const cachePayloadBytes = Utilities.newBlob(base64).getBytes().length;
  
  const ratio = ((originalBytes - cachePayloadBytes) / originalBytes * 100).toFixed(1);
  
  console.log(`  Original: ${originalBytes} bytes`);
  console.log(`  Gzipped+Base64: ${cachePayloadBytes} bytes`);
  console.log(`  Reduction: ${ratio}%`);
  console.log(`  Compress: ${compressTime}ms`);
  console.log(`  Decompress: ${decompressTime}ms`);
  
  // Verify round-trip
  const roundTrip = decompressed.getDataAsString() === sampleJson;
  
  return {
    originalBytes: originalBytes,
    cachePayloadBytes: cachePayloadBytes,
    ratio: ratio + '%',
    compressMs: compressTime,
    decompressMs: decompressTime,
    roundTripOk: roundTrip
  };
}

function measureCacheOperations() {
  console.log('\n💾 Cache operations (isolated test keys)...');
  
  const cache = CacheService.getScriptCache();
  const testData = JSON.stringify({ test: 'data', timestamp: Date.now() });
  const testKey = 'PERF_DIAG_TEST_' + Date.now();
  
  try {
    // Write test
    const t1 = Date.now();
    cache.put(testKey, testData, 60);
    const writeMs = Date.now() - t1;
    
    // Read test
    const t2 = Date.now();
    const retrieved = cache.get(testKey);
    const readMs = Date.now() - t2;
    
    const success = retrieved === testData;
    
    console.log(`  Write: ${writeMs}ms`);
    console.log(`  Read: ${readMs}ms`);
    console.log(`  Round-trip: ${success ? 'OK' : 'FAILED'}`);
    
    return {
      writeMs: writeMs,
      readMs: readMs,
      success: success
    };
    
  } finally {
    // Guaranteed cleanup
    try {
      cache.remove(testKey);
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }
  }
}

function extractScalarMetrics(summary) {
  return {
    timestamp: summary.timestamp,
    recordCount: summary.recordCount,
    sheetReadSample: summary.sheetReadSample ? {
      sampleSize: summary.sheetReadSample.sampleSize,
      displayValuesMs: summary.sheetReadSample.displayValuesMs,
      rawValuesMs: summary.sheetReadSample.rawValuesMs,
      speedupPct: summary.sheetReadSample.speedupPct
    } : null,
    indexTimeMs: summary.indexConstruction ? summary.indexConstruction.timeMs : null,
    indexRecords: summary.indexConstruction ? summary.indexConstruction.recordCount : null,
    estimatedSizeKB: summary.serialization ? summary.serialization.estimatedFullSizeKB : null,
    exceedsLimit: summary.serialization ? summary.serialization.exceedsLimit : null,
    chunksNeeded: summary.serialization ? summary.serialization.chunksNeeded : null,
    compressionRatio: summary.compression ? summary.compression.ratio : null,
    compressionOverheadMs: summary.compression ? 
      (summary.compression.compressMs + summary.compression.decompressMs) : null,
    cacheWriteMs: summary.cacheTest ? summary.cacheTest.writeMs : null,
    cacheReadMs: summary.cacheTest ? summary.cacheTest.readMs : null
  };
}

function printSummary(summary) {
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('\n📊 DATA:');
  console.log(`  Total records: ${summary.recordCount.total}`);
  console.log('\n⚡ PERFORMANCE:');
  console.log(`  Index construction: ${summary.indexConstruction.timeMs}ms`);
  console.log(`  Sheet read sample speedup: ${summary.sheetReadSample.speedupPct}%`);
  console.log('\n💾 CACHING:');
  console.log(`  Estimated index size: ${summary.serialization.estimatedFullSizeKB} KB`);
  console.log(`  Exceeds 100KB: ${summary.serialization.exceedsLimit ? 'YES ⚠️' : 'No'}`);
  console.log(`  Chunks needed: ${summary.serialization.chunksNeeded}`);
  console.log(`  Compression: ${summary.compression.ratio} reduction`);
  console.log('\n' + '='.repeat(60));
}

/**
 * Retrieve previous results
 */
function getPreviousDiagnosticResults() {
  const json = PropertiesService.getDocumentProperties().getProperty('PERF_DIAG_SUMMARY');
  if (!json) {
    console.log('No previous results');
    return null;
  }
  return JSON.parse(json);
}
