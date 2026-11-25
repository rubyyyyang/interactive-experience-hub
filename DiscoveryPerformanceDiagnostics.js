/**
 * Discovery Performance Diagnostics - Apps Script Compatible
 *
 * Measures actual index construction, serialization, compression, and caching
 * performance using real production data in execution memory.
 *
 * SAFETY:
 * - Read-only: does not modify sheet data, triggers, or versions
 * - Isolated diagnostic keys: PERF_DIAG_* (auto-cleaned in finally blocks)
 * - Metrics-only persistence: <9KB scalar summary in document properties
 * - Reuses actual bundle in memory (not persisted)
 * - Accounts for DISCOVERY_DIRTY cache side effect from index builder
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
  console.log('⚠️ Note: Index builder sets DISCOVERY_DIRTY cache flag as side effect\n');

  const summary = {
    timestamp: new Date().toISOString(),
    recordCount: null,
    sheetRead: null,
    indexConstruction: null,
    serialization: null,
    compression: null,
    cacheTest: null
  };

  try {
    summary.recordCount = measureRecordCount();
    summary.sheetRead = measureSheetRead();

    // Build actual index once, keep in memory for all measurements
    const indexResult = measureIndexConstruction();
    summary.indexConstruction = {
      timeMs: indexResult.timeMs,
      recordCount: indexResult.recordCount
    };

    // Reuse actual bundle for serialization and compression measurements
    summary.serialization = measureSerialization(indexResult.bundle);
    summary.compression = measureCompression(indexResult.serializedJson);
    summary.cacheTest = measureCacheRoundTrip(indexResult.compressedPayload);

    printSummary(summary);

    // Store scalar summary only (<9KB)
    const scalarSummary = extractScalarMetrics(summary);
    const summaryJson = JSON.stringify(scalarSummary);

    if (summaryJson.length > 9000) {
      console.warn('⚠️ Summary >9KB, truncating to core metrics only');
      PropertiesService.getDocumentProperties().setProperty(
        'PERF_DIAG_SUMMARY',
        JSON.stringify({
          timestamp: summary.timestamp,
          recordCount: summary.recordCount.total,
          indexTimeMs: summary.indexConstruction.timeMs,
          serializedBytes: summary.serialization.bytes,
          compressedBytes: summary.compression.compressedBytes,
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
  console.log('\n📊 Record counts...');

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

function measureSheetRead() {
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

  const t3 = Date.now();
  range.getFormulas();
  const formulasTime = Date.now() - t3;

  console.log(`  Sample: ${sampleSize} rows × ${lastCol} cols`);
  console.log(`  getDisplayValues(): ${displayTime}ms`);
  console.log(`  getValues(): ${valuesTime}ms`);
  console.log(`  getFormulas(): ${formulasTime}ms`);

  return {
    sampleSize: sampleSize,
    displayValuesMs: displayTime,
    rawValuesMs: valuesTime,
    formulasMs: formulasTime
  };
}

function measureIndexConstruction() {
  console.log('\n🏗️ Index construction (actual production data)...');
  console.log('  ⚠️ Sets DISCOVERY_DIRTY cache flag (production side effect)');

  const start = Date.now();
  const bundle = getDiscoveryIndexBundle_();
  const timeMs = Date.now() - start;

  const recordCount = bundle.index ? bundle.index.length : 0;

  console.log(`  Time: ${timeMs}ms`);
  console.log(`  Records: ${recordCount}`);
  console.log(`  Per-record: ${recordCount > 0 ? (timeMs / recordCount).toFixed(2) : 'N/A'}ms`);

  // Return bundle for reuse in memory (not persisted)
  return {
    timeMs: timeMs,
    recordCount: recordCount,
    bundle: bundle
  };
}

function measureSerialization(actualBundle) {
  console.log('\n📦 Serialization (actual production index)...');

  const t1 = Date.now();
  const json = JSON.stringify(actualBundle);
  const serializeTime = Date.now() - t1;

  const bytes = Utilities.newBlob(json).getBytes().length;
  const kb = (bytes / 1024).toFixed(2);

  const t2 = Date.now();
  const parsed = JSON.parse(json);
  const deserializeTime = Date.now() - t2;

  console.log(`  Serialize: ${serializeTime}ms`);
  console.log(`  Deserialize: ${deserializeTime}ms`);
  console.log(`  Size: ${bytes} bytes (${kb} KB)`);
  console.log(`  Exceeds 100KB: ${bytes > 102400 ? 'YES ⚠️' : 'No'}`);
  console.log(`  Chunks needed (90KB each): ${Math.ceil(bytes / 92160)}`);

  return {
    serializeMs: serializeTime,
    deserializeMs: deserializeTime,
    bytes: bytes,
    kb: parseFloat(kb),
    exceedsLimit: bytes > 102400,
    chunksNeeded: Math.ceil(bytes / 92160),
    json: json  // Keep for compression measurement
  };
}

function measureCompression(actualJson) {
  console.log('\n🗜️ Compression (native gzip + Base64)...');

  const originalBytes = Utilities.newBlob(actualJson).getBytes().length;

  const t1 = Date.now();
  const compressed = Utilities.gzip(Utilities.newBlob(actualJson));
  const compressTime = Date.now() - t1;

  const compressedBytes = compressed.getBytes().length;

  const t2 = Date.now();
  const decompressed = Utilities.ungzip(compressed);
  const decompressTime = Date.now() - t2;

  // Base64 encode for cache storage (actual cache payload)
  const t3 = Date.now();
  const base64 = Utilities.base64Encode(compressed.getBytes());
  const encodeTime = Date.now() - t3;

  const cachePayloadBytes = Utilities.newBlob(base64).getBytes().length;

  const ratio = ((originalBytes - cachePayloadBytes) / originalBytes * 100).toFixed(1);

  console.log(`  Original: ${originalBytes} bytes`);
  console.log(`  Gzipped: ${compressedBytes} bytes`);
  console.log(`  Gzipped+Base64: ${cachePayloadBytes} bytes`);
  console.log(`  Reduction: ${ratio}%`);
  console.log(`  Compress: ${compressTime}ms`);
  console.log(`  Decompress: ${decompressTime}ms`);
  console.log(`  Base64 encode: ${encodeTime}ms`);
  console.log(`  Total overhead: ${compressTime + decompressTime + encodeTime}ms`);

  // Verify round-trip
  const roundTrip = decompressed.getDataAsString() === actualJson;
  console.log(`  Round-trip OK: ${roundTrip ? 'YES' : 'FAILED ⚠️'}`);

  return {
    originalBytes: originalBytes,
    compressedBytes: compressedBytes,
    cachePayloadBytes: cachePayloadBytes,
    ratio: ratio + '%',
    compressMs: compressTime,
    decompressMs: decompressTime,
    encodeMs: encodeTime,
    totalOverheadMs: compressTime + decompressTime + encodeTime,
    roundTripOk: roundTrip,
    compressedPayload: base64  // Keep for cache test
  };
}

function measureCacheRoundTrip(actualPayload) {
  console.log('\n💾 Cache round-trip (actual compressed payload)...');

  const cache = CacheService.getScriptCache();
  const testKey = 'PERF_DIAG_TEST_' + Date.now();

  // Check if payload exceeds cache limit
  const payloadBytes = Utilities.newBlob(actualPayload).getBytes().length;
  const cacheLimit = 100 * 1024; // 100KB

  console.log(`  Payload: ${payloadBytes} bytes`);
  console.log(`  Cache limit: ${cacheLimit} bytes`);
  console.log(`  Fits in single key: ${payloadBytes < cacheLimit ? 'YES' : 'NO ⚠️'}`);

  try {
    if (payloadBytes >= cacheLimit) {
      console.log('  ⚠️ Payload exceeds 100KB limit - testing with chunk strategy');

      // Test chunked cache strategy
      const chunkSize = 90 * 1024; // 90KB chunks
      const chunks = [];
      for (let i = 0; i < actualPayload.length; i += chunkSize) {
        chunks.push(actualPayload.substring(i, i + chunkSize));
      }

      console.log(`  Chunks: ${chunks.length}`);

      // Write chunks
      const t1 = Date.now();
      chunks.forEach((chunk, i) => {
        cache.put(testKey + '_' + i, chunk, 60);
      });
      const writeMs = Date.now() - t1;

      // Read chunks
      const t2 = Date.now();
      let retrieved = '';
      for (let i = 0; i < chunks.length; i++) {
        const chunk = cache.get(testKey + '_' + i);
        if (!chunk) {
          console.error(`  ⚠️ Chunk ${i} failed to retrieve`);
          return { error: 'Chunk retrieval failed', chunksNeeded: chunks.length };
        }
        retrieved += chunk;
      }
      const readMs = Date.now() - t2;

      const success = retrieved === actualPayload;

      console.log(`  Write (${chunks.length} chunks): ${writeMs}ms`);
      console.log(`  Read (${chunks.length} chunks): ${readMs}ms`);
      console.log(`  Round-trip: ${success ? 'OK' : 'FAILED'}`);

      return {
        writeMs: writeMs,
        readMs: readMs,
        success: success,
        chunksNeeded: chunks.length,
        chunkStrategy: true
      };

    } else {
      // Single-key cache test
      const t1 = Date.now();
      cache.put(testKey, actualPayload, 60);
      const writeMs = Date.now() - t1;

      const t2 = Date.now();
      const retrieved = cache.get(testKey);
      const readMs = Date.now() - t2;

      const success = retrieved === actualPayload;

      console.log(`  Write: ${writeMs}ms`);
      console.log(`  Read: ${readMs}ms`);
      console.log(`  Round-trip: ${success ? 'OK' : 'FAILED'}`);

      return {
        writeMs: writeMs,
        readMs: readMs,
        success: success,
        chunksNeeded: 1,
        chunkStrategy: false
      };
    }

  } finally {
    // Guaranteed cleanup
    try {
      if (payloadBytes >= cacheLimit) {
        const chunkCount = Math.ceil(actualPayload.length / (90 * 1024));
        for (let i = 0; i < chunkCount; i++) {
          cache.remove(testKey + '_' + i);
        }
      } else {
        cache.remove(testKey);
      }
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }
  }
}

function extractScalarMetrics(summary) {
  return {
    timestamp: summary.timestamp,
    recordCount: summary.recordCount,
    sheetRead: summary.sheetRead ? {
      sampleSize: summary.sheetRead.sampleSize,
      displayValuesMs: summary.sheetRead.displayValuesMs,
      rawValuesMs: summary.sheetRead.rawValuesMs,
      formulasMs: summary.sheetRead.formulasMs
    } : null,
    indexTimeMs: summary.indexConstruction ? summary.indexConstruction.timeMs : null,
    indexRecords: summary.indexConstruction ? summary.indexConstruction.recordCount : null,
    serialization: summary.serialization ? {
      serializeMs: summary.serialization.serializeMs,
      deserializeMs: summary.serialization.deserializeMs,
      bytes: summary.serialization.bytes,
      kb: summary.serialization.kb,
      exceedsLimit: summary.serialization.exceedsLimit,
      chunksNeeded: summary.serialization.chunksNeeded
    } : null,
    compression: summary.compression ? {
      originalBytes: summary.compression.originalBytes,
      compressedBytes: summary.compression.compressedBytes,
      cachePayloadBytes: summary.compression.cachePayloadBytes,
      ratio: summary.compression.ratio,
      compressMs: summary.compression.compressMs,
      decompressMs: summary.compression.decompressMs,
      encodeMs: summary.compression.encodeMs,
      totalOverheadMs: summary.compression.totalOverheadMs,
      roundTripOk: summary.compression.roundTripOk
    } : null,
    cache: summary.cacheTest ? {
      writeMs: summary.cacheTest.writeMs,
      readMs: summary.cacheTest.readMs,
      success: summary.cacheTest.success,
      chunksNeeded: summary.cacheTest.chunksNeeded,
      chunkStrategy: summary.cacheTest.chunkStrategy
    } : null
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
  console.log(`  Serialization: ${summary.serialization.serializeMs}ms`);
  console.log(`  Deserialization: ${summary.serialization.deserializeMs}ms`);
  console.log('\n💾 CACHING:');
  console.log(`  Index size: ${summary.serialization.kb} KB`);
  console.log(`  Exceeds 100KB: ${summary.serialization.exceedsLimit ? 'YES ⚠️' : 'No'}`);
  console.log(`  Chunks needed: ${summary.serialization.chunksNeeded}`);
  console.log(`  Compression: ${summary.compression.ratio} reduction`);
  console.log(`  Compression overhead: ${summary.compression.totalOverheadMs}ms`);
  console.log(`  Cache write: ${summary.cacheTest.writeMs}ms`);
  console.log(`  Cache read: ${summary.cacheTest.readMs}ms`);
  console.log(`  Chunk strategy: ${summary.cacheTest.chunkStrategy ? 'YES' : 'No'}`);
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
