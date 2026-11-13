/**
 * security-discoverability.test.js
 * Security tests for getDiscoveryRecord discoverability enforcement
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

console.log('\n=== SECURITY: DISCOVERABILITY ENFORCEMENT TESTS ===\n');

// Test Group 1: isDiscoverable Computation Logic
test('computeIsDiscoverable requires Published/Reviewed status', () => {
  // Published status + ready = discoverable
  assertEquals(
    webapp.computeIsDiscoverable_('Published', true),
    true,
    'Published + ready should be discoverable'
  );

  assertEquals(
    webapp.computeIsDiscoverable_('Demo Reviewed', true),
    true,
    'Demo Reviewed + ready should be discoverable'
  );

  // Wrong status = not discoverable even if ready
  assertEquals(
    webapp.computeIsDiscoverable_('Request Open', true),
    false,
    'Request Open should not be discoverable'
  );

  assertEquals(
    webapp.computeIsDiscoverable_('Retired', true),
    false,
    'Retired should not be discoverable'
  );

  assertEquals(
    webapp.computeIsDiscoverable_('Demo Received', true),
    false,
    'Demo Received should not be discoverable'
  );
});

test('computeIsDiscoverable requires isReadyToUse', () => {
  // Correct status but not ready = not discoverable
  assertEquals(
    webapp.computeIsDiscoverable_('Published', false),
    false,
    'Published but not ready should not be discoverable'
  );

  assertEquals(
    webapp.computeIsDiscoverable_('Demo Reviewed', false),
    false,
    'Demo Reviewed but not ready should not be discoverable'
  );
});

// Test Group 2: isReadyToUse Computation Logic
test('computeIsReadyToUse requires Published/Reviewed status', () => {
  // Correct status + link = ready
  assertEquals(
    webapp.computeIsReadyToUse_('Published', 'https://example.com', '', ''),
    true,
    'Published + production link = ready'
  );

  assertEquals(
    webapp.computeIsReadyToUse_('Demo Reviewed', '', 'https://example.com', ''),
    true,
    'Demo Reviewed + drupal link = ready'
  );

  // Wrong status = not ready even with links
  assertEquals(
    webapp.computeIsReadyToUse_('Request Open', 'https://example.com', '', ''),
    false,
    'Request Open should not be ready'
  );

  assertEquals(
    webapp.computeIsReadyToUse_('Retired', 'https://example.com', '', ''),
    false,
    'Retired should not be ready'
  );
});

test('computeIsReadyToUse requires at least one valid link', () => {
  // Correct status but no links = not ready
  assertEquals(
    webapp.computeIsReadyToUse_('Published', '', '', ''),
    false,
    'Published with no links should not be ready'
  );

  // Any of the three link types is sufficient
  assertEquals(
    webapp.computeIsReadyToUse_('Published', 'https://prod.com', '', ''),
    true,
    'Production link alone is sufficient'
  );

  assertEquals(
    webapp.computeIsReadyToUse_('Published', '', 'https://drupal.com', ''),
    true,
    'Drupal link alone is sufficient'
  );

  assertEquals(
    webapp.computeIsReadyToUse_('Published', '', '', 'https://rhac.com'),
    true,
    'RHAC link alone is sufficient'
  );
});

// Test Group 3: Fallback Logic Security
test('YouTube fallback does not override status-based discoverability', () => {
  // This test verifies the logic flow conceptually
  // In actual code: if status is "Retired", isDiscoverable is false
  // Even if we add productionLink fallback, isDiscoverable should remain false

  const retiredStatus = 'Retired';
  const hasCreationLink = true;
  const hasProductionLink = false;

  // After fallback, production link exists
  const productionLinkAfterFallback = 'https://youtube.com/watch?v=test';

  // But isReadyToUse still checks status
  const isReadyAfterFallback = webapp.computeIsReadyToUse_(
    retiredStatus,
    productionLinkAfterFallback,
    '',
    ''
  );

  // Retired status means not ready
  assertEquals(isReadyAfterFallback, false, 'Retired status should remain not ready');

  // And therefore not discoverable
  const isDiscoverableAfterFallback = webapp.computeIsDiscoverable_(
    retiredStatus,
    isReadyAfterFallback
  );

  assertEquals(
    isDiscoverableAfterFallback,
    false,
    'Retired record should remain not discoverable even with fallback link'
  );
});

test('YouTube fallback preserves Published status discoverability', () => {
  // Published record with only creation link
  const publishedStatus = 'Published';
  const creationLink = 'https://youtube.com/watch?v=test';

  // After fallback: production link = creation link
  const isReady = webapp.computeIsReadyToUse_(
    publishedStatus,
    creationLink, // Used as production link
    '',
    ''
  );

  assertEquals(isReady, true, 'Published with link should be ready');

  const isDiscoverable = webapp.computeIsDiscoverable_(publishedStatus, isReady);

  assertEquals(isDiscoverable, true, 'Published and ready should be discoverable');
});

// Test Group 4: Edge Cases
test('Empty or invalid status is not discoverable', () => {
  assertEquals(
    webapp.computeIsDiscoverable_('', true),
    false,
    'Empty status should not be discoverable'
  );

  assertEquals(
    webapp.computeIsDiscoverable_(null, true),
    false,
    'Null status should not be discoverable'
  );

  assertEquals(
    webapp.computeIsDiscoverable_('Invalid Status', true),
    false,
    'Invalid status should not be discoverable'
  );
});

test('Legacy status values map correctly', () => {
  // Legacy "demo published" should map to "Published"
  const canonical = utils.normalizeStatusCanonical('demo published');
  assertEquals(canonical, 'Published', 'Legacy demo published maps to Published');

  const isDiscoverable = webapp.computeIsDiscoverable_(canonical, true);
  assertEquals(isDiscoverable, true, 'Legacy demo published should be discoverable');
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
