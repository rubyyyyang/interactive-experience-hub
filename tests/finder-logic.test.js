/**
 * finder-logic.test.js
 * Local deterministic tests for Arcade Finder pure logic
 * Run with: npm test
 * No Apps Script runtime required.
 */

const { loadAppsScriptFile } = require('./node-loader.js');

// Load production code
const config = loadAppsScriptFile('./RM_Config.js');

// Inject config globals BEFORE loading other files
global.ENHANCED_CONFIG = config.ENHANCED_CONFIG;

// Load utils first to get normalizeStatusCanonical
const utils = loadAppsScriptFile('./RM_Utils.js');
global.normalizeStatusCanonical = utils.normalizeStatusCanonical;

const webapp = loadAppsScriptFile('./DiscoveryWebApp.js');

global.DISCOVERY_SEARCH_SYNONYMS = webapp.DISCOVERY_SEARCH_SYNONYMS;

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

function assertArrayEquals(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Arrays not equal: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('\n=== ARCADE FINDER - LOCAL DETERMINISTIC TESTS ===\n');

// Test 1: normalizeSearchText handles special characters and lowercases
test('normalizeSearchText normalizes text correctly', () => {
  assertEquals(webapp.normalizeSearchText_('K8s-Test'), 'k8s test');
  assertEquals(webapp.normalizeSearchText_('Multi-Layer'), 'multi layer');
  assertEquals(webapp.normalizeSearchText_('Red Hat & OpenShift'), 'red hat and openshift');
  assertEquals(webapp.normalizeSearchText_('Test/Demo_Name'), 'test demo name');
  assertEquals(webapp.normalizeSearchText_(null), '');
  assertEquals(webapp.normalizeSearchText_(''), '');
});

// Test 2: expandSearchTokenGroup expands known synonyms
test('expandSearchTokenGroup expands synonyms', () => {
  const k8sGroup = webapp.expandSearchTokenGroup_('k8s');
  assert(k8sGroup.includes('k8s'), 'Should include original token');
  assert(k8sGroup.includes('kubernetes'), 'Should include kubernetes synonym');

  const ocpGroup = webapp.expandSearchTokenGroup_('ocp');
  assert(ocpGroup.includes('ocp'), 'Should include original token');
  assert(ocpGroup.includes('openshift'), 'Should include openshift synonym');

  const rhelGroup = webapp.expandSearchTokenGroup_('rhel');
  assert(rhelGroup.includes('rhel'), 'Should include original token');
  assert(rhelGroup.includes('red hat enterprise linux'), 'Should include expanded form');

  // Reverse lookup: kubernetes → k8s
  const kubernetesGroup = webapp.expandSearchTokenGroup_('kubernetes');
  assert(kubernetesGroup.includes('kubernetes'), 'Should include original');
  assert(kubernetesGroup.includes('k8s'), 'Should include abbreviated form');
});

// Test 3: normalizeStatusCanonical maps legacy statuses to canonical
test('normalizeStatusCanonical handles legacy and canonical statuses', () => {
  // Canonical statuses pass through
  assertEquals(utils.normalizeStatusCanonical('Request Open'), 'Request Open');
  assertEquals(utils.normalizeStatusCanonical('Published'), 'Published');

  // Legacy mappings
  assertEquals(utils.normalizeStatusCanonical('open'), 'Request Open');
  assertEquals(utils.normalizeStatusCanonical('approved'), 'Request Approved');
  assertEquals(utils.normalizeStatusCanonical('received'), 'Demo Received');
  assertEquals(utils.normalizeStatusCanonical('ie reviewed'), 'Demo Reviewed');
  assertEquals(utils.normalizeStatusCanonical('demo published'), 'Published');
  assertEquals(utils.normalizeStatusCanonical('retired'), 'Retired');

  // Case insensitivity
  assertEquals(utils.normalizeStatusCanonical('PUBLISHED'), 'Published');
  assertEquals(utils.normalizeStatusCanonical('Open'), 'Request Open');

  // Empty/null handling
  assertEquals(utils.normalizeStatusCanonical(''), '');
  assertEquals(utils.normalizeStatusCanonical(null), '');
});

// Test 4: computeIsReadyToUse requires Published/Reviewed status + valid link
test('computeIsReadyToUse enforces status and link requirements', () => {
  // Valid: Published + link
  assertEquals(
    webapp.computeIsReadyToUse_('Published', 'https://interact.redhat.com/demo', '', ''),
    true
  );
  assertEquals(
    webapp.computeIsReadyToUse_('Demo Reviewed', '', 'https://redhat.com/page', ''),
    true
  );

  // Invalid: wrong status
  assertEquals(
    webapp.computeIsReadyToUse_('Request Open', 'https://interact.redhat.com/demo', '', ''),
    false
  );
  assertEquals(
    webapp.computeIsReadyToUse_('Demo Received', 'https://interact.redhat.com/demo', '', ''),
    false
  );

  // Invalid: no link
  assertEquals(
    webapp.computeIsReadyToUse_('Published', '', '', ''),
    false
  );

  // Valid: any of the three link fields
  assertEquals(
    webapp.computeIsReadyToUse_('Published', '', '', 'https://rhac.redhat.com/demo'),
    true
  );
});

// Test 5: computeIsDiscoverable combines status + readiness checks
test('computeIsDiscoverable requires both published status and readiness', () => {
  // Valid: Published + ready
  assertEquals(
    webapp.computeIsDiscoverable_('Published', true),
    true
  );
  assertEquals(
    webapp.computeIsDiscoverable_('Demo Reviewed', true),
    true
  );

  // Invalid: not ready
  assertEquals(
    webapp.computeIsDiscoverable_('Published', false),
    false
  );

  // Invalid: wrong status even if ready
  assertEquals(
    webapp.computeIsDiscoverable_('Request Open', true),
    false
  );
  assertEquals(
    webapp.computeIsDiscoverable_('Demo Received', true),
    false
  );
});

// Test 6: Email domain validation (read existing config)
test('email domain validation enforces allowed domains', () => {
  const allowedDomains = webapp.DISCOVERY_WEBAPP_CONFIG.ALLOWED_EMAIL_DOMAINS;

  // Verify config structure
  assert(Array.isArray(allowedDomains), 'ALLOWED_EMAIL_DOMAINS must be an array');
  assertArrayEquals(allowedDomains, ['redhat.com'], 'Should only allow redhat.com');

  // Test domain extraction logic (validates config, not a function)
  const testEmail = 'user@redhat.com';
  const domain = testEmail.split('@')[1];
  assert(allowedDomains.includes(domain), 'redhat.com should be allowed');

  const invalidDomain = 'user@example.com'.split('@')[1];
  assert(!allowedDomains.includes(invalidDomain), 'example.com should not be allowed');
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
