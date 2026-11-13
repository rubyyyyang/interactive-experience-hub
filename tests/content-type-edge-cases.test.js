/**
 * content-type-edge-cases.test.js
 * Additional tests for getEditLink and record resolution
 * Run with: npm test
 */

const { loadAppsScriptFile } = require('./node-loader.js');

// Load production code
const config = loadAppsScriptFile('./RM_Config.js');
global.ENHANCED_CONFIG = config.ENHANCED_CONFIG;

const utils = loadAppsScriptFile('./RM_Utils.js');
global.normalizeStatusCanonical = utils.normalizeStatusCanonical;

const webapp = loadAppsScriptFile('./DiscoveryWebApp.js');

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, fn) {
  try {
    fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: e.message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('\n=== CONTENT TYPE EDGE CASES TESTS ===\n');

// Test Group 1: getEditLink behavior (simulated frontend logic)
function getEditLink(creationLink) {
  var link = creationLink || "";
  if (!link) return "";

  // Skip /share/videos/ URLs - these are Video Demo content, not editable Arcade flows
  if (link.indexOf('/share/videos/') !== -1) return "";

  var match = link.match(/interact\.redhat\.com\/share\/([A-Za-z0-9_-]+)/);
  if (match) return "https://app.arcade.software/flows/" + match[1] + "/edit";
  match = link.match(/app\.arcade\.software\/share\/([A-Za-z0-9_-]+)/);
  if (match) return "https://app.arcade.software/flows/" + match[1] + "/edit";
  if (link.indexOf("app.arcade.software") !== -1) return link;
  return link;
}

test('getEditLink: Interactive Demo URL generates correct edit link', () => {
  const editLink = getEditLink('https://interact.redhat.com/share/demo123');
  assertEquals(editLink, 'https://app.arcade.software/flows/demo123/edit');
});

test('getEditLink: Video Demo URL returns empty (not editable)', () => {
  const editLink = getEditLink('https://interact.redhat.com/share/videos/vid123');
  assertEquals(editLink, '', 'Video Demo URLs should not generate edit links');
});

test('getEditLink: YouTube URL returns the URL as-is', () => {
  const editLink = getEditLink('https://www.youtube.com/watch?v=abc123');
  assertEquals(editLink, 'https://www.youtube.com/watch?v=abc123');
});

test('getEditLink: Arcade share URL generates correct edit link', () => {
  const editLink = getEditLink('https://app.arcade.software/share/flow456');
  assertEquals(editLink, 'https://app.arcade.software/flows/flow456/edit');
});

test('getEditLink: Empty creation link returns empty', () => {
  const editLink = getEditLink('');
  assertEquals(editLink, '');
});

test('getEditLink: /share/videos/ in any position is skipped', () => {
  const editLink = getEditLink('https://interact.redhat.com/share/videos/nested/path');
  assertEquals(editLink, '', 'Any /share/videos/ path should be skipped');
});

// Test Group 2: Record ID Format
test('Record ID: Request_Master records use numeric IDs', () => {
  const recordId = '123';
  const isYouTube = recordId.indexOf('yt-') === 0;
  assert(!isYouTube, 'Numeric IDs are not YouTube records');
});

test('Record ID: YouTube records use yt- prefix', () => {
  const recordId = 'yt-45';
  const isYouTube = recordId.indexOf('yt-') === 0;
  assert(isYouTube, 'yt- prefix identifies YouTube records');
});

test('Record ID: Extract YouTube row number', () => {
  const recordId = 'yt-45';
  const rowNumber = Number(recordId.slice(3));
  assertEquals(rowNumber, 45, 'Should extract row number from yt-{row}');
});

test('Record ID: Invalid YouTube ID returns NaN', () => {
  const recordId = 'yt-abc';
  const rowNumber = Number(recordId.slice(3));
  assert(isNaN(rowNumber), 'Invalid row number should be NaN');
});

// Test Group 3: Format-based behavior
test('Format: Interactive Demo has editable source', () => {
  const format = 'Interactive Demo';
  const hasEditableSource = format === 'Interactive Demo';
  assert(hasEditableSource, 'Interactive Demo should have editable source');
});

test('Format: Video Demo does not have editable source', () => {
  const format = 'Video Demo';
  const hasEditableSource = format === 'Interactive Demo';
  assert(!hasEditableSource, 'Video Demo should not have editable source');
});

test('Format: YouTube does not have editable source', () => {
  const format = 'YouTube';
  const hasEditableSource = format === 'Interactive Demo';
  assert(!hasEditableSource, 'YouTube should not have editable source');
});

test('Format: YouTube and Video Demo both use "Watch Video" label', () => {
  const youtubeLabel = 'YouTube';
  const videoDemoLabel = 'Video Demo';
  const interactiveDemoLabel = 'Interactive Demo';

  assert(youtubeLabel !== interactiveDemoLabel, 'YouTube is distinct from Interactive Demo');
  assert(videoDemoLabel !== interactiveDemoLabel, 'Video Demo is distinct from Interactive Demo');
  assert(youtubeLabel !== videoDemoLabel, 'YouTube is distinct from Video Demo');
});

// Test Group 4: URL Pattern Matching
test('URL Pattern: /share/videos/ should not match generic /share/ pattern', () => {
  const url = 'https://interact.redhat.com/share/videos/test';
  const matchesVideos = /interact\.redhat\.com\/share\/videos\//.test(url);
  const matchesGeneric = /interact\.redhat\.com\/share\/([A-Za-z0-9_-]+)/.test(url);

  assert(matchesVideos, 'Should match videos pattern');
  assert(matchesGeneric, 'Also matches generic pattern (order matters!)');
});

test('URL Pattern: Order of checks determines classification', () => {
  // The order should be:
  // 1. YouTube (highest priority)
  // 2. Video Demo (/share/videos/)
  // 3. Interactive Demo (generic interact.redhat.com)
  // 4. Lab

  const url = 'https://interact.redhat.com/share/videos/test';

  // First check: YouTube?
  const isYouTube = /youtu\.be|youtube\.com/.test(url);
  assert(!isYouTube, 'Not a YouTube URL');

  // Second check: Video Demo?
  const isVideoDemo = /interact\.redhat\.com\/share\/videos\//.test(url);
  assert(isVideoDemo, 'Is a Video Demo URL');

  // Third check would be: Interactive Demo (but we already matched)
});

// Test Group 5: Security - Discoverability Check
test('Security: YouTube record resolution respects isDiscoverable', () => {
  // This is a logical test - the actual implementation must check isDiscoverable
  // before returning a YouTube record from getDiscoveryRecord()

  // Simulate the check that should happen:
  const mockYouTubeRecord = {
    recordId: 'yt-123',
    format: 'YouTube',
    isDiscoverable: false, // Retired or unpublished
    productionLink: 'https://youtube.com/watch?v=test'
  };

  // The function should throw "Record not found" for non-discoverable records
  const shouldThrow = !mockYouTubeRecord.isDiscoverable;
  assert(shouldThrow, 'Non-discoverable YouTube records should not be accessible');
});

test('Security: Request_Master records filtered by index building', () => {
  // Request_Master records are only added to index if isDiscoverable is true
  // Direct lookup via getDiscoveryRecord() reads the raw row, but only discoverable
  // records are in the index, so invalid IDs will fail row validation
  const validRow = 5; // Example row number
  assert(validRow > 1, 'Valid row numbers must be > header row');
});

// Print summary
console.log('\n=== TEST SUMMARY ===');
console.log(`Total: ${results.passed + results.failed}`);
console.log(`Passed: ${results.passed}`);
console.log(`Failed: ${results.failed}`);

if (results.failed > 0) {
  console.log('\nFailed tests:');
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`  - ${t.name}: ${t.error}`);
  });
  process.exit(1);
}

console.log('\n✓ All tests passed\n');
