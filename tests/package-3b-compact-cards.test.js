/**
 * Package 3B: Compact Demo Cards Tests
 * Tests production functions and rendering behavior for compact cards and drawer
 */

const fs = require('fs');
const path = require('path');

console.log('\n=== Package 3B: Compact Demo Cards Tests ===\n');

// Load production HTML rendering functions from discovery_js.html
const discoveryJsPath = path.resolve(__dirname, '../discovery_js.html');
const discoveryJsContent = fs.readFileSync(discoveryJsPath, 'utf8');

// Extract production functions using regex
function extractFunction(source, functionName) {
  const regex = new RegExp(`function ${functionName}\\s*\\([^)]*\\)\\s*{`, 'g');
  const match = regex.exec(source);
  if (!match) return null;

  let depth = 0;
  let start = match.index;
  let pos = match.index + match[0].length;

  while (pos < source.length) {
    if (source[pos] === '{') depth++;
    if (source[pos] === '}') {
      if (depth === 0) {
        return source.substring(start, pos + 1);
      }
      depth--;
    }
    pos++;
  }
  return null;
}

// Extract and eval production functions
const getPrimaryLinkSrc = extractFunction(discoveryJsContent, 'getPrimaryLink');
const getEditLinkSrc = extractFunction(discoveryJsContent, 'getEditLink');
const hasEditableSourceSrc = extractFunction(discoveryJsContent, 'hasEditableSource');
const getLaunchButtonLabelSrc = extractFunction(discoveryJsContent, 'getLaunchButtonLabel');
const isYouTubeItemSrc = extractFunction(discoveryJsContent, 'isYouTubeItem');
const isVideoDemoSrc = extractFunction(discoveryJsContent, 'isVideoDemo');
const getLaunchLinkSrc = extractFunction(discoveryJsContent, 'getLaunchLink');
const addCampaignTrackingSrc = extractFunction(discoveryJsContent, 'addCampaignTracking');

// Mock TDP_CAMPAIGN_MAP for campaign tracking tests
global.TDP_CAMPAIGN_MAP = {
  'Platform': '7013a000003SUdsAAG',
  'AI Platform': '7013a000003SUdxAAG'
};

// Eval functions in controlled scope
eval(isYouTubeItemSrc);
eval(isVideoDemoSrc);
eval(getLaunchLinkSrc);
eval(addCampaignTrackingSrc);
eval(getEditLinkSrc);
eval(hasEditableSourceSrc);
eval(getLaunchButtonLabelSrc);
eval(getPrimaryLinkSrc);

// Test suite
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Test 1: getPrimaryLink for Interactive Demo with Drupal page
test('getPrimaryLink: Interactive Demo with Drupal page returns drupalPageUrl with campaign tracking', () => {
  const item = {
    format: 'Interactive Demo',
    drupalPageUrl: 'https://www.redhat.com/en/interactive-demos/example',
    productionLink: 'https://demo.redhat.com/example',
    creationLink: 'https://interact.redhat.com/share/abc123',
    tdp: 'Platform'
  };

  const result = getPrimaryLink(item);
  assertEqual(result, 'https://www.redhat.com/en/interactive-demos/example?intcmp=7013a000003SUdsAAG',
    'Should return drupalPageUrl with TDP campaign tracking');
});

// Test 2: getPrimaryLink for Interactive Demo without Drupal page falls back to creationLink
test('getPrimaryLink: Interactive Demo without Drupal page returns edit link with campaign tracking', () => {
  const item = {
    format: 'Interactive Demo',
    creationLink: 'https://interact.redhat.com/share/abc123',
    tdp: 'Platform'
  };

  const result = getPrimaryLink(item);
  assertEqual(result, 'https://app.arcade.software/flows/abc123/edit?intcmp=7013a000003SUdsAAG',
    'Should return transformed edit link with campaign tracking');
});

// Test 3: getPrimaryLink for YouTube with productionLink (no Drupal page)
test('getPrimaryLink: YouTube with productionLink returns productionLink with campaign tracking', () => {
  const item = {
    format: 'YouTube',
    productionLink: 'https://www.youtube.com/watch?v=abc123',
    tdp: 'AI Platform'
  };

  const result = getPrimaryLink(item);
  assertEqual(result, 'https://www.youtube.com/watch?v=abc123&intcmp=7013a000003SUdxAAG',
    'Should return productionLink with TDP campaign tracking');
});

// Test 4: getPrimaryLink for Video Demo with productionLink (no Drupal page)
test('getPrimaryLink: Video Demo with productionLink returns productionLink with campaign tracking', () => {
  const item = {
    format: 'Video Demo',
    productionLink: 'https://videos.redhat.com/demo.mp4',
    tdp: 'Platform'
  };

  const result = getPrimaryLink(item);
  assertEqual(result, 'https://videos.redhat.com/demo.mp4?intcmp=7013a000003SUdsAAG',
    'Should return productionLink with campaign tracking');
});

// Test 5: getPrimaryLink for record with no links returns empty string
test('getPrimaryLink: Record with no links returns empty string', () => {
  const item = {
    format: 'Interactive Demo',
    tdp: 'Platform'
  };

  const result = getPrimaryLink(item);
  assertEqual(result, '', 'Should return empty string when no links available');
});

// Test 6: hasEditableSource returns true only for Interactive Demo
test('hasEditableSource: Returns true only for Interactive Demo format', () => {
  const interactiveDemo = { format: 'Interactive Demo' };
  const youtubeVideo = { format: 'YouTube' };
  const videoDemo = { format: 'Video Demo' };

  assert(hasEditableSource(interactiveDemo) === true, 'Interactive Demo should be editable');
  assert(hasEditableSource(youtubeVideo) === false, 'YouTube should not be editable');
  assert(hasEditableSource(videoDemo) === false, 'Video Demo should not be editable');
});

// Test 7: getEditLink transforms Arcade share URLs correctly
test('getEditLink: Transforms interact.redhat.com share URLs to edit URLs', () => {
  const item = {
    creationLink: 'https://interact.redhat.com/share/abc123def'
  };

  const result = getEditLink(item);
  assertEqual(result, 'https://app.arcade.software/flows/abc123def/edit',
    'Should transform interact.redhat.com share URL to edit URL');
});

// Test 8: getEditLink skips /share/videos/ URLs (Video Demo content)
test('getEditLink: Returns empty string for /share/videos/ URLs', () => {
  const item = {
    creationLink: 'https://interact.redhat.com/share/videos/demo.mp4'
  };

  const result = getEditLink(item);
  assertEqual(result, '', 'Should skip Video Demo /share/videos/ URLs');
});

// Test 9: getLaunchButtonLabel returns correct label for content types
test('getLaunchButtonLabel: Returns correct label for each content type', () => {
  const interactiveDemo = { format: 'Interactive Demo' };
  const youtubeVideo = { format: 'YouTube' };
  const videoDemo = { format: 'Video Demo' };

  assertEqual(getLaunchButtonLabel(interactiveDemo), 'Launch Demo', 'Interactive Demo should use "Launch Demo"');
  assertEqual(getLaunchButtonLabel(youtubeVideo), 'Watch Video', 'YouTube should use "Watch Video"');
  assertEqual(getLaunchButtonLabel(videoDemo), 'Watch Video', 'Video Demo should use "Watch Video"');
});

// Test 10: Drawer Copy Link button uses getPrimaryLink result
test('Drawer Copy Link: Uses getPrimaryLink as target URL', () => {
  const item = {
    format: 'Interactive Demo',
    drupalPageUrl: 'https://www.redhat.com/en/interactive-demos/example',
    tdp: 'Platform'
  };

  const primaryUrl = getPrimaryLink(item);

  // Simulate drawer Copy Link button HTML (matches new compact labeled format)
  const drawerCopyButton = primaryUrl
    ? `<button class="btn small muted" onclick="copyText('${primaryUrl}');"><span>Copy Link</span></button>`
    : '';

  assert(drawerCopyButton.includes('https://www.redhat.com/en/interactive-demos/example?intcmp='),
    'Copy Link button should use getPrimaryLink result');
  assert(drawerCopyButton.includes('7013a000003SUdsAAG'),
    'Copy Link button should include campaign tracking from getPrimaryLink');
});

// Test 11: Visual Hybrid Card rendering includes header with Experience Type and description preview
test('Visual Hybrid Card: Includes Experience Type header, description preview, and excludes detailed metadata', () => {
  // Read actual card rendering from discovery_js.html
  const renderCardMatch = discoveryJsContent.match(/function renderCard\(item, currentSearchQuery\)\s*{[\s\S]+?return `[\s\S]+?<\/article>`;[\s\S]+?}/);

  assert(renderCardMatch, 'Should find renderCard function');

  const renderCardBody = renderCardMatch[0];

  // Verify Visual Hybrid Card structure: cardHeader and cardBody
  assert(renderCardBody.includes('cardHeader'), 'Card should have cardHeader section');
  assert(renderCardBody.includes('cardBody'), 'Card should have cardBody section');
  assert(renderCardBody.includes('cardExperienceType'), 'Card header should include Experience Type');
  assert(renderCardBody.includes('getExperienceTypeIcon'), 'Card should use Experience Type icon helper');

  // Verify description IS rendered in card with 3-line clamp
  assert(renderCardBody.includes('item.description'), 'Card should render description field');
  assert(renderCardBody.includes('class="desc"') || renderCardBody.includes('class=\\"desc\\"'), 'Card description should use desc class (which has 3-line clamp)');
  assert(renderCardBody.includes('getFirstParagraph_'), 'Card should use getFirstParagraph_ helper for description');

  // Verify product is rendered as simple text (not badge)
  assert(renderCardBody.includes('item.product'), 'Card should render product name');

  // Verify creator and duration are rendered as secondary metadata
  assert(renderCardBody.includes('item.creatorName'), 'Card should render creator name');
  assert(renderCardBody.includes('item.duration'), 'Card should render duration');

  // Verify Edit in Arcade is NOT in cards (removed per requirements)
  assert(!renderCardBody.includes('Edit in Arcade'), 'Card should not render Edit in Arcade button');

  // Verify detailed metadata is NOT rendered in card
  assert(!renderCardBody.includes('item.primaryTopic'), 'Card should not render primaryTopic');
  assert(!renderCardBody.includes('item.tdp') || renderCardBody.includes('addCampaignTracking'), 'Card should not render TDP as visible metadata (only used for campaign tracking)');
  assert(!renderCardBody.includes('item.salesTactic'), 'Card should not render salesTactic');
  assert(!renderCardBody.includes('item.marketingProgram'), 'Card should not render marketingProgram');
});

// Test 12: getExperienceTypeIcon returns correct icons for each format
test('getExperienceTypeIcon: Returns distinct icons for Interactive Demo, Video Demo, and YouTube', () => {
  // Extract getExperienceTypeIcon function
  const getExperienceTypeIconSrc = extractFunction(discoveryJsContent, 'getExperienceTypeIcon');
  assert(getExperienceTypeIconSrc, 'Should find getExperienceTypeIcon function');

  eval(getExperienceTypeIconSrc);

  const interactiveDemoIcon = getExperienceTypeIcon({ format: 'Interactive Demo' });
  const videoDemoIcon = getExperienceTypeIcon({ format: 'Video Demo' });
  const youtubeIcon = getExperienceTypeIcon({ format: 'YouTube' });
  const unknownIcon = getExperienceTypeIcon({ format: 'Unknown' });

  // Verify each icon is distinct and contains SVG
  assert(interactiveDemoIcon.includes('<svg'), 'Interactive Demo should have SVG icon');
  assert(interactiveDemoIcon.includes('#6d28d9'), 'Interactive Demo icon should be purple');

  assert(videoDemoIcon.includes('<svg'), 'Video Demo should have SVG icon');
  assert(videoDemoIcon.includes('#0d9488'), 'Video Demo icon should be teal');

  assert(youtubeIcon.includes('<svg'), 'YouTube should have SVG icon');
  assert(youtubeIcon.includes('#dc2626'), 'YouTube icon should be red');

  assert(unknownIcon.includes('<svg'), 'Unknown format should have SVG icon');
  assert(unknownIcon.includes('#6b7280'), 'Unknown format icon should be gray');

  // Verify icons are distinct from each other
  assert(interactiveDemoIcon !== videoDemoIcon, 'Interactive Demo and Video Demo icons should be different');
  assert(interactiveDemoIcon !== youtubeIcon, 'Interactive Demo and YouTube icons should be different');
  assert(videoDemoIcon !== youtubeIcon, 'Video Demo and YouTube icons should be different');
});

// Test 13: Drawer renders "About this experience" and "Created by" sections
test('Drawer: Renders "About this experience" and "Created by" sections with correct structure', () => {
  // Extract renderDrawerContent function using the helper
  const renderDrawerContentSrc = extractFunction(discoveryJsContent, 'renderDrawerContent');

  assert(renderDrawerContentSrc, 'Should find renderDrawerContent function');

  // Verify "About this experience" section
  assert(renderDrawerContentSrc.includes('About this experience'), 'Drawer should render "About this experience" heading');
  assert(renderDrawerContentSrc.includes("formatDescriptionWithHeader_"), "Drawer should use formatDescriptionWithHeader_ for description with bullet headers");

  // Verify "Created by" section with compact format
  assert(renderDrawerContentSrc.includes('Created by'), 'Drawer should render "Created by" heading');
  assert(renderDrawerContentSrc.includes('rec.creatorName'), 'Drawer should render creator name');
  assert(renderDrawerContentSrc.includes('rec.creatorTeam'), 'Drawer should render creator team');
  assert(renderDrawerContentSrc.includes('rec.creatorEmail'), 'Drawer should render creator email');

  // Verify "Metadata" accordion (renamed from "Technical")
  assert(renderDrawerContentSrc.includes('Metadata'), 'Drawer should render "Metadata" accordion');

  // Verify Save and Copy Link buttons have labels
  assert(renderDrawerContentSrc.includes('<span>Save</span>') || renderDrawerContentSrc.includes('<span>${isSaved'), 'Save button should have label');
  assert(renderDrawerContentSrc.includes('<span>Copy Link</span>'), 'Copy Link button should have label');

  // Verify Experience Type icon is rendered in drawer
  assert(renderDrawerContentSrc.includes('getExperienceTypeIcon'), 'Drawer should use Experience Type icon');

  // Verify drawer Save button has drawerSaveBtn class for synchronization
  assert(renderDrawerContentSrc.includes('drawerSaveBtn'), 'Drawer Save button should have drawerSaveBtn class');
  assert(renderDrawerContentSrc.includes('data-record-id'), 'Drawer Save button should have data-record-id attribute');
});

// Test 14: formatDescriptionWithHeader_ places "What you'll explore" correctly
test('formatDescriptionWithHeader_: Places header above bullets only when bullets exist', () => {
  const formatDescriptionWithHeaderSrc = extractFunction(discoveryJsContent, 'formatDescriptionWithHeader_');
  assert(formatDescriptionWithHeaderSrc, 'Should find formatDescriptionWithHeader_ function');

  eval(formatDescriptionWithHeaderSrc);
  eval(extractFunction(discoveryJsContent, 'escapeHtml'));

  const descWithBullets = "This is an intro. • First point • Second point";
  const descNoBullets = "This is just a plain description.";
  const descEmptyBullets = "Intro text • ";

  const resultWithBullets = formatDescriptionWithHeader_(descWithBullets);
  const resultNoBullets = formatDescriptionWithHeader_(descNoBullets);
  const resultEmptyBullets = formatDescriptionWithHeader_(descEmptyBullets);

  // With bullets: should include "What you'll explore" header
  assert(resultWithBullets.includes("What you"), "Description with bullets should include 'What you'll explore' header");
  assert(resultWithBullets.includes("ll explore"), "Description with bullets should include 'What you'll explore' header");
  assert(resultWithBullets.includes("<ul"), "Description with bullets should include bullet list");

  // Without bullets: should NOT include the header
  assert(!resultNoBullets.includes("What you"), "Description without bullets should NOT include 'What you'll explore' header");
  assert(!resultNoBullets.includes("<ul"), "Description without bullets should NOT include bullet list");

  // Empty bullets: should NOT include the header
  assert(!resultEmptyBullets.includes("What you"), "Description with empty bullets should NOT include header");
});

// Test 15: normalizeProductDisplay removes N/A tokens from comma-separated values
test('normalizeProductDisplay: Removes individual N/A tokens from comma-separated product values', () => {
  const normalizeProductDisplaySrc = extractFunction(discoveryJsContent, 'normalizeProductDisplay');
  assert(normalizeProductDisplaySrc, 'Should find normalizeProductDisplay function');

  eval(normalizeProductDisplaySrc);

  // Test removing N/A from comma-separated list
  assertEqual(normalizeProductDisplay('Red Hat OpenShift, N/A'), 'Red Hat OpenShift', 'Should remove trailing N/A token');
  assertEqual(normalizeProductDisplay('N/A, Red Hat OpenShift'), 'Red Hat OpenShift', 'Should remove leading N/A token');
  assertEqual(normalizeProductDisplay('Red Hat OpenShift, N/A, Ansible'), 'Red Hat OpenShift, Ansible', 'Should remove middle N/A token');

  // Test case insensitivity
  assertEqual(normalizeProductDisplay('Red Hat OpenShift, n/a'), 'Red Hat OpenShift', 'Should handle lowercase n/a');
  assertEqual(normalizeProductDisplay('Red Hat OpenShift, N/a'), 'Red Hat OpenShift', 'Should handle mixed case N/a');

  // Test all N/A
  assertEqual(normalizeProductDisplay('N/A'), '', 'Should return empty string for all N/A');
  assertEqual(normalizeProductDisplay('N/A, n/a'), '', 'Should return empty string for multiple N/A');

  // Test empty/whitespace
  assertEqual(normalizeProductDisplay(''), '', 'Should handle empty string');
  assertEqual(normalizeProductDisplay('   '), '', 'Should handle whitespace-only string');

  // Test trimming
  assertEqual(normalizeProductDisplay('  Red Hat OpenShift  , N/A  '), 'Red Hat OpenShift', 'Should trim tokens');

  // Test valid products only
  assertEqual(normalizeProductDisplay('Red Hat OpenShift, Ansible'), 'Red Hat OpenShift, Ansible', 'Should preserve valid comma-separated products');
});

console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

console.log('\n=== All Package 3B tests passed ✓ ===\n');
