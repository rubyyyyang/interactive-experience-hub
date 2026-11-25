/**
 * Lightweight smoke test for DiscoveryPerformanceDiagnostics.js
 * Tests execution flow with mocked Apps Script services
 */

// Mock Apps Script services
const mockServices = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => ({
        getLastRow: () => 150,
        getLastColumn: () => 25,
        getRange: (row, col, numRows, numCols) => ({
          getDisplayValues: () => Array(numRows).fill(Array(numCols).fill('mock')),
          getValues: () => Array(numRows).fill(Array(numCols).fill('mock')),
          getFormulas: () => Array(numRows).fill(Array(numCols).fill(''))
        })
      })
    })
  },
  Utilities: {
    newBlob: (data) => ({
      getBytes: () => ({ length: typeof data === 'string' ? data.length : 1024 })
    }),
    gzip: (blob) => ({
      getBytes: () => ({ length: 512 })
    }),
    ungzip: (blob) => ({
      getDataAsString: () => mockBundleJson
    }),
    base64Encode: (bytes) => 'base64encodedstring'.repeat(10)
  },
  CacheService: {
    getScriptCache: () => ({
      put: (key, value, ttl) => true,
      get: (key) => key.includes('PERF_DIAG_TEST') ? mockCompressedPayload : null,
      remove: (key) => true
    })
  },
  PropertiesService: {
    getDocumentProperties: () => ({
      setProperty: (key, value) => {
        if (value.length > 9000) {
          throw new Error('Test: Document property exceeds 9KB limit');
        }
        return true;
      },
      getProperty: (key) => null
    })
  }
};

// Mock bundle data
const mockBundle = {
  index: Array(145).fill({
    recordId: '12345',
    title: 'Sample Demo',
    product: 'Red Hat OpenShift',
    format: 'Interactive Demo'
  }),
  facetMaps: {
    products: { 'Red Hat OpenShift': [0, 1, 2] },
    tdps: { 'Container Management': [0, 1] },
    formats: { 'Interactive Demo': [0, 1, 2] }
  },
  searchIndex: {
    terms: { 'demo': [0, 1], 'openshift': [0, 2] },
    prefixes: { 'dem': [0, 1], 'open': [0, 2] }
  }
};

const mockBundleJson = JSON.stringify(mockBundle);
const mockCompressedPayload = 'base64encodedstring'.repeat(10);

// Mock getDiscoveryIndexBundle_ and getMasterSheet_
global.getDiscoveryIndexBundle_ = () => mockBundle;
global.getMasterSheet_ = () => mockServices.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Request_Master');

// Inject mocks into global scope
global.SpreadsheetApp = mockServices.SpreadsheetApp;
global.Utilities = mockServices.Utilities;
global.CacheService = mockServices.CacheService;
global.PropertiesService = mockServices.PropertiesService;
global.console = console;
global.Date = Date;
global.JSON = JSON;

// Load diagnostic code
const fs = require('fs');
const path = require('path');
const diagnosticCode = fs.readFileSync(
  path.join(__dirname, '../DiscoveryPerformanceDiagnostics.js'),
  'utf8'
);

// Execute diagnostic code in context
eval(diagnosticCode);

// Run smoke test
console.log('=== DIAGNOSTIC SMOKE TEST ===\n');

try {
  // Test main diagnostic flow
  const result = runDiscoveryPerformanceDiagnostics();

  // Verify data flow: result should be scalarSummary (not raw summary)
  if (result.serialization && result.serialization.json) {
    throw new Error('FAIL: Return value contains raw serialized JSON (should be scalar only)');
  }

  if (result.compression && result.compression.compressedPayload) {
    throw new Error('FAIL: Return value contains compressed payload (should be scalar only)');
  }

  // Verify required fields exist
  const requiredFields = [
    'timestamp',
    'recordCount',
    'sheetRead',
    'indexTimeMs',
    'indexRecords',
    'serialization',
    'compression',
    'cache'
  ];

  for (const field of requiredFields) {
    if (result[field] === undefined) {
      throw new Error(`FAIL: Missing required field: ${field}`);
    }
  }

  // Verify nested structure
  if (!result.serialization.bytes) {
    throw new Error('FAIL: Missing serialization.bytes');
  }

  if (!result.compression.cachePayloadBytes) {
    throw new Error('FAIL: Missing compression.cachePayloadBytes');
  }

  if (result.cache.success !== true) {
    throw new Error('FAIL: Cache round-trip did not succeed');
  }

  // Verify no raw data in scalar metrics
  if (typeof result.serialization === 'string') {
    throw new Error('FAIL: Serialization field contains string data (should be object with metrics)');
  }

  console.log('✅ Main diagnostic flow: PASS');
  console.log('✅ Data flow correctness: PASS');
  console.log('✅ Scalar-only return value: PASS');
  console.log('✅ Required fields present: PASS');
  console.log('✅ Cache round-trip: PASS');

  console.log('\n✅ All smoke tests passed!');
  process.exit(0);

} catch (error) {
  console.error('❌ Smoke test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
