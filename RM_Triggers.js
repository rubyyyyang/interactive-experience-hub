/************************************************************
 * Enhanced_Triggers.gs - Event-Driven Trigger Management
 *
 * Centralized trigger management for:
 * - onEdit
 * - onFormSubmit
 * - trigger installation
 * - status validation
 * - production link auto-advance
 *
 * NOTE:
 * - Version sync trigger lives in Enhanced_DataSync.gs:
 *   onEdit_VersionSync
 * - Orphan cleanup on row deletion lives in Enhanced_DataSync.gs:
 *   onChange_VersionCleanup
 ************************************************************/

/* =========================
   EVENT SYSTEM
========================= */

const eventSubscribers = new Map();
const eventQueue = [];
const EVENT_PROCESSING_DELAY = 100;

/**
 * Publish event for loose coupling
 */
function publishEvent(event) {
  try {
    eventQueue.push({
      ...event,
      timestamp: new Date(),
      id: Utilities.getUuid()
    });

    Utilities.sleep(EVENT_PROCESSING_DELAY);
    processEventQueue();

  } catch (error) {
    logError("publishEvent", error, { event });
  }
}

/**
 * Subscribe to events
 */
function subscribeToEvent(eventType, callback) {
  if (!eventSubscribers.has(eventType)) {
    eventSubscribers.set(eventType, []);
  }
  eventSubscribers.get(eventType).push(callback);
}

/**
 * Process queued events
 */
function processEventQueue() {
  while (eventQueue.length > 0) {
    const event = eventQueue.shift();

    try {
      const subscribers = eventSubscribers.get(event.type) || [];
      for (const callback of subscribers) {
        safeExecute(`event_${event.type}`, () => callback(event));
      }
    } catch (error) {
      logError("processEventQueue", error, { event });
    }
  }
}

/* =========================
   MAIN TRIGGER HANDLERS
========================= */

/**
 * Main spreadsheet edit trigger
 */
/**
 * Handle spreadsheet edit events
 * Invoked by installable trigger (not Simple Trigger)
 */
function handleSpreadsheetEdit(event) {
  try {
    if (!event || !event.range) {
      console.log("Invalid edit event received");
      return;
    }

    const range = event.range;
    const sheet = range.getSheet();
    const sheetName = sheet.getName();
    const masterSheetName = getMasterSheetName();

    // Handle Request_Master
    if (sheetName === masterSheetName) {
      if (range.getRow() <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
        return;
      }

      if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
        console.log("Ignoring multi-cell edit to prevent trigger storms");
        return;
      }

      publishEvent({
        type: "sheet_edit",
        sheet: sheetName,
        row: range.getRow(),
        column: range.getColumn(),
        value: event.value,
        oldValue: event.oldValue
      });

      const headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

      const statusColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS];
      const prodLinkColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK];

      if (statusColumnIndex != null && range.getColumn() === statusColumnIndex + 1) {
        processStatusEdit(event, sheet, headerMap);
      } else if (prodLinkColumnIndex != null && range.getColumn() === prodLinkColumnIndex + 1) {
        processProdLinkEdit(event, sheet, headerMap);
      }

      stampStatusTimestamp(event, sheet, headerMap);
      bumpDiscoveryDataVersion_();
      return;
    }

    // Handle YouTube_Responses
    if (sheetName === 'YouTube_Responses') {
      if (range.getRow() <= 1) {
        return;
      }

      if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) {
        console.log("Ignoring multi-cell edit to prevent trigger storms");
        return;
      }

      processYouTubeStatusEdit(event, sheet);
      return;
    }

  } catch (error) {
    logError("handleSpreadsheetEdit", error, {
      event: event ? {
        row: event.range?.getRow(),
        column: event.range?.getColumn(),
        value: event.value,
        oldValue: event.oldValue
      } : null
    });
  }
}

/**
 * Main form submission trigger
 */
function onFormSubmit(event) {
  try {
    if (!event || !event.namedValues || !event.range) {
      console.log("Invalid form submission event received");
      return;
    }

    const sheetName = event.range.getSheet().getName();

    publishEvent({
      type: "form_submit",
      sheet: sheetName,
      namedValues: event.namedValues
    });

    if (sheetName === "Request_Form_Raw") {
      processRequestFormSubmission(event);
    } else if (sheetName === getCreatorFormSheetName()) {
      processCreatorFormSubmission(event);
    } else {
      console.log(`Unknown form submission sheet: ${sheetName}`);
    }

  } catch (error) {
    logError("onFormSubmit", error, {
      event: event ? { sheetName: event.range?.getSheet()?.getName() } : null
    });
  }
}

/* =========================
   STATUS EDIT PROCESSING
========================= */

/**
 * Process status edits
 */
function processStatusEdit(event, sheet, headerMap) {
  try {
    const row = event.range.getRow();
    const newStatusRaw = String(event.value || "").trim();
    const newStatus = normalizeStatusCanonical(newStatusRaw);

    if (!newStatus) {
      console.log("Empty or invalid status, skipping processing");
      return;
    }

    const oldStatusRaw = event.oldValue != null ? String(event.oldValue).trim() : "";
    const oldStatus = normalizeStatusCanonical(oldStatusRaw) || ENHANCED_CONFIG.STATUS.REQUEST_OPEN;

    if (!validateStatusTransition(sheet, headerMap, row, oldStatus, newStatus)) {
      return;
    }

    let requestNumber = "";
    const numberColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.NUMBER];
    if (numberColumnIndex != null) {
      requestNumber = sheet.getRange(row, numberColumnIndex + 1).getValue();
      if (requestNumber) {
        handleRequestMasterByNumber(requestNumber);
      }
    }

    publishEvent({
      type: "status_changed",
      row,
      oldStatus,
      newStatus,
      requestNumber
    });

  } catch (error) {
    logError("processStatusEdit", error, { event });
  }
}

/**
 * Validate status progression
 */
function validateStatusTransition(sheet, headerMap, row, oldStatus, newStatus) {
  try {
    const readTimestamp = (columnName) => {
      const columnIndex = headerMap[columnName];
      if (columnIndex == null) return null;
      return sheet.getRange(row, columnIndex + 1).getValue();
    };

    const openTs = readTimestamp(ENHANCED_CONFIG.COLUMNS.STATUS_OPEN_TS);
    const approvedTs = readTimestamp(ENHANCED_CONFIG.COLUMNS.STATUS_APPROVED_TS);
    const receivedTs = readTimestamp(ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS);

    const originTypeColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.ORIGIN_TYPE];
    const originType = originTypeColumnIndex != null
      ? String(sheet.getRange(row, originTypeColumnIndex + 1).getValue() || "").trim()
      : "";

    const isCreatorOnly = originType === ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY;

    const isInvalid =
      (newStatus === ENHANCED_CONFIG.STATUS.REQUEST_APPROVED && !openTs) ||
      (newStatus === ENHANCED_CONFIG.STATUS.DEMO_RECEIVED && !isCreatorOnly && !approvedTs) ||
      (newStatus === ENHANCED_CONFIG.STATUS.DEMO_REVIEWED && !receivedTs);

    if (isInvalid) {
      const statusColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS];
      if (statusColumnIndex != null) {
        sheet.getRange(row, statusColumnIndex + 1).setValue(
          oldStatus || ENHANCED_CONFIG.STATUS.REQUEST_OPEN
        );
      }

      try {
        const errorMessage = isCreatorOnly
          ? "Invalid status order for creator submission. Required: Demo Received → Demo Reviewed."
          : "Invalid status order. Required: Open → Approved → Demo Received → Demo Reviewed.";

        sheet.getParent().toast(errorMessage, "Status update blocked", 5);
      } catch (toastError) {
        console.warn("Failed to show toast notification:", toastError.message);
      }

      console.log(`Status change reverted. Row: ${row}, Old: ${oldStatus}, New: ${newStatus}`);

      publishEvent({
        type: "status_validation_failed",
        row,
        oldStatus,
        newStatus,
        reason: "invalid_progression"
      });

      return false;
    }

    return true;

  } catch (error) {
    logError("validateStatusTransition", error);
    return true;
  }
}

/**
 * Process production link edits and auto-advance Demo Received -> Demo Reviewed
 */
function processProdLinkEdit(event, sheet, headerMap) {
  try {
    const row = event.range.getRow();
    const newProdLink = String(event.value || "").trim();

    console.log(`🔗 Production link edit detected: Row ${row}, Value: "${newProdLink}"`);

    if (!newProdLink) {
      console.log("⏭️ Production link cleared");
      return;
    }

    const statusColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS];
    if (statusColumnIndex != null) {
      const currentStatusRaw = String(sheet.getRange(row, statusColumnIndex + 1).getValue() || "").trim();
      const currentStatus = normalizeStatusCanonical(currentStatusRaw);

      if (currentStatus === ENHANCED_CONFIG.STATUS.DEMO_RECEIVED) {
        sheet.getRange(row, statusColumnIndex + 1).setValue(ENHANCED_CONFIG.STATUS.DEMO_REVIEWED);

        const reviewedTsColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS_REVIEWED_TS];
        if (reviewedTsColumnIndex != null) {
          const reviewedTsCell = sheet.getRange(row, reviewedTsColumnIndex + 1);
          if (!reviewedTsCell.getValue()) {
            reviewedTsCell.setValue(new Date());
          }
        }

        console.log(`Auto-advanced status to Demo Reviewed for row ${row} after prod link added`);

        publishEvent({
          type: "status_auto_advanced",
          row,
          fromStatus: ENHANCED_CONFIG.STATUS.DEMO_RECEIVED,
          toStatus: ENHANCED_CONFIG.STATUS.DEMO_REVIEWED,
          trigger: "prod_link_added"
        });
      }
    }

    const numberColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.NUMBER];
    if (numberColumnIndex != null) {
      const requestNumber = sheet.getRange(row, numberColumnIndex + 1).getValue();
      console.log(`🔢 Request number: ${requestNumber}`);

      if (requestNumber) {
        console.log(`📞 Calling handleRequestMasterByNumber for number: ${requestNumber}`);
        try {
          const result = handleRequestMasterByNumber(requestNumber);
          console.log(`✅ Workflow processing completed:`, result);
        } catch (error) {
          console.error(`❌ Workflow processing failed:`, error);
        }
      } else {
        console.log(`❌ No request number found for row ${row}`);
      }
    } else {
      console.log("❌ Number column not found in header map");
    }

  } catch (error) {
    logError("processProdLinkEdit", error, { event });
  }
}

/* =========================
   TIMESTAMP STAMPING
========================= */

/**
 * Stamp timestamp when status changes
 */
function stampStatusTimestamp(event, sheet, headerMap) {
  try {
    const range = event.range;

    const statusColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS];
    if (statusColumnIndex == null || range.getColumn() !== statusColumnIndex + 1) {
      return;
    }

    const newStatusCanonical = normalizeStatusCanonical(event.value || range.getValue() || "");
    if (!newStatusCanonical) return;

    const statusToTimestamp = getStatusToTimestampMapping();
    const timestampColumnName = statusToTimestamp[newStatusCanonical];
    if (!timestampColumnName) return;

    const timestampColumnIndex = headerMap[timestampColumnName];
    if (timestampColumnIndex == null) return;

    const timestampCell = sheet.getRange(range.getRow(), timestampColumnIndex + 1);
    if (timestampCell.getValue()) return;

    const now = formatTimestamp(new Date());
    timestampCell.setValue(now);

    console.log(`Stamped ${timestampColumnName} for row ${range.getRow()}: ${now}`);

    publishEvent({
      type: "timestamp_stamped",
      row: range.getRow(),
      status: newStatusCanonical,
      timestamp: now,
      column: timestampColumnName
    });

  } catch (error) {
    logError("stampStatusTimestamp", error, { event });
  }
}

/* =========================
   FORM SUBMISSION ROUTING
========================= */

function processRequestFormSubmission(event) {
  try {
    if (typeof handleRequestFormNamedValues === "function") {
      const result = handleRequestFormNamedValues(event.namedValues);

      publishEvent({
        type: "request_form_processed",
        result,
        namedValues: event.namedValues
      });

      console.log("Request form processed successfully:", result);
    } else {
      throw new Error("handleRequestFormNamedValues function not available");
    }

  } catch (error) {
    logError("processRequestFormSubmission", error, { event });
  }
}

function processCreatorFormSubmission(event) {
  try {
    if (typeof onCreatorFormSubmit === "function") {
      const result = onCreatorFormSubmit(event);

      publishEvent({
        type: "creator_form_processed",
        result,
        namedValues: event.namedValues
      });

      console.log("Creator form processed successfully:", result);
    } else {
      throw new Error("onCreatorFormSubmit function not available");
    }

  } catch (error) {
    logError("processCreatorFormSubmission", error, { event });
  }
}

/**
 * Process YouTube_Responses Status column edits for Retired lifecycle email
 */
function processYouTubeStatusEdit(event, sheet) {
  try {
    const range = event.range;
    const rowNumber = range.getRow();
    const newValue = String(event.value || '').trim();
    const oldValue = String(event.oldValue || '').trim();

    if (newValue.toLowerCase() !== 'retired') {
      return;
    }

    if (oldValue.toLowerCase() === 'retired') {
      return;
    }

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(h => String(h || '').trim());

    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const statusColIndex = headers.indexOf('Status');
    if (statusColIndex === -1 || range.getColumn() !== statusColIndex + 1) {
      return;
    }

    const numberColIndex = headers.indexOf('Number');
    if (numberColIndex === -1) {
      console.warn('YouTube_Responses Number column not found');
      return;
    }

    const rowData = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];
    const number = String(rowData[numberColIndex] || '').trim();

    if (!number) {
      console.warn(`YouTube_Responses row ${rowNumber} has no Number`);
      return;
    }

    // Send creator Retired email (independent from any Slack notification)
    if (typeof buildYouTubeRetiredContext === 'function' && typeof dispatchCreatorLifecycleNotification === 'function') {
      try {
        const lifecycleContext = buildYouTubeRetiredContext(rowData, headerMap, number);
        dispatchCreatorLifecycleNotification(lifecycleContext);
      } catch (error) {
        logError('processYouTubeStatusEdit_creatorEmail', error, { number, rowNumber });
      }
    }

  } catch (error) {
    logError('processYouTubeStatusEdit', error, { rowNumber: event.range?.getRow() });
  }
}

/* =========================
   TRIGGER UTILITIES
========================= */

/**
 * Install required project triggers
 */
function installTriggers() {
  try {
    deleteAllTriggers();

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    ScriptApp.newTrigger("handleSpreadsheetEdit")
      .forSpreadsheet(spreadsheet)
      .onEdit()
      .create();

    ScriptApp.newTrigger("onFormSubmit")
      .forSpreadsheet(spreadsheet)
      .onFormSubmit()
      .create();

    if (typeof onEdit_VersionSync === "function") {
      ScriptApp.newTrigger("onEdit_VersionSync")
        .forSpreadsheet(spreadsheet)
        .onEdit()
        .create();
    }

    if (typeof onChange_VersionCleanup === "function") {
      ScriptApp.newTrigger("onChange_VersionCleanup")
        .forSpreadsheet(spreadsheet)
        .onChange()
        .create();
    }

    console.log("All triggers installed successfully");

    publishEvent({
      type: "triggers_installed",
      triggerCount: ScriptApp.getProjectTriggers().length
    });

  } catch (error) {
    logError("installTriggers", error);
    throw error;
  }
}

/**
 * Delete all project triggers
 */
function deleteAllTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      ScriptApp.deleteTrigger(trigger);
    }

    console.log(`Deleted ${triggers.length} existing triggers`);

  } catch (error) {
    logError("deleteAllTriggers", error);
  }
}

/**
 * List current triggers
 */
function listTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const triggerInfo = triggers.map(trigger => ({
      handlerFunction: trigger.getHandlerFunction(),
      eventType: trigger.getEventType(),
      triggerSource: trigger.getTriggerSource(),
      id: trigger.getUniqueId()
    }));

    console.log("Current triggers:", triggerInfo);
    return triggerInfo;

  } catch (error) {
    logError("listTriggers", error);
    return [];
  }
}

/* =========================
   PERFORMANCE MONITORING
========================= */

function monitorTriggerPerformance() {
  subscribeToEvent("sheet_edit", (event) => {
    console.log(`Sheet edit processed: Row ${event.row}, Column ${event.column}`);
  });

  subscribeToEvent("status_changed", (event) => {
    console.log(`Status changed: Row ${event.row}, ${event.oldStatus} → ${event.newStatus}`);
  });

  subscribeToEvent("status_validation_failed", (event) => {
    console.warn(
      `Status validation failed: Row ${event.row}, ${event.oldStatus} → ${event.newStatus}, Reason: ${event.reason}`
    );
  });

  subscribeToEvent("form_submit", (event) => {
    console.log(`Form submitted to sheet: ${event.sheet}`);
  });

  console.log("Trigger performance monitoring activated");
}

/* =========================
   LIMITED COMPATIBILITY
========================= */

function getStatusToTimestamp_() {
  return getStatusToTimestampMapping();
}

function stampStatusTimestamp_(event) {
  if (!event || !event.range) return;

  const sheet = event.range.getSheet();
  const headerMap = getHeaderMapFromSheet(sheet);
  return stampStatusTimestamp(event, sheet, headerMap);
}

function handleRequestMasterEdit_(event) {
  return onEdit(event);
}

/* =========================
   INITIALIZATION
========================= */

function initializeTriggerSystem() {
  try {
    monitorTriggerPerformance();

    console.log("Enhanced trigger system initialized");

    publishEvent({
      type: "trigger_system_initialized",
      timestamp: new Date()
    });

  } catch (error) {
    logError("initializeTriggerSystem", error);
  }
}

