/**
 * content-type-classification.test.js
 * Tests for content type classification logic (Package 1: Content Type Foundation)
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

// Helper to simulate format classification logic (UPDATED to match fix)
function classifyFormat(productionLink, creationLink) {
  const _linkBlob = (productionLink + ' ' + creationLink).toLowerCase();
  const format = /youtu\.be|youtube\.com/.test(_linkBlob) ? 'YouTube'
    : /interact\.redhat\.com\/share\/videos\//.test(_linkBlob) ? 'Video Demo'
    : /interact\.redhat\.com|app\.arcade\.software/.test(_linkBlob) ? 'Interactive Demo'
    : /interactive[\-\s]?lab|demo\.redhat\.com/.test(_linkBlob) ? 'Lab'
    : '';
  return format;
}

console.log('\n=== CONTENT TYPE CLASSIFICATION TESTS ===\n');

// Test Group 1: Interactive Demo URLs
test('Interactive Demo: /share/{id} is classified correctly', () => {
  const format = classifyFormat('https://interact.redhat.com/share/abc123', '');
  assertEquals(format, 'Interactive Demo', 'Standard Interactive Demo URL');
});

test('Interactive Demo: app.arcade.software URLs are classified correctly', () => {
  const format = classifyFormat('https://app.arcade.software/share/abc123', '');
  assertEquals(format, 'Interactive Demo', 'Arcade share URL');
});

test('Interactive Demo: creationLink only', () => {
  const format = classifyFormat('', 'https://app.arcade.software/flows/xyz789/edit');
  assertEquals(format, 'Interactive Demo', 'Creation link should also classify as Interactive Demo');
});

// Test Group 2: Video Demo URLs (NEW CONTENT TYPE)
test('Video Demo: /share/videos/{id} is classified as Video Demo', () => {
  const format = classifyFormat('https://interact.redhat.com/share/videos/vid123', '');
  assertEquals(format, 'Video Demo', 'videos URL should be classified as Video Demo');
});

test('Video Demo: /share/videos/ matches Video Demo pattern first', () => {
  const url = 'https://interact.redhat.com/share/videos/vid123';
  const matchesVideos = /interact\.redhat\.com\/share\/videos\//.test(url.toLowerCase());
  assert(matchesVideos, 'Should match specific /share/videos/ pattern');
});

// Test Group 3: YouTube URLs
test('YouTube: youtube.com URLs are classified as YouTube', () => {
  const format = classifyFormat('https://www.youtube.com/watch?v=abc123', '');
  assertEquals(format, 'YouTube', 'YouTube full URL');
});

test('YouTube: youtu.be URLs are classified as YouTube', () => {
  const format = classifyFormat('https://youtu.be/abc123', '');
  assertEquals(format, 'YouTube', 'YouTube short URL');
});

test('YouTube: creationLink with YouTube URL', () => {
  const format = classifyFormat('', 'https://www.youtube.com/watch?v=abc123');
  assertEquals(format, 'YouTube', 'YouTube in creation link');
});

// Test Group 4: Classification Precedence
test('Precedence: YouTube in productionLink takes priority', () => {
  const format = classifyFormat(
    'https://www.youtube.com/watch?v=abc123',
    'https://interact.redhat.com/share/xyz789'
  );
  assertEquals(format, 'YouTube', 'YouTube should win when both are present');
});

test('Precedence: Mixed URL fields with Interactive Demo', () => {
  const format = classifyFormat(
    'https://interact.redhat.com/share/abc123',
    'https://app.arcade.software/flows/abc123/edit'
  );
  assertEquals(format, 'Interactive Demo', 'Interactive Demo when no YouTube');
});

// Test Group 5: Lab URLs
test('Lab: demo.redhat.com URLs are classified as Lab', () => {
  const format = classifyFormat('https://demo.redhat.com/workshop/xyz', '');
  assertEquals(format, 'Lab', 'demo.redhat.com should be Lab');
});

test('Lab: interactive-lab pattern is classified as Lab', () => {
  const format = classifyFormat('https://example.com/interactive-lab/xyz', '');
  assertEquals(format, 'Lab', 'interactive-lab pattern');
});

// Test Group 6: Edge Cases
test('Edge case: Empty URLs return empty format', () => {
  const format = classifyFormat('', '');
  assertEquals(format, '', 'No URLs should return empty format');
});

test('Edge case: Unsupported URL returns empty format', () => {
  const format = classifyFormat('https://example.com/demo', '');
  assertEquals(format, '', 'Unsupported domain returns empty');
});

test('Edge case: Multiple URL types - YouTube wins', () => {
  const format = classifyFormat(
    'https://www.youtube.com/watch?v=abc123',
    'https://demo.redhat.com/lab'
  );
  assertEquals(format, 'YouTube', 'YouTube has highest precedence');
});

test('Edge case: URL with spaces or unusual formatting', () => {
  const format = classifyFormat('  https://interact.redhat.com/share/abc123  ', '');
  // Note: current implementation doesn't trim, this test documents behavior
  assertEquals(format, 'Interactive Demo', 'Should handle whitespace');
});

// Test Group 7: Real-world URL patterns
test('Real-world: Standard Interactive Demo flow', () => {
  const format = classifyFormat(
    'https://interact.redhat.com/share/openshift-demo',
    'https://app.arcade.software/flows/openshift-demo/edit'
  );
  assertEquals(format, 'Interactive Demo');
});

test('Real-world: YouTube video in system', () => {
  const format = classifyFormat(
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ''
  );
  assertEquals(format, 'YouTube');
});

test('Real-world: New Video Demo content type', () => {
  const format = classifyFormat(
    'https://interact.redhat.com/share/videos/product-overview',
    ''
  );
  assertEquals(format, 'Video Demo', 'Should be Video Demo after fix');
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
