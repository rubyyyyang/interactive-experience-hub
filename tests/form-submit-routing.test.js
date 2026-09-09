/**
 * Form Submit Routing Tests
 *
 * Verifies onFormSubmit routing logic in RM_Triggers.js
 */

const fs = require('fs');
const path = require('path');

// Load FORM_SHEET_NAME from email_gen.js
const emailGenPath = path.join(__dirname, '..', 'email_gen.js');
const emailGenContent = fs.readFileSync(emailGenPath, 'utf8');
const formSheetNameMatch = emailGenContent.match(/var FORM_SHEET_NAME = ['"]([^'"]+)['"]/);
const FORM_SHEET_NAME = formSheetNameMatch ? formSheetNameMatch[1] : 'lifecycle_raw_updates';

// Load onFormSubmit routing from RM_Triggers.js
const triggersPath = path.join(__dirname, '..', 'RM_Triggers.js');
const triggersContent = fs.readFileSync(triggersPath, 'utf8');

// Test results
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

console.log('\n=== FORM SUBMIT ROUTING TESTS ===\n');

// Test 1: Verify FORM_SHEET_NAME constant is used
const usesConstant = triggersContent.includes('sheetName === FORM_SHEET_NAME');
assert(
  usesConstant,
  'onFormSubmit uses FORM_SHEET_NAME constant (not hardcoded string)'
);

// Test 2: Verify lifecycle_raw_updates routes to onUpdatePlanFormSubmit
const lifecycleRouting = triggersContent.match(/sheetName === FORM_SHEET_NAME\s*\)\s*\{[^}]*onUpdatePlanFormSubmit\(event\)/s);
assert(
  lifecycleRouting !== null,
  `${FORM_SHEET_NAME} routes to onUpdatePlanFormSubmit(event)`
);

// Test 3: Verify no typeof guard around onUpdatePlanFormSubmit
const hasTypeofGuard = triggersContent.includes('typeof onUpdatePlanFormSubmit');
assert(
  !hasTypeofGuard,
  'No typeof guard around onUpdatePlanFormSubmit (function is required)'
);

// Test 4: Verify Request_Form_Raw routes to processRequestFormSubmission
const requestRouting = triggersContent.match(/sheetName === ["']Request_Form_Raw["']\s*\)\s*\{[^}]*processRequestFormSubmission\(event\)/s);
assert(
  requestRouting !== null,
  'Request_Form_Raw routes to processRequestFormSubmission(event)'
);

// Test 5: Verify Creator_Form_Raw routes to processCreatorFormSubmission
const creatorRouting = triggersContent.match(/sheetName === getCreatorFormSheetName\(\)\s*\)\s*\{[^}]*processCreatorFormSubmission\(event\)/s);
assert(
  creatorRouting !== null,
  'Creator_Form_Raw routes to processCreatorFormSubmission(event)'
);

// Test 6: Verify three routing branches exist
const requestBranch = triggersContent.includes('sheetName === "Request_Form_Raw"');
const creatorBranch = triggersContent.includes('sheetName === getCreatorFormSheetName()');
const lifecycleBranch = triggersContent.includes('sheetName === FORM_SHEET_NAME');
assert(
  requestBranch && creatorBranch && lifecycleBranch,
  'All three routing branches exist (Request_Form_Raw, Creator_Form_Raw, FORM_SHEET_NAME)'
);

console.log('\n=== TEST SUMMARY ===');
console.log(`Total: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n❌ Some tests failed\n');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed\n');
  process.exit(0);
}
