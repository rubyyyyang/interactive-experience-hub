/**
 * Hub Cross-App Navigation Test
 * Verifies environment-aware Intake URL detection in Hub doGet() and discovery.html
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running Hub cross-app navigation test...\n');

const repoRoot = path.resolve(__dirname, '..');
const discoveryWebAppJs = fs.readFileSync(path.join(repoRoot, 'DiscoveryWebApp.js'), 'utf8');
const discoveryHtml = fs.readFileSync(path.join(repoRoot, 'discovery.html'), 'utf8');

function testEnvironmentDetectionLogic() {
  console.log('Test: Environment detection logic in doGet()');

  // Should check if baseUrl contains '/dev'
  assert.ok(/isDev = baseUrl\.indexOf\('\/dev'\) > -1/.test(discoveryWebAppJs),
    'Should detect DEV environment by checking if baseUrl contains /dev');

  // Should set intakeBaseUrl based on isDev
  assert.ok(/const intakeBaseUrl = isDev/.test(discoveryWebAppJs),
    'Should set intakeBaseUrl conditionally based on isDev');

  console.log('  ✓ Environment detection logic present\n');
}

function testIntakeDevUrl() {
  console.log('Test: Intake DEV URL configuration');

  // Should use Intake HEAD deployment (@HEAD with /dev)
  const intakeDevPattern = /AKfycbyW_N668oLpaWMzrR1OXlYh9hTZ6Av33nCtegYUJAw\/dev/;
  assert.ok(intakeDevPattern.test(discoveryWebAppJs),
    'Should use Intake HEAD deployment with /dev path');

  console.log('  ✓ Intake DEV URL correctly configured\n');
}

function testIntakeProductionUrl() {
  console.log('Test: Intake Production URL configuration');

  // Should use Intake deployment @55 with /exec
  const intakeProdPattern = /AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg\/exec/;
  assert.ok(intakeProdPattern.test(discoveryWebAppJs),
    'Should use Intake deployment @55 with /exec path');

  // Should NOT contain /dev in Production URL
  const prodUrlMatch = discoveryWebAppJs.match(/:\s*'https:\/\/script\.google\.com.*AKfycby41BSoZbpLqdkdRG5B5hvdr7.*'/);
  assert.ok(prodUrlMatch && !prodUrlMatch[0].includes('/dev'),
    'Production URL should not contain /dev');

  console.log('  ✓ Intake Production URL correctly configured\n');
}

function testTemplateVariablePassing() {
  console.log('Test: intakeBaseUrl passed to template');

  // Should pass intakeBaseUrl to discovery template
  assert.ok(/template\.intakeBaseUrl = intakeBaseUrl/.test(discoveryWebAppJs),
    'Should pass intakeBaseUrl to discovery template');

  console.log('  ✓ intakeBaseUrl passed to template\n');
}

function testHtmlTemplateVariable() {
  console.log('Test: discovery.html receives intakeBaseUrl');

  // discovery.html should receive intakeBaseUrl variable
  assert.ok(/var intakeBaseUrl = <\?!= JSON\.stringify\(intakeBaseUrl\) \?>/.test(discoveryHtml),
    'discovery.html should receive intakeBaseUrl from template');

  console.log('  ✓ discovery.html receives intakeBaseUrl\n');
}

function testHeaderNavigationLinks() {
  console.log('Test: Header navigation uses intakeBaseUrl');

  // Submit a Demo for Review link should use intakeBaseUrl
  const submitDemoPattern = /window\.open\(intakeBaseUrl,\s*'_blank'\)/;
  assert.ok(submitDemoPattern.test(discoveryHtml),
    'Submit a Demo for Review should use intakeBaseUrl');

  // Check My Submissions link should use intakeBaseUrl + ?page=status
  const checkSubmissionsPattern = /window\.open\(intakeBaseUrl \+ '\?page=status',\s*'_blank'\)/;
  assert.ok(checkSubmissionsPattern.test(discoveryHtml),
    'Check My Submissions should use intakeBaseUrl + ?page=status');

  // Should have exactly 2 header links using intakeBaseUrl
  const headerMatches = discoveryHtml.match(/onclick="window\.open\(intakeBaseUrl[^)]*\)[^"]*"[^>]*class="navDropdownItem"/g);
  assert.ok(headerMatches && headerMatches.length === 2,
    'Should have exactly 2 header navigation links using intakeBaseUrl');

  console.log('  ✓ Header navigation links use intakeBaseUrl\n');
}

function testSidebarNavigationLinks() {
  console.log('Test: Sidebar navigation uses intakeBaseUrl');

  // Sidebar Submit a Demo link should use intakeBaseUrl
  const sidebarSubmitPattern = /onclick="window\.open\(intakeBaseUrl,\s*'_blank'\)[^"]*"[^>]*class="resourceLink"/;
  assert.ok(sidebarSubmitPattern.test(discoveryHtml),
    'Sidebar Submit a Demo should use intakeBaseUrl');

  // Sidebar Check submissions link should use intakeBaseUrl + ?page=status
  const sidebarCheckPattern = /onclick="window\.open\(intakeBaseUrl \+ '\?page=status',\s*'_blank'\)[^"]*"[^>]*class="resourceLink"/;
  assert.ok(sidebarCheckPattern.test(discoveryHtml),
    'Sidebar Check submissions should use intakeBaseUrl + ?page=status');

  // Should have exactly 2 sidebar links using intakeBaseUrl
  const sidebarMatches = discoveryHtml.match(/onclick="window\.open\(intakeBaseUrl[^)]*\)[^"]*"[^>]*class="resourceLink"/g);
  assert.ok(sidebarMatches && sidebarMatches.length === 2,
    'Should have exactly 2 sidebar resource links using intakeBaseUrl');

  console.log('  ✓ Sidebar navigation links use intakeBaseUrl\n');
}

function testNoHardcodedIntakeUrls() {
  console.log('Test: No hardcoded Intake URLs in navigation');

  // Should NOT contain hardcoded Intake exec URLs
  const hardcodedIntakePattern = /AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg\/exec/;
  assert.ok(!hardcodedIntakePattern.test(discoveryHtml),
    'discovery.html should not contain hardcoded Intake /exec URLs');

  // Should NOT contain hardcoded Intake dev URLs in HTML
  const hardcodedIntakeDevPattern = /AKfycbyW_N668oLpaWMzrR1OXlYh9hTZ6Av33nCtegYUJAw\/dev/;
  assert.ok(!hardcodedIntakeDevPattern.test(discoveryHtml),
    'discovery.html should not contain hardcoded Intake /dev URLs');

  console.log('  ✓ No hardcoded Intake URLs in discovery.html\n');
}

function testAllFourLinksUpdated() {
  console.log('Test: All four Intake links use dynamic navigation');

  // Count total onclick handlers using intakeBaseUrl
  const allIntakeLinks = discoveryHtml.match(/onclick="window\.open\(intakeBaseUrl/g);
  assert.ok(allIntakeLinks && allIntakeLinks.length === 4,
    'Should have exactly 4 navigation links using intakeBaseUrl (2 header + 2 sidebar)');

  console.log('  ✓ All four Intake links use dynamic navigation\n');
}

// Run all tests
try {
  testEnvironmentDetectionLogic();
  testIntakeDevUrl();
  testIntakeProductionUrl();
  testTemplateVariablePassing();
  testHtmlTemplateVariable();
  testHeaderNavigationLinks();
  testSidebarNavigationLinks();
  testNoHardcodedIntakeUrls();
  testAllFourLinksUpdated();

  console.log('✅ All Hub cross-app navigation tests passed');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}
