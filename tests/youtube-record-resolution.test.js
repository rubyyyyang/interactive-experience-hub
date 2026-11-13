/**
 * youtube-record-resolution.test.js
 * Regression tests for YouTube record resolution with creation-only links
 * Tests the exact scenario: Published YouTube with creationLink but no productionLink
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

console.log('\n=== YOUTUBE RECORD RESOLUTION REGRESSION TESTS ===\n');

// Simulate the exact flow for YouTube records with creation-only links

// Test Group 1: Published YouTube with Creation Link Only
test('Published YouTube with creation link only should be discoverable', () => {
  // Scenario: Published YouTube record with only creationLink (typical case)
  const status = 'Published';
  const creationLink = 'https://www.youtube.com/watch?v=test123';
  const productionLink = ''; // No production link initially

  // Step 1: Initial computation (before fallback)
  const isReadyInitial = webapp.computeIsReadyToUse_(status, productionLink, '', '');
  assertEquals(isReadyInitial, false, 'Without production link, not ready initially');

  const isDiscoverableInitial = webapp.computeIsDiscoverable_(status, isReadyInitial);
  assertEquals(isDiscoverableInitial, false, 'Not discoverable without ready state');

  // Step 2: After fallback (productionLink = creationLink)
  const productionLinkAfterFallback = creationLink;
  const isReadyAfterFallback = webapp.computeIsReadyToUse_(status, productionLinkAfterFallback, '', '');
  assertEquals(isReadyAfterFallback, true, 'With fallback production link, should be ready');

  const isDiscoverableAfterFallback = webapp.computeIsDiscoverable_(status, isReadyAfterFallback);
  assertEquals(isDiscoverableAfterFallback, true, 'Published + ready = discoverable');
});

test('Demo Reviewed YouTube with creation link only should be discoverable', () => {
  const status = 'Demo Reviewed';
  const creationLink = 'https://www.youtube.com/watch?v=test456';

  // After fallback
  const isReady = webapp.computeIsReadyToUse_(status, creationLink, '', '');
  assertEquals(isReady, true, 'Demo Reviewed + link = ready');

  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);
  assertEquals(isDiscoverable, true, 'Demo Reviewed + ready = discoverable');
});

// Test Group 2: Retired YouTube with Creation Link (Security Check)
test('Retired YouTube with creation link should NOT be discoverable', () => {
  // Scenario: Retired YouTube record (security test - should be rejected)
  const status = 'Retired';
  const creationLink = 'https://www.youtube.com/watch?v=retired';

  // Even with fallback production link
  const isReady = webapp.computeIsReadyToUse_(status, creationLink, '', '');
  assertEquals(isReady, false, 'Retired status means not ready (status check prevents it)');

  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);
  assertEquals(isDiscoverable, false, 'Retired should never be discoverable');
});

test('Retired YouTube with both production and creation links should NOT be discoverable', () => {
  const status = 'Retired';
  const productionLink = 'https://www.youtube.com/watch?v=retired';
  const creationLink = 'https://www.youtube.com/watch?v=retired';

  // Even with explicit production link
  const isReady = webapp.computeIsReadyToUse_(status, productionLink, '', '');
  assertEquals(isReady, false, 'Retired status blocks readiness');

  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);
  assertEquals(isDiscoverable, false, 'Retired with links is still not discoverable');
});

// Test Group 3: Unpublished YouTube Records
test('Request Open YouTube with creation link should NOT be discoverable', () => {
  const status = 'Request Open';
  const creationLink = 'https://www.youtube.com/watch?v=draft';

  const isReady = webapp.computeIsReadyToUse_(status, creationLink, '', '');
  assertEquals(isReady, false, 'Request Open is not a published status');

  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);
  assertEquals(isDiscoverable, false, 'Unpublished should not be discoverable');
});

test('Demo Received YouTube with creation link should NOT be discoverable', () => {
  const status = 'Demo Received';
  const creationLink = 'https://www.youtube.com/watch?v=submitted';

  const isReady = webapp.computeIsReadyToUse_(status, creationLink, '', '');
  assertEquals(isReady, false, 'Demo Received is not a published status');

  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);
  assertEquals(isDiscoverable, false, 'Submitted but not published is not discoverable');
});

// Test Group 4: Legacy Status Values
test('Legacy "demo published" YouTube with creation link should be discoverable', () => {
  const legacyStatus = 'demo published';
  const canonicalStatus = utils.normalizeStatusCanonical(legacyStatus);
  const creationLink = 'https://www.youtube.com/watch?v=legacy';

  assertEquals(canonicalStatus, 'Published', 'Legacy status maps to Published');

  const isReady = webapp.computeIsReadyToUse_(canonicalStatus, creationLink, '', '');
  assertEquals(isReady, true, 'Canonical Published + link = ready');

  const isDiscoverable = webapp.computeIsDiscoverable_(canonicalStatus, isReady);
  assertEquals(isDiscoverable, true, 'Legacy demo published should be discoverable');
});

test('Legacy "ie reviewed" YouTube with creation link should be discoverable', () => {
  const legacyStatus = 'ie reviewed';
  const canonicalStatus = utils.normalizeStatusCanonical(legacyStatus);
  const creationLink = 'https://www.youtube.com/watch?v=iereviewed';

  assertEquals(canonicalStatus, 'Demo Reviewed', 'Legacy ie reviewed maps to Demo Reviewed');

  const isReady = webapp.computeIsReadyToUse_(canonicalStatus, creationLink, '', '');
  assertEquals(isReady, true, 'Canonical Demo Reviewed + link = ready');

  const isDiscoverable = webapp.computeIsDiscoverable_(canonicalStatus, isReady);
  assertEquals(isDiscoverable, true, 'Legacy ie reviewed should be discoverable');
});

// Test Group 5: Edge Cases
test('Published YouTube with empty creation link should NOT be discoverable', () => {
  const status = 'Published';
  const productionLink = '';
  const creationLink = '';

  // No fallback applies (both empty)
  const isReady = webapp.computeIsReadyToUse_(status, productionLink, '', '');
  assertEquals(isReady, false, 'No links = not ready');

  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);
  assertEquals(isDiscoverable, false, 'Published but no links = not discoverable');
});

test('Published YouTube with production link (no fallback needed)', () => {
  const status = 'Published';
  const productionLink = 'https://www.youtube.com/watch?v=hasproduction';
  const creationLink = 'https://www.youtube.com/watch?v=hascreation';

  // Production link already exists, fallback not needed
  const isReady = webapp.computeIsReadyToUse_(status, productionLink, '', '');
  assertEquals(isReady, true, 'Published + production link = ready');

  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);
  assertEquals(isDiscoverable, true, 'Published + ready = discoverable (normal case)');
});

// Test Group 6: Consistency with Index Building
test('Fallback behavior matches index building for Published records', () => {
  // Index building does this:
  // if (!ytItem.productionLink && ytItem.creationLink) {
  //   ytItem.productionLink = ytItem.creationLink;
  //   ytItem.isReadyToUse = true;
  //   ytItem.isDiscoverable = true;
  // }

  // But only for records that pass status filter first
  const status = 'Published';
  const creationLink = 'https://www.youtube.com/watch?v=index';

  // After fallback + recomputation
  const isReady = webapp.computeIsReadyToUse_(status, creationLink, '', '');
  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);

  // Should match index building result for Published records
  assertEquals(isReady, true, 'Should match index building: ready = true');
  assertEquals(isDiscoverable, true, 'Should match index building: discoverable = true');
});

test('Fallback behavior differs from index building for Retired records', () => {
  // Index building pre-filters by status, so Retired records never reach the fallback
  // But direct access DOES reach the fallback, so we must check status
  const status = 'Retired';
  const creationLink = 'https://www.youtube.com/watch?v=retired';

  // After fallback + recomputation
  const isReady = webapp.computeIsReadyToUse_(status, creationLink, '', '');
  const isDiscoverable = webapp.computeIsDiscoverable_(status, isReady);

  // Status check prevents discoverability (security)
  assertEquals(isReady, false, 'Retired status blocks readiness');
  assertEquals(isDiscoverable, false, 'Retired should NOT be discoverable (security fix)');
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
