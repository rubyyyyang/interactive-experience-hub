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

// Test 1: Quick Filter toggle behavior
function testQuickFilterToggle() {
  console.log('Test 1: Quick Filter toggle behavior');

  // Reset state
  filterState.products = [];

  // Toggle RHEL Quick Filter on
  toggleQuickFilter('Red Hat Enterprise Linux');

  const productsAfterToggle = filterState.products;
  assert(productsAfterToggle.length > 0, 'FAIL: Products should contain RHEL variants');
  assert(FILTERS_HAVE_PENDING_CHANGES === true, 'FAIL: Should mark pending changes');
  assert(document.querySelector('.instant-pill')?.classList.contains('active'), 'FAIL: Pill should be active');

  // Toggle off
  toggleQuickFilter('Red Hat Enterprise Linux');
  assert(filterState.products.length === 0, 'FAIL: Products should be empty after toggle off');

  console.log('✓ Test 1 passed');
}

// Test 2: Browse by Experience sets format filter only
function testBrowseByExperience() {
  console.log('Test 2: Browse by Experience preserves other filters');

  // Set up initial state with search and product filter
  document.getElementById('globalSearch').value = 'kubernetes';
  filterState.products = ['Red Hat OpenShift'];
  filterState.formats = [];

  // Click Interactive Demos
  browseByExperience('Interactive Demo');

  assert(document.getElementById('globalSearch').value === 'kubernetes', 'FAIL: Search should be preserved');
  assert(filterState.products.includes('Red Hat OpenShift'), 'FAIL: Product filter should be preserved');
  assert(filterState.formats.length === 1 && filterState.formats[0] === 'Interactive Demo', 'FAIL: Format should be set');
  assert(FILTERS_HAVE_PENDING_CHANGES === true, 'FAIL: Should mark pending changes');

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

// Test 4: No reload before Apply
function testNoReloadBeforeApply() {
  console.log('Test 4: No reload before Apply');

  const initialRequestSeq = RESULTS_REQUEST_SEQ;

  // Click Quick Filter
  toggleQuickFilter('Ansible Automation Platform');
  assert(RESULTS_REQUEST_SEQ === initialRequestSeq, 'FAIL: Quick Filter should not trigger reload');

  // Type in search
  document.getElementById('globalSearch').value = 'automation';
  handleSearchInput();
  assert(RESULTS_REQUEST_SEQ === initialRequestSeq, 'FAIL: Typing should not trigger reload');

  // Click Browse
  browseByExperience('Video Demo');
  assert(RESULTS_REQUEST_SEQ === initialRequestSeq, 'FAIL: Browse should not trigger reload');

  console.log('✓ Test 4 passed');
}

// Test 5: Pending indication on Apply button
function testPendingIndication() {
  console.log('Test 5: Pending indication on Apply button');

  const applyBtn = document.getElementById('applySearchBtn');

  // Reset
  FILTERS_HAVE_PENDING_CHANGES = false;
  applyBtn.textContent = 'Apply';

  assert(applyBtn.textContent === 'Apply', 'FAIL: Button should start as "Apply"');

  // Make a change
  toggleQuickFilter('AI');

  assert(applyBtn.textContent === 'Apply*', 'FAIL: Button should change to "Apply*" when pending');
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

// Run all tests
function runPackage3ATests() {
  console.log('=== Package 3A Regression Tests ===\n');

  try {
    testQuickFilterToggle();
    testBrowseByExperience();
    testAdvancedFilterSync();
    testNoReloadBeforeApply();
    testPendingIndication();
    testMoreFiltersCollapsed();
    testAppliedFilterRemoval();

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
