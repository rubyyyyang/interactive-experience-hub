/************************************************************
 * Enhanced_Utils.gs - Unified Utility Functions
 *
 * Shared helpers used across workflow, creator intake,
 * triggers, and data sync.
 ************************************************************/

/* =========================
   DOCUMENT MANAGEMENT
========================= */

/**
 * Unified document creation from template
 */
function createDocumentFromTemplate(data) {
  try {
    if (!data) {
      throw new Error("Document data is required");
    }

    const templateId = getTemplateId();
    const folderId = getOutputFolderId();

    if (!templateId) {
      throw new Error("Template ID not configured");
    }
    if (!folderId) {
      throw new Error("Output folder ID not configured");
    }

    const template = DriveApp.getFileById(templateId);
    const folder = DriveApp.getFolderById(folderId);

    const docTitle = data.docTitle || generateDocumentTitle(data);

    const newFile = template.makeCopy(docTitle, folder);
    const doc = DocumentApp.openById(newFile.getId());
    const body = doc.getBody();

    replaceDocumentTokens(body, data);

    doc.saveAndClose();

    console.log(`Document created successfully: ${docTitle}`);
    return newFile.getUrl();

  } catch (error) {
    console.error(`Failed to create document: ${error.message}`);
    throw new Error(`Document creation failed: ${error.message}`);
  }
}

/**
 * Generate document title with fallbacks
 */
function generateDocumentTitle(data) {
  const origin = data.originType || ENHANCED_CONFIG.ORIGIN_TYPES.REQUEST_FORM;
  const title =
    data.finalDemoTitle ||
    data.demoTitle ||
    data.productPrimary ||
    data.product ||
    "(No title)";
  const creator = data.creatorName || data.requestorName || "Unknown";
  const globalId = data.globalId || "";

  return `${origin} – ${title} – ${creator} – ${globalId}`;
}

/**
 * Replace supported tokens in the document
 */function replaceDocumentTokens(body, data) {
  const replaceIfExists = (token, value) => {
    if (value != null && String(value).trim() !== "") {
      body.replaceText(token, String(value).trim());
    }
  };

  body.replaceText("<<OriginType>>", String(data.originType || ""));
  body.replaceText("<<GlobalID>>", String(data.globalId || ""));
  body.replaceText("<<Timestamp>>", String(data.timestamp || ""));
  replaceIfExists("<<CreatorTimestamp>>", data.creatorTimestamp);

  replaceIfExists("<<DemoTitle>>", data.demoTitle);
  replaceIfExists("<<RequestorName>>", data.requestorName);
  replaceIfExists("<<RequestorEmail>>", data.requestorEmail);
  replaceIfExists("<<RequestorTeam>>", data.team || data.requestorTeam);
  replaceIfExists("<<Priority>>", data.priority);
  replaceIfExists("<<Deadline>>", data.deadline);
  replaceIfExists("<<ContactedBU>>", data.contactedBU);
  replaceIfExists("<<CheckedExisting>>", data.checkedDemo);

  // Product and content fields
  replaceIfExists("<<PrimaryProduct>>", data.productPrimary || data.primaryProduct);
  replaceIfExists("<<Product>>", data.product);
  replaceIfExists("<<ContentType>>", data.contentType);
  replaceIfExists("<<TDP>>", data.tdp);
  replaceIfExists("<<SalesTactic>>", data.salesTactic);
  replaceIfExists("<<MarketingProgram>>", data.marketingProg || data.marketingProgram);
  replaceIfExists("<<Event>>", data.event);
  replaceIfExists("<<Audience>>", data.audience);
  replaceIfExists("<<Personas>>", data.personas);
  replaceIfExists("<<Verticals>>", data.verticals || data.vertical);
  replaceIfExists("<<PainPoints>>", data.painPoints);
  replaceIfExists("<<ContextDescription>>", data.description);
  replaceIfExists("<<Links>>", data.links);
  replaceIfExists("<<Destination>>", data.destination);
  replaceIfExists("<<EmployeeAdvocacy>>", data.employeeAdvoc || data.creatorEmpAdv || data.creatorEmployeeAdvocacy);

  replaceIfExists("<<CreatorName>>", data.creatorName);
  replaceIfExists("<<CreatorEmail>>", data.creatorEmail);
  replaceIfExists("<<CreatorTeam>>", data.creatorTeam);
  replaceIfExists("<<FinalDemoTitle>>", data.finalDemoTitle);
  replaceIfExists("<<CreationLink>>", data.creationLink);
  replaceIfExists("<<Quarter>>", data.quarter);
  replaceIfExists("<<DemoDescription>>", data.demoDescription);
  replaceIfExists("<<Language>>", data.language);
  replaceIfExists("<<SyntheticVoice>>", data.syntheticVoice);
  replaceIfExists("<<Translation>>", data.translation);
  replaceIfExists("<<MobileFriendly>>", data.mobileFriendly);
  replaceIfExists("<<SEOWords>>", data.seoWords);
  replaceIfExists("<<CTALink>>", data.ctaLink);
  replaceIfExists("<<Group>>", data.group);
  replaceIfExists("<<CreatorEmployeeAdvocacy>>", data.creatorEmployeeAdvocacy || data.creatorEmpAdv);
}

/**
 * Update existing document tokens by URL
 */
function updateDocumentTokens(requestDocUrl, data) {
  if (!requestDocUrl) {
    console.warn("No document URL provided for update");
    return;
  }

  try {
    const docIdMatch = String(requestDocUrl).match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!docIdMatch) {
      throw new Error(`Could not parse document ID from URL: ${requestDocUrl}`);
    }

    const docId = docIdMatch[1];
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();

    replaceDocumentTokens(body, data);

    doc.saveAndClose();
    console.log(`Document updated successfully: ${docId}`);

  } catch (error) {
    console.error(`Failed to update document: ${error.message}`);
  }
}

/* =========================
   SHEET UTILITIES
========================= */

const headerCache = new Map();
const HEADER_CACHE_TTL = ENHANCED_CONFIG.PERFORMANCE.CACHE_TTL_MINUTES * 60 * 1000;

/**
 * Build header map with caching
 */
function getHeaderMapFromSheet(sheet, headerRow = 1) {
  if (!sheet) {
    throw new Error("Sheet is required for header mapping");
  }

  const sheetId = sheet.getSheetId();
  const cacheKey = `${sheetId}_${headerRow}`;
  const cached = headerCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp) < HEADER_CACHE_TTL) {
    return cached.map;
  }

  try {
    const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    const map = {};

    for (let i = 0; i < headers.length; i++) {
      const name = String(headers[i] || "").trim();
      if (name) {
        map[name] = i;
      }
    }

    headerCache.set(cacheKey, {
      map,
      timestamp: Date.now()
    });

    return map;

  } catch (error) {
    console.error(`Failed to get header map: ${error.message}`);
    throw new Error(`Header mapping failed: ${error.message}`);
  }
}

/**
 * Safe value retrieval from row data by column name
 */
function safeGetByName(row, headerMap, columnName) {
  if (!row || !headerMap || !columnName) {
    return "";
  }

  const index = headerMap[columnName];
  if (index === undefined || index === null) {
    return "";
  }

  const value = row[index];
  return value !== undefined && value !== null ? value : "";
}

/* =========================
   STATUS UTILITIES
========================= */

/**
 * Normalize status values to canonical config values
 */
function normalizeStatusCanonical(rawStatus) {
  if (!rawStatus) return "";

  const cleaned = normalizeString(rawStatus);
  if (!cleaned) return "";

  const lowercase = cleaned.toLowerCase();

  const canonicalStatuses = Object.values(ENHANCED_CONFIG.STATUS);
  const exactMatch = canonicalStatuses.find(status => status.toLowerCase() === lowercase);
  if (exactMatch) return exactMatch;

  const legacyMappings = {
    "open": ENHANCED_CONFIG.STATUS.REQUEST_OPEN,
    "approved": ENHANCED_CONFIG.STATUS.REQUEST_APPROVED,
    "request approved": ENHANCED_CONFIG.STATUS.REQUEST_APPROVED,
    "received": ENHANCED_CONFIG.STATUS.DEMO_RECEIVED,
    "ie received": ENHANCED_CONFIG.STATUS.DEMO_RECEIVED,
    "reviewed": ENHANCED_CONFIG.STATUS.DEMO_REVIEWED,
    "ie reviewed": ENHANCED_CONFIG.STATUS.DEMO_REVIEWED,
    "published": ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED,
    "ie published": ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED,
    "demo published": ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED,
    "retired": ENHANCED_CONFIG.STATUS.DEMO_RETIRED,
    "ie retired": ENHANCED_CONFIG.STATUS.DEMO_RETIRED,
    "demo retired": ENHANCED_CONFIG.STATUS.DEMO_RETIRED,
    "closed": ENHANCED_CONFIG.STATUS.CLOSED
  };

  return legacyMappings[lowercase] || cleaned;
}

/**
 * Check whether a status is a final state
 */
function isFinalStatus(rawStatus) {
  const canonical = normalizeStatusCanonical(rawStatus);
  return canonical === ENHANCED_CONFIG.STATUS.REQUEST_APPROVED ||
         canonical === ENHANCED_CONFIG.STATUS.CLOSED;
}

/* =========================
   DATE / STRING UTILITIES
========================= */

/**
 * Format dates safely
 */
function formatDate(value) {
  if (!value) return "—";

  try {
    if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), "EEE MMM dd yyyy");
    }

    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!isNaN(parsed)) {
        return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "EEE MMM dd yyyy");
      }
    }
  } catch (error) {
    console.warn(`Date formatting failed for value: ${value}`);
  }

  return String(value);
}

function formatTimestamp(value) {
  if (!value) return "";
  try {
    var d = (Object.prototype.toString.call(value) === "[object Date]") ? value : new Date(value);
    if (isNaN(d)) return String(value);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "M/d/yyyy");
  } catch (_) {
    return String(value);
  }
}

/**
 * Normalize strings safely
 */
function normalizeString(input) {
  if (input == null) return "";

  let result = String(input);

  try {
    result = decodeURIComponent(result);
  } catch (_) {}

  return result
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
   MASTER SHEET ACCESS
========================= */

/**
 * Get master sheet
 */
function getMasterSheet() {
  try {
    const sheetId = getConfigProperty("MASTER_SHEET_ID");
    const spreadsheet = sheetId
      ? SpreadsheetApp.openById(sheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    const sheetName = getMasterSheetName();
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      throw new Error(`Master sheet "${sheetName}" not found`);
    }

    return sheet;

  } catch (error) {
    console.error(`Failed to get master sheet: ${error.message}`);
    throw error;
  }
}

/* =========================
   ERROR HANDLING / LOGGING
========================= */

/**
 * Standard error logger
 */
function logError(context, error, additionalInfo = {}) {
  const errorInfo = {
    context,
    message: error && error.message ? error.message : String(error),
    timestamp: new Date().toISOString(),
    ...additionalInfo
  };

  console.error(`[${context}] ${JSON.stringify(errorInfo)}`);
}

/**
 * Safe execute helper
 */
function safeExecute(functionName, fn, fallback = null) {
  try {
    return fn();
  } catch (error) {
    logError(functionName, error);
    return fallback;
  }
}

/* =========================
   PERFORMANCE UTILITIES
========================= */

function clearHeaderCache() {
  headerCache.clear();
  console.log("Header cache cleared");
}

function getHeaderCacheStats() {
  const now = Date.now();
  const stats = {
    totalEntries: headerCache.size,
    validEntries: 0,
    expiredEntries: 0
  };

  for (const [, value] of headerCache.entries()) {
    if ((now - value.timestamp) < HEADER_CACHE_TTL) {
      stats.validEntries++;
    } else {
      stats.expiredEntries++;
    }
  }

  return stats;
}

function extractLastLine_(multiLineValue) {
  var p = String(multiLineValue || "").trim();
  if (p) {
    var lines = p.split("\n");
    for (var i = lines.length - 1; i >= 0; i--) {
      var line = lines[i].trim();
      if (line) return line;
    }
  }
  return "";
}

