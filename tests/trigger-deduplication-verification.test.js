/**
 * Targeted Verification: Edit Trigger Deduplication
 *
 * Verifies that the Simple Trigger `onEdit` has been eliminated by renaming
 * the handler to `handleSpreadsheetEdit`, preventing duplicate execution.
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

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}: expected ${expected}, got ${actual}`);
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

  // Read RM_Triggers.js
  const triggersPath = path.join(__dirname, '..', 'RM_Triggers.js');
  const triggersContent = fs.readFileSync(triggersPath, 'utf8');

  // Test 1: No Simple Trigger function named onEdit
  test("No top-level 'function onEdit(event)' remains", () => {
    assertNotIncludes(
      triggersContent,
      'function onEdit(event)',
      "Should not have Simple Trigger function 'onEdit'"
    );
  });

  // Test 2: handleSpreadsheetEdit function exists
  test("handleSpreadsheetEdit function exists", () => {
    assertIncludes(
      triggersContent,
      'function handleSpreadsheetEdit(event)',
      "Should have renamed handler function"
    );
  });

  // Test 3: installTriggers creates handleSpreadsheetEdit trigger
  test("installTriggers creates handleSpreadsheetEdit trigger", () => {
    assertIncludes(
      triggersContent,
      'ScriptApp.newTrigger("handleSpreadsheetEdit")',
      "Should install handleSpreadsheetEdit trigger"
    );
  });

  // Test 4: installTriggers does NOT create onEdit trigger
  test("installTriggers does NOT create onEdit trigger", () => {
    const installTriggersMatch = triggersContent.match(/function installTriggers\(\)[\s\S]*?^}/m);
    if (!installTriggersMatch) {
      throw new Error("Could not find installTriggers function");
    }
    const installTriggersBody = installTriggersMatch[0];

    assertNotIncludes(
      installTriggersBody,
      'ScriptApp.newTrigger("onEdit")',
      "installTriggers should NOT create onEdit trigger"
    );
  });

  // Test 5: Request_Master edit routing preserved
  test("Request_Master edit routing preserved", () => {
    assertIncludes(
      triggersContent,
      'if (sheetName === masterSheetName)',
      "Should preserve Request_Master routing"
    );
    assertIncludes(
      triggersContent,
      'processStatusEdit(event, sheet, headerMap)',
      "Should preserve status edit handling"
    );
    assertIncludes(
      triggersContent,
      'processProdLinkEdit(event, sheet, headerMap)',
      "Should preserve prod link edit handling"
    );
  });

  // Test 6: YouTube_Responses edit routing preserved
  test("YouTube_Responses edit routing preserved", () => {
    assertIncludes(
      triggersContent,
      "if (sheetName === 'YouTube_Responses')",
      "Should preserve YouTube_Responses routing"
    );
    assertIncludes(
      triggersContent,
      'processYouTubeStatusEdit(event, sheet)',
      "Should preserve YouTube status edit handling"
    );
  });

  // Test 7: deleteAllTriggers called before creating triggers (idempotency)
  test("deleteAllTriggers ensures idempotent trigger installation", () => {
    const installTriggersMatch = triggersContent.match(/function installTriggers\(\)[\s\S]*?deleteAllTriggers\(\)/);
    assertEqual(
      installTriggersMatch !== null,
      true,
      "installTriggers should call deleteAllTriggers for idempotency"
    );
  });

  // Test 8: Error logging updated to new function name
  test("Error logging uses new function name", () => {
    assertIncludes(
      triggersContent,
      'logError("handleSpreadsheetEdit"',
      "Error logging should reference handleSpreadsheetEdit"
    );
  });

  realConsole.log(`\n✅ ${passed} passed, ${failed > 0 ? '❌ ' + failed + ' failed' : 'all tests passed'}`);
  return failed === 0;
}

if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}
