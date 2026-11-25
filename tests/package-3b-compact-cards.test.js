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

  // Simulate drawer Copy Link button HTML generation (from discovery_js.html line 2678-2682)
  const drawerCopyButton = primaryUrl
    ? `<button class="btn small muted" onclick="copyText('${primaryUrl}');">Copy Link</button>`
    : '';

  assert(drawerCopyButton.includes('https://www.redhat.com/en/interactive-demos/example?intcmp='),
    'Copy Link button should use getPrimaryLink result');
  assert(drawerCopyButton.includes('7013a000003SUdsAAG'),
    'Copy Link button should include campaign tracking from getPrimaryLink');
});

// Test 11: Card rendering excludes description and detailed metadata
test('Card rendering: Excludes description and detailed metadata fields', () => {
  // Read actual card rendering from discovery_js.html
  const renderCardMatch = discoveryJsContent.match(/function renderCard\(item, currentSearchQuery\)\s*{[\s\S]+?return `[\s\S]+?<\/article>`;[\s\S]+?}/);

  assert(renderCardMatch, 'Should find renderCard function');

  const renderCardBody = renderCardMatch[0];

  // Verify description is NOT rendered in card
  assert(!renderCardBody.includes('item.description'), 'Card should not render description field');

  // Verify detailed metadata is NOT rendered in card
  assert(!renderCardBody.includes('item.primaryTopic'), 'Card should not render primaryTopic');
  assert(!renderCardBody.includes('item.tdp') || renderCardBody.includes('addCampaignTracking'), 'Card should not render TDP as visible metadata (only used for campaign tracking)');
  assert(!renderCardBody.includes('item.salesTactic'), 'Card should not render salesTactic');
  assert(!renderCardBody.includes('item.marketingProgram'), 'Card should not render marketingProgram');

  // Verify required fields ARE rendered
  assert(renderCardBody.includes('item.format'), 'Card should render format badge');
  assert(renderCardBody.includes('item.creatorName'), 'Card should render creator name');
});

console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

console.log('\n=== All Package 3B tests passed ✓ ===\n');
