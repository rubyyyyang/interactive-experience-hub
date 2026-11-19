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

  assert.ok(/isDev = baseUrl\.indexOf\('\/dev'\) > -1/.test(discoveryWebAppJs),
    'Should detect DEV environment by checking if baseUrl contains /dev');

  assert.ok(/const intakeBaseUrl = isDev/.test(discoveryWebAppJs),
    'Should set intakeBaseUrl conditionally based on isDev');

  console.log('  ✓ Environment detection logic present\n');
}

function testIntakeDevUrl() {
  console.log('Test: Intake DEV URL configuration');

  const intakeDevPattern = /AKfycbyW_N668oLpaWMzrR1OXlYh9hTZ6Av33nCtegYUJAw\/dev/;
  assert.ok(intakeDevPattern.test(discoveryWebAppJs),
    'Should use Intake HEAD deployment with /dev path');

  console.log('  ✓ Intake DEV URL correctly configured\n');
}

function testIntakeProductionUrl() {
  console.log('Test: Intake Production URL configuration');

  const intakeProdPattern = /AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg\/exec/;
  assert.ok(intakeProdPattern.test(discoveryWebAppJs),
    'Should use Intake deployment @55 with /exec path');

  const prodUrlMatch = discoveryWebAppJs.match(/:\s*'https:\/\/script\.google\.com.*AKfycby41BSoZbpLqdkdRG5B5hvdr7.*'/);
  assert.ok(prodUrlMatch && !prodUrlMatch[0].includes('/dev'),
    'Production URL should not contain /dev');

  console.log('  ✓ Intake Production URL correctly configured\n');
}

function testTemplateVariablePassing() {
  console.log('Test: intakeBaseUrl passed to template');

  assert.ok(/template\.intakeBaseUrl = intakeBaseUrl/.test(discoveryWebAppJs),
    'Should pass intakeBaseUrl to discovery template');

  console.log('  ✓ intakeBaseUrl passed to template\n');
}

function testHtmlTemplateVariable() {
  console.log('Test: discovery.html uses intakeBaseUrl in anchors');

  assert.ok(/href="<\?= intakeBaseUrl \?>"/.test(discoveryHtml),
    'discovery.html should use <?= intakeBaseUrl ?> in href attributes');

  assert.ok(/href="<\?= intakeBaseUrl \?>\?page=status"/.test(discoveryHtml),
    'discovery.html should use <?= intakeBaseUrl ?>?page=status for tracker links');

  console.log('  ✓ discovery.html uses intakeBaseUrl in anchors\n');
}

function testHeaderNavigationLinks() {
  console.log('Test: Header navigation uses native anchors');

  const headerPattern = /<a [^>]*href="<\?= intakeBaseUrl \?>[^"]*"[^>]*class="navDropdownItem"[^>]*>/g;
  const headerMatches = discoveryHtml.match(headerPattern);
  assert.ok(headerMatches && headerMatches.length === 2,
    'Should have exactly 2 header navigation links using intakeBaseUrl');

  headerMatches.forEach((link, idx) => {
    assert.ok(/target="_blank"/.test(link),
      `Header link ${idx + 1} should have target="_blank"`);
    assert.ok(/rel="noopener"/.test(link),
      `Header link ${idx + 1} should have rel="noopener"`);
  });

  const baseUrlLink = /<a [^>]*href="<\?= intakeBaseUrl \?>"[^>]*class="navDropdownItem"/;
  const trackerLink = /<a [^>]*href="<\?= intakeBaseUrl \?>\?page=status"[^>]*class="navDropdownItem"/;
  assert.ok(baseUrlLink.test(discoveryHtml), 'Should have header link to base Intake URL');
  assert.ok(trackerLink.test(discoveryHtml), 'Should have header link to tracker URL');

  console.log('  ✓ Header navigation uses native anchors with noopener\n');
}

function testSidebarNavigationLinks() {
  console.log('Test: Sidebar navigation uses native anchors');

  const sidebarPattern = /<a [^>]*href="<\?= intakeBaseUrl \?>[^"]*"[^>]*class="resourceLink"[^>]*>/g;
  const sidebarMatches = discoveryHtml.match(sidebarPattern);
  assert.ok(sidebarMatches && sidebarMatches.length === 2,
    'Should have exactly 2 sidebar resource links using intakeBaseUrl');

  sidebarMatches.forEach((link, idx) => {
    assert.ok(/target="_blank"/.test(link),
      `Sidebar link ${idx + 1} should have target="_blank"`);
    assert.ok(/rel="noopener"/.test(link),
      `Sidebar link ${idx + 1} should have rel="noopener"`);
  });

  const baseUrlLink = /<a [^>]*href="<\?= intakeBaseUrl \?>"[^>]*class="resourceLink"/;
  const trackerLink = /<a [^>]*href="<\?= intakeBaseUrl \?>\?page=status"[^>]*class="resourceLink"/;
  assert.ok(baseUrlLink.test(discoveryHtml), 'Should have sidebar link to base Intake URL');
  assert.ok(trackerLink.test(discoveryHtml), 'Should have sidebar link to tracker URL');

  console.log('  ✓ Sidebar navigation uses native anchors with noopener\n');
}

function testNoHardcodedIntakeUrls() {
  console.log('Test: No hardcoded Intake URLs or onclick handlers');

  const hardcodedIntakePattern = /AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg\/exec/;
  assert.ok(!hardcodedIntakePattern.test(discoveryHtml),
    'discovery.html should not contain hardcoded Intake /exec URLs');

  const hardcodedIntakeDevPattern = /AKfycbyW_N668oLpaWMzrR1OXlYh9hTZ6Av33nCtegYUJAw\/dev/;
  assert.ok(!hardcodedIntakeDevPattern.test(discoveryHtml),
    'discovery.html should not contain hardcoded Intake /dev URLs');

  assert.ok(!/window\.open\(intakeBaseUrl/.test(discoveryHtml),
    'Should use native anchors, not window.open() for Intake navigation');

  console.log('  ✓ No hardcoded URLs or onclick handlers\n');
}

function testAllFourLinksUpdated() {
  console.log('Test: All four Intake links use native anchors');

  const allIntakeLinks = discoveryHtml.match(/href="<\?= intakeBaseUrl \?>/g);
  assert.ok(allIntakeLinks && allIntakeLinks.length === 4,
    'Should have exactly 4 native anchor links using <?= intakeBaseUrl ?> (2 header + 2 sidebar)');

  const noopenerLinks = discoveryHtml.match(/href="<\?= intakeBaseUrl \?>[^"]*"[^>]*target="_blank"[^>]*rel="noopener"/g);
  assert.ok(noopenerLinks && noopenerLinks.length === 4,
    'All 4 Intake links should have target="_blank" rel="noopener"');

  console.log('  ✓ All four Intake links use native anchors with noopener\n');
}

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
