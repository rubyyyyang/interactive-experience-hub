/************************************************************
 * Backfill Helpers - Replay recent rows from raw form sheets
 *
 * WHAT THIS FILE DOES:
 * Replays recent rows from:
 * - Creator_Form_Raw  -> onCreatorFormSubmit(fakeEvent)
 * - Request_Form_Raw  -> handleRequestFormNamedValues(namedValues)
 *
 * USE THIS FOR:
 * - Reprocessing recent form rows after code changes
 * - Backfilling missed rows
 * - Testing current intake logic against existing raw form rows
 *
 * NOTES:
 * - This bypasses duplicate-submission cache checks during replay
 * - It uses the current code path, so results reflect current logic
 ************************************************************/

/**
 * Convenience: replay last 4 creator submissions
 */
function backfillLast4CreatorSubmissions() {
  backfillRecentCreatorSubmissions(1);
}

/**
 * Convenience: replay last 4 request submissions
 */
function backfillLast4RequestSubmissions() {
  backfillRecentRequestSubmissions(1);
}

/**
 * Replay the last N rows from Creator_Form_Raw
 */
function backfillRecentCreatorSubmissions(n) {
  n = n || 4;

  if (typeof onCreatorFormSubmit !== "function") {
    throw new Error("onCreatorFormSubmit() not found.");
  }

  const sheetName =
    (typeof getCreatorFormSheetName === "function" && getCreatorFormSheetName()) ||
    "Creator_Form_Raw";

  return replayRecentFormRows_({
    sheetName,
    n,
    label: "creator",
    handler: function (ctx) {
      const fakeEvent = {
        range: {
          getSheet: () => ctx.sheet,
          getRow: () => ctx.rowIndex
        },
        namedValues: ctx.namedValues
      };

      return onCreatorFormSubmit(fakeEvent);
    }
  });
}

/**
 * Replay the last N rows from Request_Form_Raw
 */
function backfillRecentRequestSubmissions(n) {
  n = n || 4;

  if (typeof handleRequestFormNamedValues !== "function") {
    throw new Error("handleRequestFormNamedValues() not found.");
  }

  const sheetName =
    (typeof getConfigProperty === "function" && getConfigProperty("REQUEST_FORM_SHEET_NAME")) ||
    (typeof ENHANCED_CONFIG !== "undefined" && ENHANCED_CONFIG.SHEETS.REQUEST_FORM_NAME_DEFAULT) ||
    "Request_Form_Raw";

  return replayRecentFormRows_({
    sheetName,
    n,
    label: "request",
    handler: function (ctx) {
      return handleRequestFormNamedValues(ctx.namedValues);
    }
  });
}

/**
 * Shared replay engine
 */
function replayRecentFormRows_(options) {
  const sheetName = options.sheetName;
  const n = options.n || 4;
  const label = options.label || "form";
  const handler = options.handler;

  if (typeof handler !== "function") {
    throw new Error("Replay handler is required.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  if (lastRow < 2) {
    Logger.log(`No ${label} submissions found in ${sheetName} (only header).`);
    return { ok: 0, fail: 0, skipped: 0, sheetName };
  }

  const header = sh
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(h => String(h || "").trim());

  const startRow = Math.max(2, lastRow - n + 1);
  const numRows = lastRow - startRow + 1;
  const values = sh.getRange(startRow, 1, numRows, lastCol).getValues();

  Logger.log(`Backfill: replaying ${numRows} ${label} row(s) from ${sheetName} (${startRow}..${lastRow})`);

  function toNamedValues_(rowVals) {
    const nv = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      const value = rowVals[c];
      nv[key] = [value == null ? "" : String(value)];
    }
    return nv;
  }

  // ---- Temporarily bypass duplicate cache checks if present ----
  const originalIsDuplicateSubmission =
    (typeof isDuplicateSubmission === "function") ? isDuplicateSubmission : null;

  if (originalIsDuplicateSubmission) {
    globalThis.isDuplicateSubmission = function () {
      return false;
    };
  }

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  const errors = [];

  try {
    for (let i = 0; i < values.length; i++) {
      const rowIndex = startRow + i;
      const namedValues = toNamedValues_(values[i]);

      try {
        const result = handler({
          sheet: sh,
          rowIndex,
          namedValues
        });

        ok++;
        Logger.log(`✅ Backfill OK [${label}] row ${rowIndex}`);
        if (result) {
          Logger.log(JSON.stringify(result));
        }

      } catch (e) {
        fail++;
        const msg = e && e.message ? e.message : String(e);
        errors.push({ rowIndex, message: msg });
        Logger.log(`❌ Backfill FAILED [${label}] row ${rowIndex}: ${msg}`);
      }
    }
  } finally {
    if (originalIsDuplicateSubmission) {
      globalThis.isDuplicateSubmission = originalIsDuplicateSubmission;
    }
  }

  const summary = { ok, fail, skipped, sheetName, startRow, lastRow, errors };
  Logger.log(`Backfill done [${label}]. OK=${ok}, FAIL=${fail}, SKIPPED=${skipped}`);
  return summary;
}


function debugVersionRows215Plus() {
  const versionSheet = getVersionSheet();
  const headerMap = getHeaderMapFromSheet(versionSheet, 1);

  const numberCol =
    headerMap["Number"] != null ? headerMap["Number"] :
    headerMap["request_number"] != null ? headerMap["request_number"] :
    null;

  if (numberCol == null) {
    throw new Error("No Number/request_number column found in Version sheet.");
  }

  const lastRow = versionSheet.getLastRow();
  const data = versionSheet.getRange(2, 1, lastRow - 1, versionSheet.getLastColumn()).getValues();

  let count = 0;

  data.forEach((row, i) => {
    const number = Number(row[numberCol]);
    if (number >= 215) {
      count++;
      console.log(`Version row ${i + 2}: Number=${number}, data=${JSON.stringify(row)}`);
    }
  });

  console.log(`Total Version rows with Number >= 215: ${count}`);
}


function normalizeAllTimestampFormats() {
  const sheet = getMasterSheet();
  const headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  const tz = Session.getScriptTimeZone();

  const timestampColumns = [
    ENHANCED_CONFIG.COLUMNS.STATUS_OPEN_TS,
    ENHANCED_CONFIG.COLUMNS.STATUS_APPROVED_TS,
    ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS,
    ENHANCED_CONFIG.COLUMNS.STATUS_REVIEWED_TS,
    ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS,
    ENHANCED_CONFIG.COLUMNS.STATUS_RETIRED_TS,
    ENHANCED_CONFIG.COLUMNS.STATUS_CLOSED_TS,
    ENHANCED_CONFIG.COLUMNS.REQUEST_SUBMITTED_TS,
    ENHANCED_CONFIG.COLUMNS.CREATOR_SUBMITTED_TS,
    "First Activity Month",
    "Last Activity Month",
    "Metrics Last Sync"
  ];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  let totalFixed = 0;

  timestampColumns.forEach(colName => {
    const colIndex = headerMap[colName];
    if (colIndex == null) {
      console.log(`Column "${colName}" not found, skipping`);
      return;
    }

    const range = sheet.getRange(2, colIndex + 1, lastRow - 1, 1);
    const values = range.getValues();
    let colFixed = 0;

    const updated = values.map(([val]) => {
      if (!val || String(val).trim() === "" || String(val).trim() === "-") return [val];

      const str = String(val).trim();
      const dateFormatRegex = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
      if (dateFormatRegex.test(str)) return [val];

      try {
        let d;
        if (Object.prototype.toString.call(val) === "[object Date]" && !isNaN(val)) {
          d = val;
        } else {
          d = new Date(str);
        }
        if (isNaN(d)) return [val];

        const formatted = Utilities.formatDate(d, tz, "M/d/yyyy");
        colFixed++;
        return [formatted];
      } catch (_) {
        return [val];
      }
    });

    if (colFixed > 0) {
      range.setValues(updated);
      totalFixed += colFixed;
      console.log(`${colName}: normalized ${colFixed} values`);
    } else {
      console.log(`${colName}: all values already in correct format`);
    }
  });

  console.log(`Done. Total cells normalized: ${totalFixed}`);
}


/**
 * Convert Duration from ARRAYFORMULA to per-row formulas.
 *
 * ARRAYFORMULA breaks when any cell in the column has a pasted value.
 * Per-row formulas are resilient and work with the template-copy logic
 * in upsertMasterRowByGlobalId for new rows.
 *
 * Run once from Apps Script editor.
 */
function convertDurationToPerRowFormulas() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

  var durationCol = headerMap[ENHANCED_CONFIG.COLUMNS.DURATION];
  if (durationCol == null) {
    throw new Error("Duration column not found in Request_Master");
  }
  var colNum = durationCol + 1; // 1-based

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    console.log("No data rows");
    return;
  }

  // Matches Final Demo Title (C) against Verticurl Display headline (B) → Demo length (J)
  // Falls back to Drupal Page URL (G) path against Verticurl Drupal URL (V) path → Demo length (J)
  // ROUND to whole numbers for consistent format
  function buildFormula(row) {
    return '=IF(C' + row + '="","",ROUND(IFNA(VLOOKUP(C' + row + ',\'Verticurl transferring\'!B:J,9,FALSE),IF(G' + row + '="","",IFNA(VLOOKUP(REGEXREPLACE(G' + row + ',"^https?://[^/]+",""),{REGEXREPLACE(\'Verticurl transferring\'!V:V,"^https?://[^/]+",""),\'Verticurl transferring\'!J:J},2,FALSE))))))';
  }

  var formulas = [];
  for (var r = 2; r <= lastRow; r++) {
    formulas.push([buildFormula(r)]);
  }

  var range = sheet.getRange(2, colNum, formulas.length, 1);
  range.setFormulas(formulas);

  SpreadsheetApp.flush();
  console.log("Duration: set per-row VLOOKUP formulas (rounded to whole numbers) for rows 2-" + lastRow + " (" + formulas.length + " rows)");
}


/**
 * Backfill Latest Prod Link for all rows using code-based computation.
 * Extracts last line from Production Link (line 1 = v1, line 2 = v2, …),
 * falls back to Creation Link.
 *
 * Run once from Apps Script editor.
 */
function backfillLatestProdLink() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

  var latestCol = headerMap[ENHANCED_CONFIG.COLUMNS.LATEST_PROD_LINK];
  if (latestCol == null) {
    throw new Error("Latest Prod Link column not found in Request_Master");
  }
  var prodCol = headerMap[ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK];
  if (prodCol == null) {
    throw new Error("Production Link column not found in Request_Master");
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    console.log("No data rows");
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var output = [];
  for (var i = 0; i < data.length; i++) {
    output.push([computeLatestProdLink_(data[i][prodCol])]);
  }

  sheet.getRange(2, latestCol + 1, output.length, 1).setValues(output);
  SpreadsheetApp.flush();
  console.log("Latest Prod Link: backfilled " + output.length + " rows with computed values");
}

function columnToLetter_(colIndex) {
  var letter = "";
  var temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode(65 + (temp % 26)) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}