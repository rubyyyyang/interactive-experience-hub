/**
 * Hub Lifecycle Preservation Test
 * Verifies runPerformanceLabels() never overwrites lifecycle workflow states
 */

const assert = require('assert');
const fs = require('fs');

console.log('Running Hub lifecycle preservation test...\n');

const perfJs = fs.readFileSync('/Users/rubyyang/Arcade Finder/RM_Performance.js', 'utf8');

function testPreservesPendingReview() {
  console.log('Test: Preserves "Pending review" regardless of recommendation');

  // Should preserve Pending review unconditionally
  const preservesPendingReview = /currentStatus === 'Pending review'[\s\S]{0,300}actionStatus = currentStatus/.test(perfJs);

  // Should NOT have age-based logic for Pending review
  const hasAgeCheck = /currentStatus === 'Pending review'[\s\S]{0,200}sixMonthsAgo/.test(perfJs);

  assert.ok(preservesPendingReview, 'Should preserve Pending review state');
  assert.strictEqual(hasAgeCheck, false, 'Should NOT check age for Pending review');

  console.log('  ✓ Pending review preserved\n');
}

function testPreservesFollowUpNeeded() {
  console.log('Test: Preserves "Follow-up needed" regardless of recommendation');

  // Should preserve Follow-up needed unconditionally
  const preservesFollowUp = /currentStatus === 'Follow-up needed'[\s\S]{0,300}actionStatus = currentStatus/.test(perfJs);

  // Should NOT have age-based logic for Follow-up needed
  const hasAgeCheck = /currentStatus === 'Follow-up needed'[\s\S]{0,200}sixMonthsAgo/.test(perfJs);

  assert.ok(preservesFollowUp, 'Should preserve Follow-up needed state');
  assert.strictEqual(hasAgeCheck, false, 'Should NOT check age for Follow-up needed');

  console.log('  ✓ Follow-up needed preserved\n');
}

function testPreservesCompleteUnconditionally() {
  console.log('Test: Preserves "Complete" unconditionally (no age check, no date check)');

  // Should preserve Complete in same conditional as Pending review
  const preservesComplete = /currentStatus === 'Pending review'[\s\S]{0,200}currentStatus === 'Complete'[\s\S]{0,200}actionStatus = currentStatus/.test(perfJs);

  // Should NOT have separate Complete handling with age logic
  const hasSeparateCompleteLogic = /else if \(currentStatus === 'Complete'\)[\s\S]{0,300}sixMonthsAgo/.test(perfJs);

  assert.ok(preservesComplete, 'Should preserve Complete state unconditionally');
  assert.strictEqual(hasSeparateCompleteLogic, false, 'Should NOT have age-based Complete logic');

  console.log('  ✓ Complete preserved unconditionally\n');
}

function testNoSixMonthLogic() {
  console.log('Test: No six-month aging logic in Action Status assignment');

  // Should NOT have sixMonthsAgo variable in action status logic
  const hasSixMonthVar = /var sixMonthsAgo = new Date\(\)/.test(perfJs);

  assert.strictEqual(hasSixMonthVar, false, 'Should NOT have six-month aging logic');

  console.log('  ✓ No age-based reopening\n');
}

function testNoCompletedDateCheck() {
  console.log('Test: No Action Completed Date check in Action Status assignment');

  // Should NOT read completedDateValues in action status logic
  const hasCompletedDateCheck = /currentCompletedDateValues/.test(perfJs);

  assert.strictEqual(hasCompletedDateCheck, false, 'Should NOT check Action Completed Date');

  console.log('  ✓ No date dependency\n');
}

function testRetiredContentSkipped() {
  console.log('Test: Retired content skipped by classifyRow_');

  // Should skip retired status
  const skipsRetired = /rowStatus === ENHANCED_CONFIG\.STATUS\.DEMO_RETIRED[\s\S]{0,100}makeSkipResult_/.test(perfJs);

  assert.ok(skipsRetired, 'Should skip Retired status rows');

  console.log('  ✓ Retired content skipped\n');
}

function testActionNeededStillAssigned() {
  console.log('Test: Action needed still assigned for eligible content');

  // Should assign Action needed when no current status and has recommendation
  const assignsActionNeeded = /assigned[\s\S]{0,200}actionStatus = 'Action needed'/.test(perfJs);

  assert.ok(assignsActionNeeded, 'Should assign Action needed for eligible content');

  console.log('  ✓ Action needed assignment works\n');
}

function testNoRecommendationPreservesState() {
  console.log('Test: No recommendation preserves workflow states');

  // When no recommendation (c.action check), should still preserve states
  const preservesWhenNoRec = /\} else \{[\s\S]{0,300}currentStatus === 'Pending review'[\s\S]{0,200}currentStatus === 'Complete'[\s\S]{0,200}actionStatus = currentStatus/.test(perfJs);

  assert.ok(preservesWhenNoRec, 'Should preserve states when no recommendation');

  console.log('  ✓ States preserved without recommendation\n');
}

// Run all tests
try {
  testPreservesPendingReview();
  testPreservesFollowUpNeeded();
  testPreservesCompleteUnconditionally();
  testNoSixMonthLogic();
  testNoCompletedDateCheck();
  testRetiredContentSkipped();
  testActionNeededStillAssigned();
  testNoRecommendationPreservesState();

  console.log('✅ All Hub lifecycle preservation tests passed');
  console.log('\n📋 Verified behavior:');
  console.log('  ✓ Pending review stays Pending review');
  console.log('  ✓ Follow-up needed stays Follow-up needed');
  console.log('  ✓ Complete stays Complete (no age check, no date check)');
  console.log('  ✓ Retired content skipped entirely');
  console.log('  ✓ Action needed assigned to eligible new content');
  console.log('  ✓ States preserved when recommendation changes or disappears');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}
