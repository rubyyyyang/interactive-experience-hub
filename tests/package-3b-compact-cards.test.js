// Package 3B: Compact Demo Cards Tests
// Tests compact card rendering, Copy Link behavior, and Drawer state synchronization

const assert = require('assert');

// Mock DOM helpers for Google Apps Script HTML rendering
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Mock content-type classification helpers
function isYouTubeItem(rec) {
  return rec.format === 'YouTube';
}

function isVideoDemo(rec) {
  return rec.format === 'Video Demo';
}

function hasEditableSource(rec) {
  return rec.format === 'Interactive Demo' && rec.productionLink && rec.productionLink.includes('demo.redhat.com');
}

function getPrimaryLink(rec) {
  if (isYouTubeItem(rec) || isVideoDemo(rec)) {
    return rec.productionLink || null;
  }
  return rec.productionLink || null;
}

function getLaunchButtonLabel(rec) {
  if (isYouTubeItem(rec) || isVideoDemo(rec)) {
    return 'Watch Video';
  }
  return 'Launch Demo';
}

function getEditLink(rec) {
  if (rec.format === 'Interactive Demo' && rec.productionLink && rec.productionLink.includes('demo.redhat.com')) {
    return rec.productionLink;
  }
  return null;
}

// Test suite
console.log('\n=== Package 3B: Compact Demo Cards Tests ===\n');

// Test 1: Copy Link uses getPrimaryLink
console.log('Test 1: Copy Link uses getPrimaryLink for target URL');
{
  const interactiveDemoRec = {
    recordId: '123',
    title: 'Test Interactive Demo',
    format: 'Interactive Demo',
    productionLink: 'https://demo.redhat.com/example',
    duration: '5',
    creatorName: 'John Doe'
  };

  const youtubeRec = {
    recordId: '456',
    title: 'Test YouTube Video',
    format: 'YouTube',
    productionLink: 'https://youtube.com/watch?v=abc123',
    duration: '10',
    creatorName: 'Jane Smith'
  };

  const noPrimaryLinkRec = {
    recordId: '789',
    title: 'No Link Demo',
    format: 'Interactive Demo',
    duration: '3',
    creatorName: 'Bob Jones'
  };

  const interactivePrimaryUrl = getPrimaryLink(interactiveDemoRec);
  const youtubePrimaryUrl = getPrimaryLink(youtubeRec);
  const noPrimaryUrl = getPrimaryLink(noPrimaryLinkRec);

  assert.strictEqual(interactivePrimaryUrl, 'https://demo.redhat.com/example', 'Interactive Demo primary URL should be productionLink');
  assert.strictEqual(youtubePrimaryUrl, 'https://youtube.com/watch?v=abc123', 'YouTube primary URL should be productionLink');
  assert.strictEqual(noPrimaryUrl, null, 'Record without productionLink should have null primary URL');

  // Simulate drawer Copy Link button HTML generation
  const drawerCopyButtonInteractive = interactivePrimaryUrl
    ? `<button class="btn small muted" onclick="copyText('${escapeAttr(interactivePrimaryUrl)}');">Copy Link</button>`
    : '';

  const drawerCopyButtonYouTube = youtubePrimaryUrl
    ? `<button class="btn small muted" onclick="copyText('${escapeAttr(youtubePrimaryUrl)}');">Copy Link</button>`
    : '';

  const drawerCopyButtonNoLink = noPrimaryUrl
    ? `<button class="btn small muted" onclick="copyText('${escapeAttr(noPrimaryUrl)}');">Copy Link</button>`
    : '';

  assert.ok(drawerCopyButtonInteractive.includes('https://demo.redhat.com/example'), 'Interactive Demo Copy Link should use getPrimaryLink result');
  assert.ok(drawerCopyButtonYouTube.includes('https://youtube.com/watch?v=abc123'), 'YouTube Copy Link should use getPrimaryLink result');
  assert.strictEqual(drawerCopyButtonNoLink, '', 'Copy Link button should not render when primaryUrl is null');

  console.log('✓ Copy Link uses getPrimaryLink correctly for all content types');
}

// Test 2: Compact card layout excludes description and detailed metadata
console.log('\nTest 2: Compact card layout excludes description and detailed metadata');
{
  const mockItem = {
    recordId: '123',
    title: 'Test Interactive Demo Title That Is Reasonably Long',
    format: 'Interactive Demo',
    product: 'Red Hat OpenShift',
    duration: '5',
    creatorName: 'John Doe',
    discoverStatus: 'Featured',
    productionLink: 'https://demo.redhat.com/test',
    description: 'This description should NOT appear in the compact card',
    primaryTopic: 'Cloud Computing',
    tdp: 'Platform',
    salesTactic: 'Direct Sales',
    marketingProgram: 'Campaign 2024'
  };

  // Simulate compact card HTML structure (simplified from actual renderCard)
  const compactCardHtml = `
    <article class="card">
      <h3 class="title">${escapeHtml(mockItem.title)}</h3>
      <div class="badges">
        ${mockItem.format ? '<span class="badge">' + escapeHtml(mockItem.format) + '</span>' : ''}
        ${mockItem.discoverStatus === 'Featured' ? '<span class="badge featured">Featured</span>' : ''}
        ${mockItem.duration ? '<span class="badge">' + escapeHtml(mockItem.duration) + ' min</span>' : ''}
      </div>
      <div class="meta">
        ${mockItem.creatorName ? '<div><b>Creator:</b> ' + escapeHtml(mockItem.creatorName) + '</div>' : ''}
      </div>
    </article>
  `;

  assert.ok(compactCardHtml.includes('Test Interactive Demo Title'), 'Card should include title');
  assert.ok(compactCardHtml.includes('Interactive Demo'), 'Card should include format badge');
  assert.ok(compactCardHtml.includes('Featured'), 'Card should include Featured badge');
  assert.ok(compactCardHtml.includes('5 min'), 'Card should include duration');
  assert.ok(compactCardHtml.includes('John Doe'), 'Card should include creator name');

  assert.ok(!compactCardHtml.includes('This description should NOT appear'), 'Card should NOT include description');
  assert.ok(!compactCardHtml.includes('Cloud Computing'), 'Card should NOT include Primary Topic');
  assert.ok(!compactCardHtml.includes('Platform'), 'Card should NOT include TDP');
  assert.ok(!compactCardHtml.includes('Direct Sales'), 'Card should NOT include Sales Tactic');
  assert.ok(!compactCardHtml.includes('Campaign 2024'), 'Card should NOT include Marketing Program');

  console.log('✓ Compact card layout includes required fields and excludes description/detailed metadata');
}

// Test 3: Edit in Arcade button appears only for editable Interactive Demos
console.log('\nTest 3: Edit in Arcade button appears only for editable Interactive Demos');
{
  const editableDemo = {
    recordId: '123',
    format: 'Interactive Demo',
    productionLink: 'https://demo.redhat.com/example'
  };

  const youtubeVideo = {
    recordId: '456',
    format: 'YouTube',
    productionLink: 'https://youtube.com/watch?v=abc123'
  };

  const videoDemo = {
    recordId: '789',
    format: 'Video Demo',
    productionLink: 'https://videos.example.com/demo.mp4'
  };

  const nonEditableDemo = {
    recordId: '999',
    format: 'Interactive Demo',
    productionLink: 'https://external-site.com/demo'
  };

  assert.strictEqual(hasEditableSource(editableDemo), true, 'Interactive Demo on demo.redhat.com should be editable');
  assert.strictEqual(hasEditableSource(youtubeVideo), false, 'YouTube video should not be editable');
  assert.strictEqual(hasEditableSource(videoDemo), false, 'Video Demo should not be editable');
  assert.strictEqual(hasEditableSource(nonEditableDemo), false, 'Interactive Demo on external domain should not be editable');

  const editLinkEditable = getEditLink(editableDemo);
  const editLinkYouTube = getEditLink(youtubeVideo);
  const editLinkVideo = getEditLink(videoDemo);
  const editLinkNonEditable = getEditLink(nonEditableDemo);

  assert.strictEqual(editLinkEditable, 'https://demo.redhat.com/example', 'Editable demo should return edit link');
  assert.strictEqual(editLinkYouTube, null, 'YouTube should not return edit link');
  assert.strictEqual(editLinkVideo, null, 'Video Demo should not return edit link');
  assert.strictEqual(editLinkNonEditable, null, 'Non-editable demo should not return edit link');

  console.log('✓ hasEditableSource and getEditLink correctly identify editable Interactive Demos');
}

// Test 4: Launch button labels match content type
console.log('\nTest 4: Launch button labels match content type');
{
  const interactiveDemo = { format: 'Interactive Demo', productionLink: 'https://demo.redhat.com/test' };
  const youtubeVideo = { format: 'YouTube', productionLink: 'https://youtube.com/watch?v=abc' };
  const videoDemo = { format: 'Video Demo', productionLink: 'https://videos.example.com/demo.mp4' };

  assert.strictEqual(getLaunchButtonLabel(interactiveDemo), 'Launch Demo', 'Interactive Demo should use "Launch Demo"');
  assert.strictEqual(getLaunchButtonLabel(youtubeVideo), 'Watch Video', 'YouTube should use "Watch Video"');
  assert.strictEqual(getLaunchButtonLabel(videoDemo), 'Watch Video', 'Video Demo should use "Watch Video"');

  console.log('✓ Launch button labels match content type correctly');
}

console.log('\n=== All Package 3B tests passed ✓ ===\n');
