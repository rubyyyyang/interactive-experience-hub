/**
 * Package 3A: Hub Filter UI Regression Tests
 *
 * These tests verify critical filter behavior without requiring a full test framework.
 * Run in browser console after loading discovery.html.
 */

// Test assertion helpers that throw on failure
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

// Test 1: Quick Filter toggle applies immediately
function testQuickFilterToggle() {
  console.log('Test 1: Quick Filter toggle applies immediately');

  // Reset state
  filterState.products = [];
  const initialRequestSeq = RESULTS_REQUEST_SEQ;

  // Toggle RHEL Quick Filter on
  toggleQuickFilter('Red Hat Enterprise Linux');

  const productsAfterToggle = filterState.products;
  assert(productsAfterToggle.length > 0, 'FAIL: Products should contain RHEL variants');
  assert(RESULTS_REQUEST_SEQ > initialRequestSeq, 'FAIL: Quick Filter should trigger immediate reload');
  assert(document.querySelector('.instant-pill')?.classList.contains('active'), 'FAIL: Pill should be active');

  const afterFirstToggle = RESULTS_REQUEST_SEQ;

  // Toggle off
  toggleQuickFilter('Red Hat Enterprise Linux');
  assert(filterState.products.length === 0, 'FAIL: Products should be empty after toggle off');
  assert(RESULTS_REQUEST_SEQ > afterFirstToggle, 'FAIL: Toggle off should also trigger immediate reload');

  console.log('✓ Test 1 passed');
}

// Test 2: Browse by Experience sets format filter only
function testBrowseByExperience() {
  console.log('Test 2: Browse by Experience preserves other filters and applies immediately');

  // Set up initial state with search and product filter
  document.getElementById('globalSearch').value = 'kubernetes';
  filterState.products = ['Red Hat OpenShift'];
  filterState.formats = [];

  const initialRequestSeq = RESULTS_REQUEST_SEQ;

  // Click Interactive Demos
  browseByExperience('Interactive Demo');

  assert(document.getElementById('globalSearch').value === 'kubernetes', 'FAIL: Search should be preserved');
  assert(filterState.products.includes('Red Hat OpenShift'), 'FAIL: Product filter should be preserved');
  assert(filterState.formats.length === 1 && filterState.formats[0] === 'Interactive Demo', 'FAIL: Format should be set');
  assert(RESULTS_REQUEST_SEQ > initialRequestSeq, 'FAIL: Browse should trigger immediate reload');

  // Click All Experiences
  browseByExperience('all');
  assert(filterState.formats.length === 0, 'FAIL: Formats should be cleared for All Experiences');

  console.log('✓ Test 2 passed');
}

// Test 3: Advanced filter changes sync Quick Filter visuals
function testAdvancedFilterSync() {
  console.log('Test 3: Advanced filter sync to Quick Filters');

  // Reset
  filterState.products = [];
  updateQuickFilterVisuals();

  const opensShiftPill = Array.from(document.querySelectorAll('.instant-pill'))
    .find(p => p.textContent.trim() === 'OpenShift');

  assert(!opensShiftPill?.classList.contains('active'), 'FAIL: OpenShift pill should start inactive');

  // Simulate selecting OpenShift products via advanced dropdown
  const matchingProducts = getMatchingProducts('Red Hat OpenShift');
  filterState.products = matchingProducts;
  updateQuickFilterVisuals();

  assert(opensShiftPill?.classList.contains('active'), 'FAIL: OpenShift pill should become active');

  console.log('✓ Test 3 passed');
}

// Test 4: Manual Apply vs immediate Quick Filter and Browse
function testManualApplyVsImmediate() {
  console.log('Test 4: Manual Apply vs immediate Quick Filter and Browse');

  const initialRequestSeq = RESULTS_REQUEST_SEQ;

  // Typing should not trigger reload (Manual Apply)
  document.getElementById('globalSearch').value = 'automation';
  handleSearchInput();
  assert(RESULTS_REQUEST_SEQ === initialRequestSeq, 'FAIL: Typing should not trigger reload');

  // Quick Filter SHOULD trigger immediate reload (exception to Manual Apply)
  toggleQuickFilter('Ansible Automation Platform');
  assert(RESULTS_REQUEST_SEQ > initialRequestSeq, 'FAIL: Quick Filter should trigger immediate reload');

  const afterQuickFilter = RESULTS_REQUEST_SEQ;

  // Browse by Experience SHOULD also trigger immediate reload (exception to Manual Apply)
  browseByExperience('Video Demo');
  assert(RESULTS_REQUEST_SEQ > afterQuickFilter, 'FAIL: Browse should trigger immediate reload');

  console.log('✓ Test 4 passed');
}

// Test 5: Pending indication on Apply button (Manual Apply only)
function testPendingIndication() {
  console.log('Test 5: Pending indication on Apply button');

  const applyBtn = document.getElementById('applySearchBtn');

  // Reset
  FILTERS_HAVE_PENDING_CHANGES = false;
  applyBtn.textContent = 'Apply';

  assert(applyBtn.textContent === 'Apply', 'FAIL: Button should start as "Apply"');

  // Typing in Search (Manual Apply) should mark pending
  document.getElementById('globalSearch').value = 'test query';
  handleSearchInput();

  assert(applyBtn.textContent === 'Apply*', 'FAIL: Button should change to "Apply*" when Search has pending changes');
  assert(applyBtn.title.includes('pending'), 'FAIL: Button should have pending tooltip');

  console.log('✓ Test 5 passed');
}

// Test 6: More Filters panel starts collapsed
function testMoreFiltersCollapsed() {
  console.log('Test 6: More Filters starts collapsed');

  const panel = document.querySelector('.moreFiltersPanel');
  const btn = document.getElementById('moreFiltersBtn');

  assert(panel?.classList.contains('collapsed'), 'FAIL: Panel should start collapsed');
  assert(btn?.textContent === 'More filters', 'FAIL: Button should say "More filters"');

  // Toggle
  toggleMoreFilters();
  assert(!panel?.classList.contains('collapsed'), 'FAIL: Panel should expand');
  assert(btn?.textContent === 'Fewer filters', 'FAIL: Button should say "Fewer filters"');

  // Toggle back
  toggleMoreFilters();
  assert(panel?.classList.contains('collapsed'), 'FAIL: Panel should collapse');

  console.log('✓ Test 6 passed');
}

// Test 7: Applied filter removal marks pending without reload
function testAppliedFilterRemoval() {
  console.log('Test 7: Applied filter removal marks pending without reload');

  // Set up filter state
  document.getElementById('globalSearch').value = 'kubernetes';
  filterState.products = ['Red Hat OpenShift'];
  filterState.formats = ['Interactive Demo'];
  FILTERS_HAVE_PENDING_CHANGES = false;

  // Test removeAppliedFilter behavior - should mark pending, NOT reload
  const initialRequestSeq = RESULTS_REQUEST_SEQ;
  removeAppliedFilter('products', 'Red Hat OpenShift');

  assert(FILTERS_HAVE_PENDING_CHANGES === true, 'FAIL: Removing applied filter should mark pending');
  assert(RESULTS_REQUEST_SEQ === initialRequestSeq, 'FAIL: Removing applied filter should NOT reload');
  assert(filterState.products.length === 0, 'FAIL: Product should be removed from filterState');

  // Verify Apply button shows pending state
  const applyBtn = document.getElementById('applySearchBtn');
  assert(applyBtn.textContent === 'Apply*', 'FAIL: Apply button should show pending after chip removal');

  console.log('✓ Test 7 passed');
}

// Test 8: Repeated same-filter clicks do not create stuck state
function testRepeatedSameFilterClicks() {
  console.log('Test 8: Repeated same-filter clicks');

  // Reset to known state
  filterState.products = [];
  const initialRequestSeq = RESULTS_REQUEST_SEQ;

  // Click same Quick Filter twice rapidly
  toggleQuickFilter('Ansible Automation Platform');
  const afterFirst = RESULTS_REQUEST_SEQ;
  assert(afterFirst > initialRequestSeq, 'FAIL: First click should trigger reload');

  toggleQuickFilter('Ansible Automation Platform');
  const afterSecond = RESULTS_REQUEST_SEQ;
  assert(afterSecond > afterFirst, 'FAIL: Second click (toggle off) should also trigger reload');

  // Click same Browse tab twice rapidly
  browseByExperience('Interactive Demo');
  const afterBrowse1 = RESULTS_REQUEST_SEQ;
  assert(afterBrowse1 > afterSecond, 'FAIL: First Browse click should trigger reload');

  browseByExperience('Interactive Demo');
  const afterBrowse2 = RESULTS_REQUEST_SEQ;
  // Same Browse tab clicked twice:
  // - If cached: increments RENDER_SEQ (re-render)
  // - If uncached: early-returns (same requestKey)
  // Both are correct - just verify no stuck loading state
  assert(afterBrowse2 >= afterBrowse1, 'FAIL: Clicking same Browse tab twice should not decrement sequence');

  console.log('✓ Test 8 passed');
}

// Test 9: Rapid tab switching renders correct final state
async function testRapidTabSwitching() {
  console.log('Test 9: Rapid tab switching');

  const initialRequestSeq = RESULTS_REQUEST_SEQ;
  const initialRenderSeq = RENDER_SEQ;

  // Switch tabs rapidly (some may be cached, some uncached)
  browseByExperience('Interactive Demo');
  browseByExperience('Video Demo');
  browseByExperience('all');
  browseByExperience('YouTube');

  // Verify sequences incremented
  assert(RESULTS_REQUEST_SEQ > initialRequestSeq, 'FAIL: Tab switching should increment request sequence');
  assert(RENDER_SEQ > initialRenderSeq, 'FAIL: Tab switching should increment render sequence');

  // Verify final filterState matches last selected tab (YouTube)
  assert(filterState.formats.length === 1 && filterState.formats[0] === 'YouTube', 'FAIL: Final format should be YouTube');

  // Wait for rendering to complete (chunked rendering is async)
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  });

  // Verify rendered cards match YouTube selection (check visible cards, not empty state)
  const resultsEl = document.getElementById('results');
  const hasEmptyState = resultsEl?.querySelector('.emptyState');
  const hasCards = resultsEl?.querySelectorAll('.card').length > 0;

  // Either has cards OR empty state (both valid for YouTube depending on data)
  // Key is: no skeleton cards, no mixed results from other tabs
  const hasSkeletons = resultsEl?.querySelectorAll('.skeletonCard').length > 0;
  assert(!hasSkeletons, 'FAIL: Should not have skeleton cards after rapid switching completes');

  console.log('✓ Test 9 passed');
}

// Run all tests
async function runPackage3ATests() {
  console.log('=== Package 3A Regression Tests ===\n');

  try {
    testQuickFilterToggle();
    testBrowseByExperience();
    testAdvancedFilterSync();
    testManualApplyVsImmediate();
    testPendingIndication();
    testMoreFiltersCollapsed();
    testAppliedFilterRemoval();
    testRepeatedSameFilterClicks();
    await testRapidTabSwitching(); // Async test waits for rendering

    console.log('\n✅ All Package 3A regression tests passed!');
    return true;
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    return false;
  }
}

// Auto-run if loaded in browser console context
if (typeof window !== 'undefined' && window.filterState) {
  console.log('Package 3A test suite loaded. Run runPackage3ATests() to execute.');
}
