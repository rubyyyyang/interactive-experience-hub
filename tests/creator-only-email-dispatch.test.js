/**
 * Targeted Verification: Creator-Only Submission Email Dispatch
 *
 * Verifies that the `created_new_creator_only` path actually reaches
 * the creator SUBMISSION_RECEIVED email dispatcher.
 */

const fs = require('fs');
const path = require('path');

const realConsole = console;

function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      realConsole.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      realConsole.error(`❌ ${name}: ${error.message}`);
      failed++;
    }
  }

  function assertIncludes(text, substring, message) {
    if (!text.includes(substring)) {
      throw new Error(`${message}: expected to include "${substring}"`);
    }
  }

  function assertNotIncludes(text, substring, message) {
    if (text.includes(substring)) {
      throw new Error(`${message}: should NOT include "${substring}"`);
    }
  }

  // Read RM_CreatorIntake.js
  const intakePath = path.join(__dirname, '..', 'RM_CreatorIntake.js');
  const intakeContent = fs.readFileSync(intakePath, 'utf8');

  // Test 1: handleCreatorWithoutGlobalId calls sendArcadeSubmissionReceivedEmail
  test("handleCreatorWithoutGlobalId calls sendArcadeSubmissionReceivedEmail", () => {
    const funcMatch = intakeContent.match(/function handleCreatorWithoutGlobalId[\s\S]*?^}/m);
    if (!funcMatch) throw new Error("Could not find handleCreatorWithoutGlobalId");

    const funcBody = funcMatch[0];
    assertIncludes(
      funcBody,
      'sendArcadeSubmissionReceivedEmail(upsertResult.number, upsertResult.rowIndex)',
      "Should call sendArcadeSubmissionReceivedEmail with number and rowIndex"
    );
  });

  // Test 2: Call happens after upsertResult exists
  test("Email call happens after upsertMasterRowByGlobalId", () => {
    const funcMatch = intakeContent.match(/function handleCreatorWithoutGlobalId[\s\S]*?^}/m);
    const funcBody = funcMatch[0];

    const upsertIndex = funcBody.indexOf('upsertMasterRowByGlobalId');
    const emailIndex = funcBody.indexOf('sendArcadeSubmissionReceivedEmail');

    if (upsertIndex === -1) throw new Error("upsertMasterRowByGlobalId not found");
    if (emailIndex === -1) throw new Error("sendArcadeSubmissionReceivedEmail not found");
    if (emailIndex < upsertIndex) {
      throw new Error("Email call should come AFTER upsert");
    }
  });

  // Test 3: Call happens after workflow processing
  test("Email call happens after handleRequestMasterByGlobalId", () => {
    const funcMatch = intakeContent.match(/function handleCreatorWithoutGlobalId[\s\S]*?^}/m);
    const funcBody = funcMatch[0];

    const workflowIndex = funcBody.indexOf('handleRequestMasterByGlobalId');
    const emailIndex = funcBody.indexOf('sendArcadeSubmissionReceivedEmail');

    if (workflowIndex === -1) throw new Error("handleRequestMasterByGlobalId not found");
    if (emailIndex === -1) throw new Error("sendArcadeSubmissionReceivedEmail not found");
    if (emailIndex < workflowIndex) {
      throw new Error("Email call should come AFTER workflow processing");
    }
  });

  // Test 4: Call happens BEFORE logWorkflowEvent creator_only_submission_created
  test("Email call happens before creator_only_submission_created log", () => {
    const funcMatch = intakeContent.match(/function handleCreatorWithoutGlobalId[\s\S]*?^}/m);
    const funcBody = funcMatch[0];

    const emailIndex = funcBody.indexOf('sendArcadeSubmissionReceivedEmail');
    const logIndex = funcBody.indexOf('creator_only_submission_created');

    if (emailIndex === -1) throw new Error("sendArcadeSubmissionReceivedEmail not found");
    if (logIndex === -1) throw new Error("creator_only_submission_created log not found");
    if (emailIndex > logIndex) {
      throw new Error("Email call should come BEFORE creator_only_submission_created log");
    }
  });

  // Test 5: No typeof guard blocks the call
  test("No typeof guard blocks sendArcadeSubmissionReceivedEmail call", () => {
    const funcMatch = intakeContent.match(/function handleCreatorWithoutGlobalId[\s\S]*?^}/m);
    const funcBody = funcMatch[0];

    // Extract the section around sendArcadeSubmissionReceivedEmail
    const emailCallIndex = funcBody.indexOf('sendArcadeSubmissionReceivedEmail');
    const beforeCall = funcBody.substring(Math.max(0, emailCallIndex - 200), emailCallIndex);

    assertNotIncludes(
      beforeCall,
      'if (typeof sendArcadeSubmissionReceivedEmail',
      "Should NOT have typeof guard immediately before call"
    );
  });

  // Test 6: sendArcadeSubmissionReceivedEmail has lifecycle logging
  test("sendArcadeSubmissionReceivedEmail logs lifecycle events", () => {
    const funcMatch = intakeContent.match(/function sendArcadeSubmissionReceivedEmail[\s\S]*?^}/m);
    if (!funcMatch) throw new Error("sendArcadeSubmissionReceivedEmail not found");

    const funcBody = funcMatch[0];

    assertIncludes(
      funcBody,
      'creator_submission_email_attempt',
      "Should log email attempt"
    );

    assertIncludes(
      funcBody,
      'creator_submission_email_dispatched',
      "Should log successful dispatch"
    );

    assertIncludes(
      funcBody,
      'creator_submission_email_skipped',
      "Should log skip conditions"
    );

    assertIncludes(
      funcBody,
      'creator_submission_email_failed',
      "Should log failures"
    );
  });

  // Test 7: sendArcadeSubmissionReceivedEmail calls dispatchCreatorLifecycleNotification
  test("sendArcadeSubmissionReceivedEmail calls dispatcher", () => {
    const funcMatch = intakeContent.match(/function sendArcadeSubmissionReceivedEmail[\s\S]*?^}/m);
    const funcBody = funcMatch[0];

    assertIncludes(
      funcBody,
      'dispatchCreatorLifecycleNotification(context)',
      "Should call dispatchCreatorLifecycleNotification"
    );
  });

  // Test 8: No typeof guard blocks dispatchCreatorLifecycleNotification
  test("No typeof guard blocks dispatchCreatorLifecycleNotification", () => {
    const funcMatch = intakeContent.match(/function sendArcadeSubmissionReceivedEmail[\s\S]*?^}/m);
    const funcBody = funcMatch[0];

    // Extract the section around dispatchCreatorLifecycleNotification
    const dispatchIndex = funcBody.indexOf('dispatchCreatorLifecycleNotification');
    const beforeDispatch = funcBody.substring(Math.max(0, dispatchIndex - 200), dispatchIndex);

    assertNotIncludes(
      beforeDispatch,
      'if (typeof dispatchCreatorLifecycleNotification',
      "Should NOT have typeof guard immediately before dispatcher call"
    );
  });

  realConsole.log(`\n✅ ${passed} passed, ${failed > 0 ? '❌ ' + failed + ' failed' : 'all tests passed'}`);
  return failed === 0;
}

if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}
