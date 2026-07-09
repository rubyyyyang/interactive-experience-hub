/************************************************************
 * Enhanced_CreatorIntake.gs - Enhanced Creator Form Handling
 *
 * WHAT THIS FILE DOES:
 * Processes creator form submissions.
 *
 * TWO MAIN PATHS:
 * 1. Has Global ID  -> update existing request
 * 2. No Global ID   -> create creator-only request
 ************************************************************/

/* =========================
   CACHE / CONFIG
========================= */

const creatorFormCache = new Map();
const CREATOR_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const CREATOR_CONFIG = {
  FIELD_MAPPINGS: {
    TIMESTAMP: "Timestamp",
    EMAIL: "Email Address",
    CREATOR_NAME: "Creator Name(s)",
    CREATOR_TEAM: "Creator Team(s)",
    DEMO_TITLE: "Final Demo Title",
    CREATION_LINK: "Creation Link",
    CONTENT_TYPE: "Content Type",
    QUARTER: "What quarter was this content created in?",
    DEMO_DESCRIPTION_WITHOUT_GID: "Interactive Experience Description (50-150 words)",
    DEMO_DESCRIPTION_WITH_GID: "Description (50-150 words)",
    LANGUAGE: "Language",
    CTA_LINK: "Links for next step call to action",
    SEO_WORDS: "Keywords for SEO",
    VERTICAL: "Vertical",
    EVENT: "Is this for a specific event or project?",
    PRIMARY_PRODUCT: "Primary product featured?",
    OTHER_PRODUCTS: "Optional: Other related products?",
    TDP: "Related Technology Decision Point?",
    SALES_TACTIC: "Related Sales Tactic?",
    MARKETING_PROGRAM: "Related Marketing Program?",
    SYNTHETIC_VOICE: "Synthetic Voice Used?",
    TRANSLATION: "Translation Used?",
    MOBILE_FRIENDLY: "Mobile-friendly design considered?",
    GROUP: "Optional: Should this IE be grouped with another or part of a larger collection? If yes, add the name of the IE it belongs with.",
    EMPLOYEE_ADVOCACY: "Optional: Have an Employee Advocacy link? Add it here.",
    GLOBAL_ID: "Global ID"
  },

  JIRA: {
    WEBHOOK_URL_DEFAULT: "",
    PROJECT_KEY: "DEMO",
    ISSUE_TYPE: "Task"
  }
};

/* =========================
   MAIN ENTRY
========================= */
function onCreatorFormSubmit(event) {
  try {
    if (!event || !event.range) {
      throw new Error("Invalid form submission event");
    }

    const sheetName = event.range.getSheet().getName();
    const expectedSheetName = getCreatorFormSheetName();

    if (sheetName !== expectedSheetName) {
      console.log(`Ignoring form submission from sheet: ${sheetName}, expected: ${expectedSheetName}`);
      return;
    }

    if (isDuplicateSubmission(event)) {
      console.log("Duplicate submission detected, skipping processing");
      return;
    }

    const formData = extractCreatorFormData(event);

    let result;
    if (formData.globalId && formData.globalId.trim()) {
      result = handleCreatorWithExistingGlobalId(formData);
    } else {
      result = handleCreatorWithoutGlobalId(formData);
    }

    sendJiraNotification(formData, result);

    logWorkflowEvent("creator_form_processed", {
      hasGlobalId: !!formData.globalId,
      creatorName: formData.creatorName,
      result
    });

    return result;

  } catch (error) {
    logError("onCreatorFormSubmit", error, {
      event: event ? { sheetName: event.range?.getSheet()?.getName() } : null
    });
    throw error;
  }
}

/* =========================
   DEDUP / EXTRACTION
========================= */

function isDuplicateSubmission(event) {
  try {
    const submissionHash = createSubmissionHash(event);

    const cached = creatorFormCache.get(submissionHash);
    if (cached && (Date.now() - cached.timestamp) < CREATOR_CACHE_TTL) {
      return true;
    }

    creatorFormCache.set(submissionHash, {
      timestamp: Date.now(),
      processed: true
    });

    cleanupCreatorFormCache();
    return false;

  } catch (error) {
    logError("isDuplicateSubmission", error);
    return false;
  }
}

function createSubmissionHash(event) {
  const values = event.namedValues;
  const hashData = [
    values["Email Address"]?.[0] || "",
    values["Creator Name(s)"]?.[0] || "",
    values["Final Demo Title"]?.[0] || "",
    values["Creation Link"]?.[0] || "",
    values["Timestamp"]?.[0] || ""
  ].join("|");

  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hashData)
    .map(byte => (byte + 256).toString(16).slice(1))
    .join("");
}

function cleanupCreatorFormCache() {
  const now = Date.now();
  for (const [key, value] of creatorFormCache.entries()) {
    if ((now - value.timestamp) > CREATOR_CACHE_TTL) {
      creatorFormCache.delete(key);
    }
  }
}
function extractCreatorFormData(event) {
  const sheet = event.range.getSheet();
  const rowIndex = event.range.getRow();
  const lastCol = sheet.getLastColumn();

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
  const rowValues = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  const getAllNonEmptyByHeader = (headerName) => {
    const results = [];
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === headerName) {
        const value = rowValues[i];
        const text = value == null ? "" : String(value).trim();
        if (text !== "") {
          results.push(text);
        }
      }
    }
    return results;
  };

  const getLastNonEmptyByHeader = (headerName) => {
    const results = getAllNonEmptyByHeader(headerName);
    return results.length ? results[results.length - 1] : "";
  };

  const getAnyByHeaders = (headerNames) => {
    for (const name of headerNames) {
      const value = getLastNonEmptyByHeader(name);
      if (value) return value;
    }
    return "";
  };

  // Merge duplicate multi-select values like Language
  const mergeDuplicateMultiSelectValues = (headerName) => {
    const allValues = getAllNonEmptyByHeader(headerName);
    if (!allValues.length) return "";

    const seen = new Set();
    const merged = [];

    allValues.forEach(value => {
      String(value)
        .split(",")
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(item => {
          const key = item.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(item);
          }
        });
    });

    return merged.join(", ");
  };

  const globalIdRaw = getAnyByHeaders([
    "Global ID",
    "Global ID (if applicable)"
  ]);

  const data = {
    timestamp: getLastNonEmptyByHeader("Timestamp"),
    creatorEmail: getLastNonEmptyByHeader("Email Address"),

    creatorName: getLastNonEmptyByHeader("Creator Name(s)"),
    creatorTeam: getLastNonEmptyByHeader("Creator Team(s)"),
    finalDemoTitle: getLastNonEmptyByHeader("Final Demo Title"),
    creationLink: getAnyByHeaders([
      "Creation Link",
      "Creation Link "
    ]),

    contentType: getLastNonEmptyByHeader("Content Type"),
    quarter: getLastNonEmptyByHeader("What quarter was this content created in?"),

    demoDescription: getAnyByHeaders([
      "Interactive Experience Description (50-150 words)",
      "Description (50-150 words)"
    ]),

    // IMPORTANT: merge duplicate Language columns instead of taking only the last one
    language: mergeDuplicateMultiSelectValues("Language"),

    ctaLink: getLastNonEmptyByHeader("Links for next step call to action"),
    seoWords: getLastNonEmptyByHeader("Keywords for SEO"),
    vertical: getLastNonEmptyByHeader("Vertical"),
    event: getLastNonEmptyByHeader("Is this for a specific event or project?"),
    primaryProduct: getLastNonEmptyByHeader("Primary product featured?"),
    otherProducts: getAnyByHeaders([
      "Optional: Other related products?",
      "Other related products?"
    ]),
    tdp: getLastNonEmptyByHeader("Related Technology Decision Point?"),
    salesTactic: getLastNonEmptyByHeader("Related Sales Tactic?"),
    marketingProgram: getLastNonEmptyByHeader("Related Marketing Program?"),
    syntheticVoice: getLastNonEmptyByHeader("Synthetic Voice Used?"),
    translation: getLastNonEmptyByHeader("Translation Used?"),
    mobileFriendly: getLastNonEmptyByHeader("Mobile-friendly design considered?"),
    creatorEmployeeAdvocacy: getLastNonEmptyByHeader("Optional: Have an Employee Advocacy link? Add it here."),
    group: getLastNonEmptyByHeader("Optional: Should this IE be grouped with another or part of a larger collection? If yes, add the name of the IE it belongs with."),
    duration: getLastNonEmptyByHeader("Duration"),
    descriptionForSeo: getLastNonEmptyByHeader("Description for SEO"),

    globalId: normalizeString(globalIdRaw).replace(/^'/, "")
  };

  if (!data.creatorName && !data.creatorEmail) {
    throw new Error("Creator name or email is required");
  }

  if (!data.finalDemoTitle && !data.creationLink) {
    throw new Error("Demo title or creation link is required");
  }

  return data;
}

/* =========================
   PATH 1: EXISTING GLOBAL ID
========================= */

function handleCreatorWithExistingGlobalId(formData) {
  try {
    console.log(`Processing creator submission for existing Global ID: ${formData.globalId}`);

    const existingRequest = getMasterRowByGlobalId(formData.globalId);
    if (!existingRequest || existingRequest.rowIndex === -1) {
      console.log(`No existing request found for Global ID: ${formData.globalId}. Treating as new creator-only submission.`);
      return handleCreatorWithoutGlobalId(formData);
    }

    const creatorPayload = buildCreatorPayload(formData);
    const upsertResult = upsertMasterRowByGlobalId(formData.globalId, creatorPayload);

    if (upsertResult.rowIndex && typeof syncRequestMasterRowToVersion === "function") {
      try {
        syncRequestMasterRowToVersion(upsertResult.rowIndex);
        console.log(`✅ Version sync triggered for row ${upsertResult.rowIndex} after creator submission with Global ID`);
      } catch (error) {
        logError("handleCreatorWithGlobalId_version_sync", error, {
          globalId: formData.globalId,
          rowIndex: upsertResult.rowIndex
        });
      }
    }

    updateRequestDocumentWithCreatorInfo(existingRequest, formData);

    const workflowResult = handleRequestMasterByGlobalId(formData.globalId);

    logWorkflowEvent("creator_updated_existing_request", {
      globalId: formData.globalId,
      creatorName: formData.creatorName,
      number: upsertResult.number
    });

    return {
      globalId: formData.globalId,
      number: upsertResult.number,
      action: "updated_existing_request",
      workflow: workflowResult,
      ...upsertResult
    };

  } catch (error) {
    logError("handleCreatorWithExistingGlobalId", error, formData);
    throw error;
  }
}
function buildCreatorPayload(formData) {
  const now = new Date();

  return {
    [ENHANCED_CONFIG.COLUMNS.CREATOR_NAME]: formData.creatorName,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_EMAIL]: formData.creatorEmail,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM]: formData.creatorTeam,
    [ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE]: formData.finalDemoTitle,
    [ENHANCED_CONFIG.COLUMNS.CREATION_LINK]: formData.creationLink,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_SUBMITTED_TS]: formData.timestamp || now,
    [ENHANCED_CONFIG.COLUMNS.QUARTER]: formData.quarter,
    [ENHANCED_CONFIG.COLUMNS.DEMO_DESCRIPTION]: formData.demoDescription,
    [ENHANCED_CONFIG.COLUMNS.LANGUAGE]: formData.language,
    [ENHANCED_CONFIG.COLUMNS.SEO_WORDS]: formData.seoWords,
    [ENHANCED_CONFIG.COLUMNS.SYNTHETIC_VOICE]: formData.syntheticVoice,
    [ENHANCED_CONFIG.COLUMNS.TRANSLATION]: formData.translation,
    [ENHANCED_CONFIG.COLUMNS.MOBILE_FRIENDLY]: formData.mobileFriendly,
    [ENHANCED_CONFIG.COLUMNS.CTA_LINK]: formData.ctaLink,
    [ENHANCED_CONFIG.COLUMNS.GROUP]: formData.group,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_EMPLOYEE_ADVOC]: formData.creatorEmployeeAdvocacy,
    [ENHANCED_CONFIG.COLUMNS.DURATION]: formData.duration,
    [ENHANCED_CONFIG.COLUMNS.DESCRIPTION_FOR_SEO]: formData.descriptionForSeo,

    [ENHANCED_CONFIG.COLUMNS.CONTENT_TYPE]: formData.contentType,
    [ENHANCED_CONFIG.COLUMNS.PRIMARY_PRODUCT]: formData.primaryProduct,
    [ENHANCED_CONFIG.COLUMNS.PRODUCT]: formData.otherProducts,
    [ENHANCED_CONFIG.COLUMNS.VERTICALS]: formData.vertical,
    [ENHANCED_CONFIG.COLUMNS.EVENT]: formData.event,
    [ENHANCED_CONFIG.COLUMNS.TDP]: formData.tdp,
    [ENHANCED_CONFIG.COLUMNS.SALES_TACTIC]: formData.salesTactic,
    [ENHANCED_CONFIG.COLUMNS.MARKETING_PROGRAM]: formData.marketingProgram,

    [ENHANCED_CONFIG.COLUMNS.STATUS]: ENHANCED_CONFIG.STATUS.IE_RECEIVED,
    [ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]: now
  };
}
function updateRequestDocumentWithCreatorInfo(existingRequest, formData) {
  try {
    const sheet = getMasterSheet();
    const headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

    const requestDocUrl = String(
      safeGetByName(existingRequest.row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_BRIEF_DOC_URL) || ""
    ).trim();

    if (!requestDocUrl) {
      console.log("No request document URL found to update");
      return;
    }

    const creatorData = {
      creatorTimestamp: formatDate(formData.timestamp || new Date()),
      creatorName: formData.creatorName || "",
      creatorEmail: formData.creatorEmail || "",
      creatorTeam: formData.creatorTeam || "",
      finalDemoTitle: formData.finalDemoTitle || "",
      creationLink: formData.creationLink || "",
      quarter: formData.quarter || "",
      demoDescription: formData.demoDescription || "",
      language: formData.language || "",
      syntheticVoice: formData.syntheticVoice || "",
      translation: formData.translation || "",
      mobileFriendly: formData.mobileFriendly || "",
      seoWords: formData.seoWords || "",
      ctaLink: formData.ctaLink || "",
      group: formData.group || "",
      creatorEmployeeAdvocacy: formData.creatorEmployeeAdvocacy || "",
      creatorEmpAdv: formData.creatorEmployeeAdvocacy || "",
      originType: ENHANCED_CONFIG.ORIGIN_TYPES.REQUEST_FORM,
      globalId: formData.globalId || "",
      timestamp: formatDate(formData.timestamp || new Date())
    };

    updateDocumentTokens(requestDocUrl, creatorData);
    console.log(`Updated request document with creator information: ${requestDocUrl}`);

  } catch (error) {
    logError("updateRequestDocumentWithCreatorInfo", error, { formData });
  }
}

/* =========================
   PATH 2: CREATOR-ONLY
========================= */

function handleCreatorWithoutGlobalId(formData) {
  try {
    console.log("Processing creator-only submission (no Global ID)");

    const newGlobalId = formData.globalId || Utilities.getUuid();
    formData.globalId = newGlobalId;

    const documentData = prepareCreatorOnlyDocumentData(formData);
    const docUrl = createDocumentFromTemplate(documentData);

    const masterPayload = buildCreatorOnlyMasterPayload(formData, docUrl);
    const upsertResult = upsertMasterRowByGlobalId(newGlobalId, masterPayload);

    if (upsertResult.rowIndex && typeof syncRequestMasterRowToVersion === "function") {
      try {
        syncRequestMasterRowToVersion(upsertResult.rowIndex);
        console.log(`✅ Version sync triggered for row ${upsertResult.rowIndex} after creator-only submission`);
      } catch (error) {
        logError("handleCreatorWithoutGlobalId_version_sync", error, {
          globalId: newGlobalId,
          rowIndex: upsertResult.rowIndex
        });
      }
    }

    const workflowResult = handleRequestMasterByGlobalId(newGlobalId);

    logWorkflowEvent("creator_only_submission_created", {
      globalId: newGlobalId,
      creatorName: formData.creatorName,
      number: upsertResult.number,
      docUrl
    });

    return {
      globalId: newGlobalId,
      number: upsertResult.number,
      docUrl,
      action: "created_new_creator_only",
      workflow: workflowResult,
      ...upsertResult
    };

  } catch (error) {
    logError("handleCreatorWithoutGlobalId", error, formData);
    throw error;
  }
}
function prepareCreatorOnlyDocumentData(formData) {
  return {
    originType: ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY,
    globalId: formData.globalId,
    timestamp: formData.timestamp || new Date(),
    creatorTimestamp: formatDate(formData.timestamp || new Date()),

    creatorName: formData.creatorName,
    creatorEmail: formData.creatorEmail,
    creatorTeam: formData.creatorTeam,
    finalDemoTitle: formData.finalDemoTitle,
    creationLink: formData.creationLink,
    quarter: formData.quarter,
    demoDescription: formData.demoDescription,
    language: formData.language,
    syntheticVoice: formData.syntheticVoice,
    translation: formData.translation,
    mobileFriendly: formData.mobileFriendly,
    seoWords: formData.seoWords,
    ctaLink: formData.ctaLink,
    group: formData.group,
    creatorEmployeeAdvocacy: formData.creatorEmployeeAdvocacy,
    creatorEmpAdv: formData.creatorEmployeeAdvocacy,

    // For creation doc placeholders
    productPrimary: formData.primaryProduct || "",
    product: formData.otherProducts || "",
    contentType: formData.contentType || "",
    tdp: formData.tdp || "",
    salesTactic: formData.salesTactic || "",
    marketingProg: formData.marketingProgram || "",
    marketingProgram: formData.marketingProgram || "",
    event: formData.event || "",
    vertical: formData.vertical || "",

    demoTitle: formData.finalDemoTitle,

    docTitle: generateDocumentTitle({
      originType: ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY,
      finalDemoTitle: formData.finalDemoTitle,
      creatorName: formData.creatorName,
      globalId: formData.globalId
    })
  };
}function buildCreatorOnlyMasterPayload(formData, docUrl) {
  const now = new Date();

  return {
    [ENHANCED_CONFIG.COLUMNS.ORIGIN_TYPE]: ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY,
    [ENHANCED_CONFIG.COLUMNS.GLOBAL_ID]: formData.globalId,
    [ENHANCED_CONFIG.COLUMNS.CREATION_BRIEF_DOC_URL]: docUrl,
    [ENHANCED_CONFIG.COLUMNS.REQUEST_SUBMITTED_TS]: formData.timestamp || now,

    // Do NOT write Final Demo Title into Suggested Demo Title anymore
    [ENHANCED_CONFIG.COLUMNS.CREATOR_NAME]: formData.creatorName,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_EMAIL]: formData.creatorEmail,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM]: formData.creatorTeam,
    [ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE]: formData.finalDemoTitle,
    [ENHANCED_CONFIG.COLUMNS.CREATION_LINK]: formData.creationLink,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_SUBMITTED_TS]: formData.timestamp || now,
    [ENHANCED_CONFIG.COLUMNS.QUARTER]: formData.quarter,
    [ENHANCED_CONFIG.COLUMNS.DEMO_DESCRIPTION]: formData.demoDescription,
    [ENHANCED_CONFIG.COLUMNS.LANGUAGE]: formData.language,
    [ENHANCED_CONFIG.COLUMNS.SEO_WORDS]: formData.seoWords,
    [ENHANCED_CONFIG.COLUMNS.SYNTHETIC_VOICE]: formData.syntheticVoice,
    [ENHANCED_CONFIG.COLUMNS.TRANSLATION]: formData.translation,
    [ENHANCED_CONFIG.COLUMNS.MOBILE_FRIENDLY]: formData.mobileFriendly,
    [ENHANCED_CONFIG.COLUMNS.CTA_LINK]: formData.ctaLink,
    [ENHANCED_CONFIG.COLUMNS.GROUP]: formData.group,
    [ENHANCED_CONFIG.COLUMNS.CREATOR_EMPLOYEE_ADVOC]: formData.creatorEmployeeAdvocacy,
    [ENHANCED_CONFIG.COLUMNS.DURATION]: formData.duration,
    [ENHANCED_CONFIG.COLUMNS.DESCRIPTION_FOR_SEO]: formData.descriptionForSeo,

    [ENHANCED_CONFIG.COLUMNS.CONTENT_TYPE]: formData.contentType,
    [ENHANCED_CONFIG.COLUMNS.PRIMARY_PRODUCT]: formData.primaryProduct,
    [ENHANCED_CONFIG.COLUMNS.PRODUCT]: formData.otherProducts,
    [ENHANCED_CONFIG.COLUMNS.VERTICALS]: formData.vertical,
    [ENHANCED_CONFIG.COLUMNS.EVENT]: formData.event,
    [ENHANCED_CONFIG.COLUMNS.TDP]: formData.tdp,
    [ENHANCED_CONFIG.COLUMNS.SALES_TACTIC]: formData.salesTactic,
    [ENHANCED_CONFIG.COLUMNS.MARKETING_PROGRAM]: formData.marketingProgram,

    [ENHANCED_CONFIG.COLUMNS.STATUS]: ENHANCED_CONFIG.STATUS.IE_RECEIVED,
    [ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]: now
  };
}

/* =========================
   JIRA
========================= */

function sendJiraNotification(formData, result) {
  try {
    const webhookUrl = getConfigProperty("JIRA_WEBHOOK_URL", CREATOR_CONFIG.JIRA.WEBHOOK_URL_DEFAULT);
    if (!webhookUrl) {
      console.log("No Jira webhook URL configured, skipping notification");
      return;
    }

    const jiraPayload = {
      fields: {
        project: { key: CREATOR_CONFIG.JIRA.PROJECT_KEY },
        summary: `Creator Submission: ${formData.finalDemoTitle || formData.creatorName}`,
        description: buildJiraDescription(formData, result),
        issuetype: { name: CREATOR_CONFIG.JIRA.ISSUE_TYPE },
        customfield_creator: formData.creatorName,
        customfield_global_id: result.globalId,
        customfield_action: result.action
      }
    };

    const response = UrlFetchApp.fetch(webhookUrl, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(jiraPayload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 201) {
      console.log("Jira notification sent successfully");
    } else {
      console.warn(`Jira notification failed with status: ${response.getResponseCode()}`);
    }

  } catch (error) {
    logError("sendJiraNotification", error, { formData, result });
  }
}

function buildJiraDescription(formData, result) {
  let description = `Creator Form Submission Processed\n\n`;

  description += `*Action*: ${result.action}\n`;
  description += `*Global ID*: ${result.globalId}\n`;
  description += `*Number*: ${result.number || "N/A"}\n\n`;

  description += `*Creator Information:*\n`;
  description += `- Name: ${formData.creatorName}\n`;
  description += `- Email: ${formData.creatorEmail}\n`;
  description += `- Team: ${formData.creatorTeam}\n\n`;

  description += `*Demo Information:*\n`;
  description += `- Title: ${formData.finalDemoTitle}\n`;
  description += `- Quarter: ${formData.quarter}\n`;
  description += `- Language: ${formData.language}\n`;

  if (formData.creationLink) {
    description += `- Creation Link: ${formData.creationLink}\n`;
  }

  if (result.docUrl) {
    description += `\n*Documents:*\n`;
    description += `- Creation Brief: ${result.docUrl}\n`;
  }

  return description;
}

/* =========================
   UTILITIES
========================= */

function clearCreatorFormCache() {
  creatorFormCache.clear();
  console.log("Creator form cache cleared");
}

function getCreatorFormCacheStats() {
  const now = Date.now();
  const stats = {
    totalEntries: creatorFormCache.size,
    validEntries: 0,
    expiredEntries: 0
  };

  for (const [, value] of creatorFormCache.entries()) {
    if ((now - value.timestamp) < CREATOR_CACHE_TTL) {
      stats.validEntries++;
    } else {
      stats.expiredEntries++;
    }
  }

  return stats;
}

const AI_WORKFLOW_SECRET_PROP = 'AI_WORKFLOW_SECRET';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');

    if (payload.action === 'health') {
      return jsonResponse_({
        success: true,
        app: 'creator-workflow-webhook',
        method: 'POST'
      });
    }

    const expectedSecret = PropertiesService
      .getScriptProperties()
      .getProperty(AI_WORKFLOW_SECRET_PROP);

    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse_({
        success: false,
        error: 'Unauthorized'
      });
    }

    const sheetName = payload.sheetName || getCreatorFormSheetName();
    const rowIndex = Number(payload.rowIndex);

    if (!rowIndex || rowIndex <= 1) {
      throw new Error('Missing or invalid rowIndex.');
    }

const spreadsheetId = PropertiesService
  .getScriptProperties()
  .getProperty('MASTER_SHEET_ID');

const ss = spreadsheetId
  ? SpreadsheetApp.openById(spreadsheetId)
  : SpreadsheetApp.getActiveSpreadsheet();

if (!ss) {
  throw new Error('Could not access spreadsheet. Set MASTER_SHEET_ID in Script Properties.');
}

const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      throw new Error('Sheet not found: ' + sheetName);
    }

    const lastColumn = sheet.getLastColumn();
    const range = sheet.getRange(rowIndex, 1, 1, lastColumn);

    const fakeEvent = {
      range: range,
      source: ss,
      values: range.getValues()[0],
      namedValues: buildNamedValuesFromRow_(sheet, rowIndex)
    };

    const result = onCreatorFormSubmit(fakeEvent);

    return jsonResponse_({
      success: true,
      rowIndex: rowIndex,
      result: result
    });

  } catch (error) {
    return jsonResponse_({
      success: false,
      error: error.message || String(error)
    });
  }
}

function doGetWebhookStatus() {
  return jsonResponse_({
    success: true,
    app: 'creator-workflow-webhook',
    message: 'Webhook is deployed. Use POST to trigger workflow.'
  });
}

function buildNamedValuesFromRow_(sheet, rowIndex) {
  const lastColumn = sheet.getLastColumn();

  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(header => String(header || '').trim());

  const rowValues = sheet
    .getRange(rowIndex, 1, 1, lastColumn)
    .getValues()[0];

  const namedValues = {};

  headers.forEach((header, index) => {
    if (!header) return;

    namedValues[header] = [
      rowValues[index] == null ? '' : String(rowValues[index])
    ];
  });

  return namedValues;
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================
   LIMITED COMPATIBILITY
========================= */

function handleCreatorWithGlobalId_(formData) {
  return handleCreatorWithExistingGlobalId(formData);
}

function handleCreatorNoGlobalId_(formData) {
  return handleCreatorWithoutGlobalId(formData);
}

function createRequestDocFromCreator_(data) {
  return createDocumentFromTemplate(data);
}

function updateRequestDocWithCreatorFallback_(requestDocUrl, fields) {
  return updateDocumentTokens(requestDocUrl, fields);
}