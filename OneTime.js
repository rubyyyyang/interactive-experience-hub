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
  backfillRecentCreatorSubmissions(4);
}

/**
 * Convenience: replay last 4 request submissions
 */
function backfillLast4RequestSubmissions() {
  backfillRecentRequestSubmissions(4);
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