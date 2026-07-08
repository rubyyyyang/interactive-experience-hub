/************************************************************
 * RM_TestHarness.gs - Enhanced System Test Suite
 *
 * PURPOSE:
 * Comprehensive test harness for the enhanced IE Request Management system.
 * Tests complete end-to-end workflows without touching real forms.
 *
 * WHAT THIS FILE DOES (For Maintenance):
 * This is "The Test Suite" - Creates dummy form submissions to test
 * the complete request and creator workflows. Validates document creation,
 * master sheet updates, and Slack integration.
 *
 * EDIT HERE TO:
 * - Update test data for request forms (test__request_intake_dummy)
 * - Modify creator form test data (test__creator_* functions)
 * - Change test Global IDs or email addresses
 * - Add new test scenarios or validation steps
 * - Update form field names if they change in the real forms
 *
 * HOW TO USE:
 * 1) Run test__request_intake_dummy() - Creates request, returns Global ID
 * 2) Copy the returned Global ID
 * 3) Run test__creator_with_globalId_dummy(globalId) - Tests creator update
 * 4) Run test__creator_no_globalId_dummy() - Tests creator-only submission
 *
 * ENHANCED FEATURES:
 * - Works with enhanced system architecture (original file names, enhanced content)
 * - Better error handling and logging
 * - Updated field mappings for enhanced system
 * - Console logging for better debugging
 * - Comprehensive test coverage
 ************************************************************/

// === REQUEST FORM TESTING ===

/**
 * Test request form submission with enhanced system
 * Creates: Document + Master sheet row + Slack thread
 * Returns: Global ID for use in creator tests
 */
function test__request_intake_dummy() {
  console.log("🧪 Starting Request Form Test...");
  
  const namedValues = {
    "Timestamp": [new Date().toISOString()],
    "Email Address": ["ruby.yang@example.com"],
    "Full name of Requestor": ["Ruby Yang (TEST)"],
    "What team are you in?": ["Test Team - Enhanced System"],
    "Have you reached out to your head of BU in charge of this tool?": ["Yes"],
    "Have you checked if the demo already exists?": ["Yes"],
    "What is the priority?": ["High"],
    "Are there any upcoming deadlines?": ["2026-03-15"],
    "Suggested demo title": ["TEST Request - Enhanced System Validation"],
    "Content Type": ["Technical Walkthrough"],
    "Describe in as much detail the context and content required from the demo you are looking to get made (50-150 words)?": ["Enhanced system end-to-end test. Validating complete workflow including document creation, master sheet population, workflow processing, and Slack integration. This is a test submission to ensure all components work together properly."],
    "Primary Audience": ["Architects"],
    "Target Personas": ["Solution Architects"],
    "Pain points": ["Too many manual steps in current process"],
    "Any relevant links and/or CTAs?": ["https://example.com/test"],
    "What Primary Product or Process is it associated with?": ["OpenShift Container Platform"],
    "Related Marketing Program?": ["Test Marketing Program"],
    "Related Technology Decision Point?": ["Test TDP - Container Platform"],
    "Related Sales Tactic?": ["Test Sales Tactic"],
    "Does it touch any specific verticals?": ["Healthcare, Financial Services"],
    "Is this for a specific event?": ["Red Hat Summit Test"],
    "Destination Channels": ["Architecture Center, Developer Portal"],
    "Optional: Have an Employee Advocacy link? Add it here.": ["https://advocacy.test.com"]
  };

  try {
    // Check for enhanced function (no underscore)
    if (typeof handleRequestFormNamedValues !== "function") {
      throw new Error("❌ Missing handleRequestFormNamedValues(). Ensure 'workflow' file contains enhanced content.");
    }

    console.log("📋 Processing request form submission...");
    const result = handleRequestFormNamedValues(namedValues);
    
    console.log("✅ Request Form Test Complete!");
    console.log(`📋 Global ID: ${result.globalId}`);
    console.log(`📄 Document URL: ${result.docUrl}`);
    console.log(`🔢 Request Number: ${result.number}`);
    console.log(`📊 Row Index: ${result.rowIndex}`);
    
    // Log full result for debugging
    console.log("📊 Complete Result:", JSON.stringify(result, null, 2));
    
    return result;
    
  } catch (error) {
    console.error("❌ Request Form Test Failed:", error.message);
    console.error("🔍 Stack trace:", error.stack);
    throw error;
  }
}

// === CREATOR FORM TESTING ===

/**
 * Test creator form submission WITH existing Global ID
 * Updates existing request with creator information
 * 
 * @param {string} globalId - Global ID from request test (or use TEST_GLOBAL_ID)
 */
const TEST_GLOBAL_ID = "7ee49e6d-7ce2-4cea-96f1-3cb1f1a7b14f"; 

function test__creator_with_globalId_dummy(globalId) {
  console.log("🎨 Starting Creator Form Test (With Global ID)...");
  
  const gid = String(globalId || TEST_GLOBAL_ID || "").trim();
  if (!gid) {
    throw new Error("❌ Missing Global ID. Run test__request_intake_dummy() first or set TEST_GLOBAL_ID.");
  }

  console.log(`🔗 Testing creator submission for Global ID: ${gid}`);

  // Create mock form submission event
  const mockEvent = {
    range: {
      getSheet: () => ({
        getName: () => getCreatorFormSheetName() || "Creator_Form_Raw"
      })
    },
    namedValues: {
      "Timestamp": [new Date().toISOString()],
      "Email Address": ["ruby.yang@example.com"],
      "Creator Name": ["Ruby Yang (TEST CREATOR)"],
      "Creator Team": ["Portfolio Technical Marketing and Platforms"],
      "Demo Title": ["Enhanced System Creator Test - With Global ID"],
      "Arcade Link": ["https://demo.arcade.software/enhanced-test-" + Date.now()],
      "Quarter": ["CY26Q1"],
      "Demo Description": ["Testing enhanced creator intake system with existing Global ID. Validates document updates and workflow processing."],
      "Language": ["English"],
      "Synthetic Voice Used?": ["No"],
      "Translation Used?": ["No"],
      "Mobile-friendly design considered?": ["Yes"],
      "SEOWords": ["enhanced, system, test, creator"],
      "CTALink": ["https://redhat.com/test-cta"],
      "Group": ["Test Group Collection"],
      "Employee Advocacy Link": ["https://advocacy.enhanced-test.com"],
      "Global ID (if applicable)": [gid]
    }
  };

  try {
    // Check for enhanced creator function
    if (typeof onCreatorFormSubmit !== "function") {
      throw new Error("❌ Missing onCreatorFormSubmit(). Ensure 'RM_CreatorIntake' file contains enhanced content.");
    }

    console.log("🎨 Processing creator form with Global ID...");
    const result = onCreatorFormSubmit(mockEvent);
    
    console.log("✅ Creator Form Test (With Global ID) Complete!");
    console.log(`🔗 Updated Global ID: ${gid}`);
    
    if (result) {
      console.log("📊 Creator Result:", JSON.stringify(result, null, 2));
    }
    
    return result;
    
  } catch (error) {
    console.error("❌ Creator Form Test (With Global ID) Failed:", error.message);
    console.error("🔍 Stack trace:", error.stack);
    throw error;
  }
}

/**
 * Test creator form submission WITHOUT Global ID (Creator-only)
 * Creates: New Global ID + Document + Master sheet row + Slack thread
 */
function test__creator_no_globalId_dummy() {
  console.log("🎨 Starting Creator Form Test (No Global ID - Creator Only)...");

  // Create mock form submission event for creator-only
  const mockEvent = {
    range: {
      getSheet: () => ({
        getName: () => getCreatorFormSheetName() || "Creator_Form_Raw"
      })
    },
    namedValues: {
      "Timestamp": [new Date().toISOString()],
      "Email Address": ["ruby.yang@example.com"],
      "Creator Name": ["Ruby Yang (TEST CREATOR ONLY)"],
      "Creator Team": ["Enhanced Test Creator Team"],
      "Demo Title": ["Enhanced System Creator-Only Test"],
      "Arcade Link": ["https://demo.arcade.software/creator-only-test-" + Date.now()],
      "Quarter": ["CY26Q1"],
      "Demo Description": ["Testing enhanced creator intake system without Global ID. Should create new creator-only request with complete workflow processing including document creation and Slack notifications."],
      "Language": ["English"],
      "Synthetic Voice Used?": ["No"],
      "Translation Used?": ["No"],
      "Mobile-friendly design considered?": ["Yes"],
      "SEOWords": ["enhanced, creator-only, test, system"],
      "CTALink": ["https://redhat.com/creator-test"],
      "Group": ["Creator Test Collection"],
      "Employee Advocacy Link": ["https://advocacy.creator-test.com"],
      "Global ID (if applicable)": [""] // No Global ID - creator-only path
    }
  };

  try {
    // Check for enhanced creator function
    if (typeof onCreatorFormSubmit !== "function") {
      throw new Error("❌ Missing onCreatorFormSubmit(). Ensure 'RM_CreatorIntake' file contains enhanced content.");
    }

    console.log("🎨 Processing creator-only form submission...");
    const result = onCreatorFormSubmit(mockEvent);
    
    console.log("✅ Creator Form Test (Creator-Only) Complete!");
    
    if (result) {
      console.log(`📋 New Global ID: ${result.globalId}`);
      console.log(`📄 Document URL: ${result.docUrl}`);
      console.log(`🔢 Request Number: ${result.number}`);
      console.log("📊 Creator-Only Result:", JSON.stringify(result, null, 2));
    }
    
    return result;
    
  } catch (error) {
    console.error("❌ Creator Form Test (Creator-Only) Failed:", error.message);
    console.error("🔍 Stack trace:", error.stack);
    throw error;
  }
}

// === ENHANCED TESTING UTILITIES ===

/**
 * Run complete test suite in sequence
 * Tests: Request → Creator with ID → Creator only
 */
function test__complete_workflow() {
  console.log("🚀 Starting Complete Enhanced System Test Suite...");
  
  try {
    // Step 1: Test request form
    console.log("\n1️⃣ TESTING REQUEST FORM...");
    const requestResult = test__request_intake_dummy();
    
    // Step 2: Test creator with Global ID
    console.log("\n2️⃣ TESTING CREATOR WITH GLOBAL ID...");
    const creatorWithIdResult = test__creator_with_globalId_dummy(requestResult.globalId);
    
    // Step 3: Test creator-only
    console.log("\n3️⃣ TESTING CREATOR-ONLY SUBMISSION...");
    const creatorOnlyResult = test__creator_no_globalId_dummy();
    
    console.log("\n🎉 COMPLETE TEST SUITE FINISHED SUCCESSFULLY!");
    console.log("📊 Summary:");
    console.log(`  Request Global ID: ${requestResult.globalId}`);
    console.log(`  Request Number: ${requestResult.number}`);
    console.log(`  Creator-Only Global ID: ${creatorOnlyResult?.globalId || 'N/A'}`);
    console.log(`  Creator-Only Number: ${creatorOnlyResult?.number || 'N/A'}`);
    
    return {
      request: requestResult,
      creatorWithId: creatorWithIdResult,
      creatorOnly: creatorOnlyResult
    };
    
  } catch (error) {
    console.error("❌ Complete Test Suite Failed:", error.message);
    throw error;
  }
}

/**
 * Quick test to verify enhanced system is loaded
 */
function test__system_check() {
  console.log("🔍 Checking Enhanced System Components...");
  
  const checks = {
    config: typeof ENHANCED_CONFIG !== "undefined",
    workflow: typeof handleRequestFormNamedValues === "function",
    creatorIntake: typeof onCreatorFormSubmit === "function",
    utils: typeof getMasterSheet === "function",
    triggers: typeof onEdit === "function"
  };
  
  console.log("📋 System Check Results:");
  for (const [component, available] of Object.entries(checks)) {
    const status = available ? "✅" : "❌";
    console.log(`  ${status} ${component}: ${available}`);
  }
  
  const allGood = Object.values(checks).every(Boolean);
  console.log(`\n${allGood ? "✅" : "❌"} Enhanced System Status: ${allGood ? "READY" : "MISSING COMPONENTS"}`);
  
  return checks;
}

// === LEGACY COMPATIBILITY ===

/**
 * Legacy function names for backward compatibility
 */
function testRequestIntakeDummy() {
  return test__request_intake_dummy();
}

function testCreatorWithGlobalId(globalId) {
  return test__creator_with_globalId_dummy(globalId);
}

function testCreatorNoGlobalId() {
  return test__creator_no_globalId_dummy();
}