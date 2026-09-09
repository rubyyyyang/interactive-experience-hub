/************************************************************
 * Enhanced_DataSync.gs - Unified Data Synchronization
 *
 * WHAT THIS FILE DOES:
 * - Syncs Request_Master rows to Version sheet
 * - Cleans orphaned Version rows when Request_Master rows are deleted
 * - Syncs Request_Master / Version to Databricks
 *
 * TRIGGERS:
 * - onEdit_VersionSync      (Installable: From spreadsheet / On edit)
 * - onChange_VersionCleanup (Installable: From spreadsheet / On change)
 ************************************************************/

/* =========================
   VERSION SYNC CONFIG
========================= */
const VERSION_SYNC_CONFIG = {
  CACHE_TTL_MS: ENHANCED_CONFIG.PERFORMANCE.CACHE_TTL_MINUTES * 60 * 1000,
  DEBOUNCE_DELAY_MS: ENHANCED_CONFIG.PERFORMANCE.DEBOUNCE_DELAY_MS,
  MAX_BATCH_SIZE: ENHANCED_CONFIG.PERFORMANCE.MAX_BATCH_SIZE,

  VERSION_COLUMNS: {
    ARCADE_LINK: "Arcade link",
    ARCADE_ID: "Arcade ID",
    TITLE: "Title",
    NUMBER: "Number",
    VERSION: "Version",
    LAST_UPDATED: "Last Updated"
  },

  WATCH_COLUMNS: [
    ENHANCED_CONFIG.COLUMNS.NUMBER,
    ENHANCED_CONFIG.COLUMNS.CREATION_LINK,
    ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK,
    ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE,
    ENHANCED_CONFIG.COLUMNS.CONTENT_TYPE,
    ENHANCED_CONFIG.COLUMNS.MARKETING_PROGRAM,
    ENHANCED_CONFIG.COLUMNS.SALES_TACTIC,
    ENHANCED_CONFIG.COLUMNS.TDP,
    ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM,
    ENHANCED_CONFIG.COLUMNS.CREATOR_NAME,
    ENHANCED_CONFIG.COLUMNS.LANGUAGE,
    ENHANCED_CONFIG.COLUMNS.PRODUCT,
    ENHANCED_CONFIG.COLUMNS.METADATA,
    ENHANCED_CONFIG.COLUMNS.EVENT,
    ENHANCED_CONFIG.COLUMNS.CREATOR_SUBMITTED_TS,
    ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS
  ]
};

/* =========================
   DATABRICKS SYNC CONFIG
========================= */
const DATABRICKS_CONFIG = {
  RETRY_ATTEMPTS: ENHANCED_CONFIG.PERFORMANCE.RETRY_ATTEMPTS,
  RETRY_DELAY_BASE_MS: ENHANCED_CONFIG.PERFORMANCE.RETRY_DELAY_BASE_MS,
  BATCH_SIZE: 500,
  TIMEOUT_MS: 30000,

  TABLES: {
    REQUEST_MASTER: ENHANCED_CONFIG.DATABRICKS.REQUEST_MASTER_TABLE,
    VERSION: ENHANCED_CONFIG.DATABRICKS.VERSION_TABLE
  }
};

/* =========================
   TRIGGERS
========================= */

/**
 * Installable trigger:
 * Event source: From spreadsheet
 * Event type: On edit
 */
function onEdit_VersionSync(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    if (!e || !e.range) return;

    const range = e.range;
    const sheet = range.getSheet();
    const sheetName = sheet.getName();
    const masterSheetName = getMasterSheetName();

    // Handle YouTube_Responses edits
    // Note: This only covers manual edits. Any future programmatic mutation path
    // for YouTube_Responses must call bumpDiscoveryDataVersion_() because edit
    // triggers do not fire for programmatic/API writes.
    if (sheetName === "YouTube_Responses") {
      if (range.getRow() > 1) {  // Ignore header row
        bumpDiscoveryDataVersion_();
      }
      return;
    }

    if (sheetName !== masterSheetName) return;

    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;

    const rowNum = range.getRow();
    if (rowNum <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return;

    const headerIndex = getHeaderIndexCached_(sheet, "VSYNC_MASTER");
    const editedHeader = headerAtCol_(headerIndex, range.getColumn());

    console.log(`🔍 Edit detected: row=${rowNum}, header="${editedHeader}"`);

    if (!editedHeader || !VERSION_SYNC_CONFIG.WATCH_COLUMNS.includes(editedHeader)) {
      console.log(`⏭️ Column "${editedHeader}" is not watched`);
      return;
    }

    if (!debounceKey_("VSYNC", sheet.getName(), rowNum, editedHeader, VERSION_SYNC_CONFIG.DEBOUNCE_DELAY_MS)) {
      console.log(`⏭️ Debounced edit: row=${rowNum}, header="${editedHeader}"`);
      return;
    }

    syncRequestMasterRowToVersion(rowNum, { skipLock: true });

  } catch (err) {
    console.error("[onEdit_VersionSync] " + (err && err.message ? err.message : err));
    logError("onEdit_VersionSync", err, { event: e });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * Installable trigger:
 * Event source: From spreadsheet
 * Event type: On change
 *
 * Handles deleted/inserted rows.
 */
function onChange_VersionCleanup(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;

  try {
    if (!e) return;

    const changeType = String(e.changeType || "").trim();
    console.log(`🔄 Spreadsheet change detected: ${changeType}`);

    if (changeType === "REMOVE_ROW") {
      console.log("🧹 REMOVE_ROW detected. Running orphan cleanup...");
      cleanupOrphanedVersionEntries();
      return;
    }

    if (changeType === "INSERT_ROW") {
      console.log("ℹ️ INSERT_ROW detected. Running orphan cleanup for consistency...");
      cleanupOrphanedVersionEntries();
    }

  } catch (err) {
    console.error("[onChange_VersionCleanup] " + (err && err.message ? err.message : err));
    logError("onChange_VersionCleanup", err, { event: e });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* =========================
   MAIN VERSION SYNC FLOW
========================= */

function syncRequestMasterRowToVersion(rowNumber, options) {
  const skipLock = options && options.skipLock;
  try {
    const lock = skipLock ? null : LockService.getScriptLock();

    try {
      if (lock && !lock.tryLock(10000)) {
        throw new Error("Could not acquire sync lock");
      }

      const result = performVersionSync(rowNumber);

      publishEvent({
        type: "version_sync_completed",
        rowNumber,
        result
      });

      return result;

    } finally {
      if (lock && lock.hasLock()) {
        lock.releaseLock();
      }
    }

  } catch (error) {
    logError("syncRequestMasterRowToVersion", error, { rowNumber });

    publishEvent({
      type: "version_sync_failed",
      rowNumber,
      error: error.message
    });

    throw error;
  }
}

function performVersionSync(rowNumber) {
  try {
    const masterSheet = getMasterSheet();
    const versionSheet = getVersionSheet();

    if (!masterSheet) throw new Error("Missing master sheet");
    if (!versionSheet) throw new Error("Missing version sheet");

    const masterHeaderMap = getHeaderMapFromSheet(masterSheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
    const versionHeaderMap = getHeaderMapFromSheet(versionSheet, 1);

    const masterRow = masterSheet
      .getRange(rowNumber, 1, 1, masterSheet.getLastColumn())
      .getValues()[0];

    const number = safeGetByName(masterRow, masterHeaderMap, ENHANCED_CONFIG.COLUMNS.NUMBER);

    if (!number) {
      console.log(`No Number found for row ${rowNumber}. Cleaning related version entries if any...`);

      try {
        const cleanupResult = cleanupVersionEntriesForRow(
          versionSheet,
          versionHeaderMap,
          rowNumber,
          masterHeaderMap,
          masterRow
        );

        return {
          rowNumber,
          entriesProcessed: 0,
          entriesRemoved: cleanupResult.entriesRemoved,
          action: "cleaned_up_no_number"
        };
      } catch (cleanupError) {
        logError("performVersionSync_cleanup", cleanupError, { rowNumber });
        return {
          rowNumber,
          entriesProcessed: 0,
          entriesRemoved: 0,
          action: "no_number_cleanup_failed"
        };
      }
    }

    const creationLinks = splitLinks(
      safeGetByName(masterRow, masterHeaderMap, ENHANCED_CONFIG.COLUMNS.CREATION_LINK)
    );
    const prodLinks = splitLinks(
      safeGetByName(masterRow, masterHeaderMap, ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK)
    );

    console.log(`🔍 Number=${number}, creationLinks=${creationLinks.length}, prodLinks=${prodLinks.length}`);

    const existing = getExistingVersionRowMapForNumber(versionSheet, versionHeaderMap, number);
    const desired = new Set();

    let entriesProcessed = 0;

    creationLinks.forEach((link, idx) => {
      const versionLabel = `v${idx + 1}`;
      const key = `${number}|${versionLabel}`;
      desired.add(key);

      const rowValues = buildVersionRowFromMasterRow(
        versionHeaderMap,
        masterHeaderMap,
        masterRow,
        link,
        number,
        versionLabel,
        existing.get(key)
      );

      upsertVersionRow(versionSheet, existing.get(key)?.rowIndex, rowValues);
      entriesProcessed++;
      console.log(`✅ Upserted ${versionLabel}: ${link}`);
    });

    prodLinks.forEach((link, idx) => {
      const versionLabel = `Prod.v${idx + 1}`;
      const key = `${number}|${versionLabel}`;
      desired.add(key);

      const rowValues = buildVersionRowFromMasterRow(
        versionHeaderMap,
        masterHeaderMap,
        masterRow,
        link,
        number,
        versionLabel,
        existing.get(key)
      );

      upsertVersionRow(versionSheet, existing.get(key)?.rowIndex, rowValues);
      entriesProcessed++;
      console.log(`✅ Upserted ${versionLabel}: ${link}`);
    });

    pruneVersionRowsForNumber(versionSheet, versionHeaderMap, number, desired);

    console.log(`✅ Version sync complete for Number=${number}, processed=${entriesProcessed}`);

    return {
      rowNumber,
      entriesProcessed,
      number,
      creationLinks: creationLinks.length,
      prodLinks: prodLinks.length,
      action: "synced"
    };

  } catch (error) {
    logError("performVersionSync", error, { rowNumber });
    throw error;
  }
}

function syncRequestMasterToVersionFull() {
  try {
    console.log("Starting full version sync with cleanup...");

    const masterSheet = getMasterSheet();
    const lastRow = masterSheet.getLastRow();

    if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
      console.log("No data rows to sync");
      const cleanupResult = cleanupOrphanedVersionEntries();
      return {
        totalRows: 0,
        processedRows: 0,
        orphansRemoved: cleanupResult.orphansRemoved
      };
    }

    let processedRows = 0;
    const totalRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;

    for (let row = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1; row <= lastRow; row++) {
      try {
        syncRequestMasterRowToVersion(row);
        processedRows++;

        if (processedRows % 10 === 0) {
          Utilities.sleep(100);
        }
      } catch (error) {
        logError("syncRequestMasterToVersionFull", error, { row });
      }
    }

    const cleanupResult = cleanupOrphanedVersionEntries();

    console.log(`✅ Full sync complete: processed=${processedRows}/${totalRows}, removedOrphans=${cleanupResult.orphansRemoved}`);

    return {
      totalRows,
      processedRows,
      orphansRemoved: cleanupResult.orphansRemoved
    };

  } catch (error) {
    logError("syncRequestMasterToVersionFull", error);
    throw error;
  }
}

/* =========================
   VERSION SHEET ACCESS
========================= */

function getVersionSheet() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const versionSheetName = getVersionSheetName();
    const sheet = spreadsheet.getSheetByName(versionSheetName);

    if (!sheet) {
      throw new Error(`Version sheet "${versionSheetName}" not found`);
    }

    return sheet;
  } catch (error) {
    logError("getVersionSheet", error);
    throw error;
  }
}

/* =========================
   BUILD / UPSERT / PRUNE
========================= */

function splitLinks(raw) {
  return String(raw || "")
    .split(/[\r\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractArcadeId(link) {
  try {
    const s = String(link || "").trim();
    if (!s) return "";

    const patterns = [
      /\/arcade\/([A-Za-z0-9_-]+)/i,
      /\/experience\/([A-Za-z0-9_-]+)/i,
      /\/share\/([A-Za-z0-9_-]+)/i,
      /[?&]id=([A-Za-z0-9_-]+)/i,
      /[?&]arcadeId=([A-Za-z0-9_-]+)/i,
      /[?&]experienceId=([A-Za-z0-9_-]+)/i,
      /arcade\.software\/([A-Za-z0-9_-]+)/i
    ];

    for (let i = 0; i < patterns.length; i++) {
      const match = s.match(patterns[i]);
      if (match) return match[1];
    }

    return "";
  } catch (error) {
    console.warn(`Failed to extract Arcade ID from link: ${link}`);
    return "";
  }
}

function getExistingVersionRowMapForNumber(versionSheet, versionHeaderMap, number) {
  const lastRow = versionSheet.getLastRow();
  if (lastRow <= 1) return new Map();

  const numberCol0 = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.NUMBER];
  const versionCol0 = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.VERSION];
  if (numberCol0 == null || versionCol0 == null) return new Map();

  const width = versionSheet.getLastColumn();
  const all = versionSheet.getRange(2, 1, lastRow - 1, width).getValues();

  const out = new Map();
  for (let i = 0; i < all.length; i++) {
    const rowIndex = i + 2;
    const row = all[i];

    if (String(row[numberCol0]) !== String(number)) continue;

    const ver = row[versionCol0];
    if (!ver) continue;

    const key = `${number}|${ver}`;
    out.set(key, { rowIndex, row });
  }

  return out;
}

function buildVersionRowFromMasterRow(
  versionHeaderMap,
  masterHeaderMap,
  masterRow,
  link,
  number,
  versionLabel,
  existingEntry
) {
  const headers = Object.keys(versionHeaderMap);
  const out = new Array(headers.length).fill("");

  const setV = (versionColumn, value) => {
    const idx = versionHeaderMap[versionColumn];
    if (idx != null) out[idx] = (value != null) ? value : "";
  };

  setV(VERSION_SYNC_CONFIG.VERSION_COLUMNS.ARCADE_LINK, link);
  setV(VERSION_SYNC_CONFIG.VERSION_COLUMNS.ARCADE_ID, extractArcadeId(link));
  setV(VERSION_SYNC_CONFIG.VERSION_COLUMNS.NUMBER, number);
  setV(VERSION_SYNC_CONFIG.VERSION_COLUMNS.VERSION, versionLabel);

  const lastUpdatedIdx = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.LAST_UPDATED];
  if (lastUpdatedIdx != null) {
    out[lastUpdatedIdx] = formatTimestamp(new Date());
  }

  setV(
    VERSION_SYNC_CONFIG.VERSION_COLUMNS.TITLE,
    safeGetByName(masterRow, masterHeaderMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) ||
      safeGetByName(masterRow, masterHeaderMap, ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE)
  );

  return out;
}

function upsertVersionRow(versionSheet, existingRowIndex, values) {
  if (existingRowIndex) {
    versionSheet.getRange(existingRowIndex, 1, 1, values.length).setValues([values]);
  } else {
    versionSheet.appendRow(values);
  }
}

function pruneVersionRowsForNumber(versionSheet, versionHeaderMap, number, desiredKeySet) {
  const lastRow = versionSheet.getLastRow();
  if (lastRow <= 1) return;

  const numberCol0 = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.NUMBER];
  const versionCol0 = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.VERSION];
  if (numberCol0 == null || versionCol0 == null) return;

  const nVals = versionSheet.getRange(2, numberCol0 + 1, lastRow - 1, 1).getValues();
  const vVals = versionSheet.getRange(2, versionCol0 + 1, lastRow - 1, 1).getValues();

  const deleteRows = [];
  for (let i = 0; i < nVals.length; i++) {
    const r = i + 2;
    const n = nVals[i][0];
    if (String(n) !== String(number)) continue;

    const ver = vVals[i][0];
    if (!ver) continue;

    const key = `${number}|${ver}`;
    if (!desiredKeySet.has(key)) deleteRows.push(r);
  }

  deleteRows.sort((a, b) => b - a).forEach(r => versionSheet.deleteRow(r));

  if (deleteRows.length > 0) {
    console.log(`🗑️ Pruned ${deleteRows.length} stale version rows for Number=${number}`);
  }
}

/* =========================
   ORPHAN CLEANUP
========================= */

function cleanupVersionEntriesForRow(versionSheet, versionHeaderMap, rowNumber, masterHeaderMap, masterRow) {
  try {
    console.log(`🧹 Cleaning version entries for row ${rowNumber} with empty Number...`);

    const lastVersionRow = versionSheet.getLastRow();
    if (lastVersionRow <= 1) {
      return { entriesRemoved: 0 };
    }

    const versionNumberColumnIndex = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.NUMBER];
    const versionArcadeIdColumnIndex = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.ARCADE_ID];

    if (versionNumberColumnIndex == null) {
      console.warn("Number column not found in Version sheet");
      return { entriesRemoved: 0 };
    }

    const creationLinks = splitLinks(
      safeGetByName(masterRow, masterHeaderMap, ENHANCED_CONFIG.COLUMNS.CREATION_LINK)
    );
    const prodLinks = splitLinks(
      safeGetByName(masterRow, masterHeaderMap, ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK)
    );

    const relatedArcadeIds = new Set();
    [...creationLinks, ...prodLinks].forEach(link => {
      const arcadeId = extractArcadeId(link);
      if (arcadeId) relatedArcadeIds.add(arcadeId);
    });

    const versionData = versionSheet
      .getRange(2, 1, lastVersionRow - 1, versionSheet.getLastColumn())
      .getValues();

    const rowsToDelete = [];

    for (let i = 0; i < versionData.length; i++) {
      const row = versionData[i];
      const versionRowIndex = i + 2;

      let shouldDelete = false;

      const versionNumber = String(row[versionNumberColumnIndex] || "").trim();
      if (!versionNumber && versionArcadeIdColumnIndex != null) {
        const versionArcadeId = String(row[versionArcadeIdColumnIndex] || "").trim();
        if (versionArcadeId && relatedArcadeIds.has(versionArcadeId)) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        rowsToDelete.push(versionRowIndex);
      }
    }

    rowsToDelete.sort((a, b) => b - a);
    rowsToDelete.forEach(versionRowIndex => {
      versionSheet.deleteRow(versionRowIndex);
    });

    return { entriesRemoved: rowsToDelete.length };

  } catch (error) {
    logError("cleanupVersionEntriesForRow", error, { rowNumber });
    throw error;
  }
}

function cleanupOrphanedVersionEntries() {
  try {
    console.log("🧹 Starting orphan cleanup...");

    const masterSheet = getMasterSheet();
    const versionSheet = getVersionSheet();

    const masterHeaderMap = getHeaderMapFromSheet(masterSheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
    const numberColumnIndex = masterHeaderMap[ENHANCED_CONFIG.COLUMNS.NUMBER];

    if (numberColumnIndex == null) {
      throw new Error("Number column not found in master sheet");
    }

    const lastMasterRow = masterSheet.getLastRow();
    const validNumbers = new Set();

    if (lastMasterRow > ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
      const numberValues = masterSheet.getRange(
        ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1,
        numberColumnIndex + 1,
        lastMasterRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW,
        1
      ).getValues();

      numberValues.forEach(row => {
        const num = String(row[0] || "").trim();
        if (num) validNumbers.add(num);
      });
    }

    const versionHeaderMap = getHeaderMapFromSheet(versionSheet, 1);
    const versionNumberColumnIndex = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.NUMBER];

    if (versionNumberColumnIndex == null) {
      throw new Error("Number column not found in version sheet");
    }

    const lastVersionRow = versionSheet.getLastRow();
    if (lastVersionRow <= 1) {
      return { orphansRemoved: 0 };
    }

    const versionNumbers = versionSheet.getRange(
      2,
      versionNumberColumnIndex + 1,
      lastVersionRow - 1,
      1
    ).getValues();

    const orphanRows = [];
    for (let i = 0; i < versionNumbers.length; i++) {
      const versionNumber = String(versionNumbers[i][0] || "").trim();
      if (versionNumber && !validNumbers.has(versionNumber)) {
        orphanRows.push(i + 2);
      }
    }

    orphanRows.sort((a, b) => b - a);
    orphanRows.forEach(rowIndex => {
      versionSheet.deleteRow(rowIndex);
    });

    console.log(`✅ Orphan cleanup done. Removed=${orphanRows.length}`);

    publishEvent({
      type: "orphaned_versions_cleaned",
      orphansRemoved: orphanRows.length
    });

    return { orphansRemoved: orphanRows.length };

  } catch (error) {
    logError("cleanupOrphanedVersionEntries", error);
    throw error;
  }
}

function getOrphanedVersionEntries() {
  try {
    const masterSheet = getMasterSheet();
    const versionSheet = getVersionSheet();

    const masterHeaderMap = getHeaderMapFromSheet(masterSheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
    const numberColumnIndex = masterHeaderMap[ENHANCED_CONFIG.COLUMNS.NUMBER];

    if (numberColumnIndex == null) {
      return { error: "Number column not found in master sheet" };
    }

    const lastMasterRow = masterSheet.getLastRow();
    const validNumbers = new Set();

    if (lastMasterRow > ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
      const numberValues = masterSheet.getRange(
        ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1,
        numberColumnIndex + 1,
        lastMasterRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW,
        1
      ).getValues();

      numberValues.forEach(row => {
        const num = String(row[0] || "").trim();
        if (num) validNumbers.add(num);
      });
    }

    const versionHeaderMap = getHeaderMapFromSheet(versionSheet, 1);
    const versionNumberColumnIndex = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.NUMBER];
    const versionVersionColumnIndex = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.VERSION];
    const versionArcadeIdColumnIndex = versionHeaderMap[VERSION_SYNC_CONFIG.VERSION_COLUMNS.ARCADE_ID];

    if (versionNumberColumnIndex == null) {
      return { error: "Number column not found in version sheet" };
    }

    const lastVersionRow = versionSheet.getLastRow();
    if (lastVersionRow <= 1) {
      return { orphans: [], validNumbers: Array.from(validNumbers), totalVersionEntries: 0 };
    }

    const versionData = versionSheet.getRange(
      2,
      1,
      lastVersionRow - 1,
      versionSheet.getLastColumn()
    ).getValues();

    const orphans = [];
    versionData.forEach((row, index) => {
      const versionNumber = String(row[versionNumberColumnIndex] || "").trim();
      if (versionNumber && !validNumbers.has(versionNumber)) {
        orphans.push({
          rowIndex: index + 2,
          number: versionNumber,
          version: versionVersionColumnIndex != null ? row[versionVersionColumnIndex] || "" : "",
          arcadeId: versionArcadeIdColumnIndex != null ? row[versionArcadeIdColumnIndex] || "" : ""
        });
      }
    });

    return {
      orphans,
      validNumbers: Array.from(validNumbers),
      totalVersionEntries: versionData.length
    };

  } catch (error) {
    logError("getOrphanedVersionEntries", error);
    return { error: error.message };
  }
}

function forceCleanupOrphanedVersions() {
  try {
    const cleanupResult = cleanupOrphanedVersionEntries();
    return {
      success: true,
      orphansRemoved: cleanupResult.orphansRemoved
    };
  } catch (error) {
    logError("forceCleanupOrphanedVersions", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/* =========================
   CACHE / HEADER HELPERS
========================= */

function clearSyncCaches() {
  console.log("Sync caches cleared");
}

function getSyncCacheStats() {
  return {};
}

function getHeaderIndexCached_(sheet, cacheNamespace) {
  const cache = CacheService.getScriptCache();
  const key = `${cacheNamespace}:${sheet.getName()}`;

  const cached = cache.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.headers && parsed.map && parsed.byCol1) return parsed;
    } catch (_) {}
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(h => String(h || "").trim());

  const map = makeHeaderIndex_(headers);

  const byCol1 = {};
  headers.forEach((h, i) => {
    byCol1[String(i + 1)] = h;
  });

  const payload = { headers, map, byCol1 };
  cache.put(key, JSON.stringify(payload), Math.ceil(VERSION_SYNC_CONFIG.CACHE_TTL_MS / 1000));
  return payload;
}

function headerAtCol_(headerIndexCached, col1) {
  return String(headerIndexCached.byCol1[String(col1)] || "").trim();
}

function makeHeaderIndex_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || "").trim();
    if (key) map[key] = i;
  });
  return map;
}

function debounceKey_(namespace, sheetName, rowNum, header, windowMs) {
  const cache = CacheService.getScriptCache();
  const key = `${namespace}:${sheetName}:r${rowNum}:${header}`;
  const now = Date.now();

  const last = Number(cache.get(key) || "0");
  if (last && now - last < windowMs) return false;

  cache.put(key, String(now), Math.ceil(windowMs / 1000));
  return true;
}

/* =========================
   DATABRICKS SYNC
========================= */

function syncAllToDatabricks() {
  try {
    console.log("Starting full Databricks sync...");

    const config = getDatabricksConfig();
    validateDatabricksConfig(config);

    const results = {
      requestMaster: null,
      version: null,
      errors: []
    };

    try {
      results.requestMaster = syncRequestMasterToDatabricks();
    } catch (error) {
      results.errors.push({ table: "request_master", error: error.message });
    }

    try {
      results.version = syncVersionToDatabricks();
    } catch (error) {
      results.errors.push({ table: "version", error: error.message });
    }

    publishEvent({
      type: "databricks_sync_completed",
      results
    });

    console.log("Databricks sync completed:", results);
    return results;

  } catch (error) {
    logError("syncAllToDatabricks", error);
    throw error;
  }
}

function syncRequestMasterToDatabricks() {
  try {
    const sheet = getMasterSheet();
    const config = getDatabricksConfig();
    const tableName = `${config.catalog}.${config.schema}.${DATABRICKS_CONFIG.TABLES.REQUEST_MASTER}`;

    return syncSheetToDatabricks(sheet, tableName, buildRequestMasterColumnMap());

  } catch (error) {
    logError("syncRequestMasterToDatabricks", error);
    throw error;
  }
}

function syncVersionToDatabricks() {
  try {
    const sheet = getVersionSheet();
    const config = getDatabricksConfig();
    const tableName = `${config.catalog}.${config.schema}.${DATABRICKS_CONFIG.TABLES.VERSION}`;

    return syncSheetToDatabricks(sheet, tableName, buildVersionColumnMap());

  } catch (error) {
    logError("syncVersionToDatabricks", error);
    throw error;
  }
}

function syncSheetToDatabricks(sheet, tableName, columnMap) {
  try {
    const config = getDatabricksConfig();

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return { success: true, rowsSynced: 0, message: "No data to sync" };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const stagingTableName = tableName + "_staging";

    dropTable(stagingTableName, config);
    createStagingTable(stagingTableName, tableName, config);

    let totalRowsSynced = 0;
    try {
      for (let i = 0; i < data.length; i += DATABRICKS_CONFIG.BATCH_SIZE) {
        const batch = data.slice(i, i + DATABRICKS_CONFIG.BATCH_SIZE);
        const rowsSynced = insertBatchToDatabricks(batch, headers, stagingTableName, columnMap, config);
        totalRowsSynced += rowsSynced;
      }

      if (totalRowsSynced <= 0) {
        throw new Error(`No rows inserted into ${stagingTableName}. Aborting sync.`);
      }

      swapTables(tableName, stagingTableName, config);
    } catch (batchError) {
      try { dropTable(stagingTableName, config); } catch (_) {}
      throw batchError;
    }

    console.log(`Successfully synced ${totalRowsSynced} rows to ${tableName} via staging swap`);

    return { success: true, rowsSynced: totalRowsSynced, tableName };

  } catch (error) {
    logError("syncSheetToDatabricks", error, { tableName });
    throw error;
  }
}

function executeDatabricksSQL(sql, config, retries = DATABRICKS_CONFIG.RETRY_ATTEMPTS) {
  try {
    const payload = {
      warehouse_id: config.warehouseId,
      statement: sql,
      wait_timeout: "10s"
    };

    const normalizedHost = String(config.host || "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");

    const endpoint = `https://${normalizedHost}/api/2.0/sql/statements/`;

    const response = UrlFetchApp.fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const text = response.getContentText();
    console.log(`Databricks POST response code: ${response.getResponseCode()}`);
    console.log(`Databricks POST response body: ${text}`);

    const result = JSON.parse(text);

    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error(`Databricks API error: ${result.message || text}`);
    }

    const statementId = result.statement_id;
    if (!statementId) {
      throw new Error(`Missing statement_id from Databricks response: ${text}`);
    }

    return waitForDatabricksStatement_(normalizedHost, config.token, statementId);

  } catch (error) {
    if (retries > 0) {
      console.log(`Databricks SQL execution failed, retrying... (${retries} retries left): ${error.message}`);
      Utilities.sleep(
        DATABRICKS_CONFIG.RETRY_DELAY_BASE_MS *
        (DATABRICKS_CONFIG.RETRY_ATTEMPTS - retries + 1)
      );
      return executeDatabricksSQL(sql, config, retries - 1);
    }

    throw error;
  }
}

function waitForDatabricksStatement_(normalizedHost, token, statementId) {
  const endpoint = `https://${normalizedHost}/api/2.0/sql/statements/${statementId}`;

  for (let i = 0; i < 60; i++) {
    const response = UrlFetchApp.fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      muteHttpExceptions: true
    });

    const text = response.getContentText();
    console.log(`Databricks GET response body: ${text}`);

    const result = JSON.parse(text);
    const state = result.status && result.status.state;

    if (state === "SUCCEEDED") {
      return result;
    }

    if (state === "FAILED" || state === "CANCELED" || state === "CLOSED") {
      throw new Error(`Databricks SQL failed. State=${state}. Response=${text}`);
    }

    Utilities.sleep(2000);
  }

  throw new Error(`Databricks SQL timed out waiting for statement ${statementId}`);
}

function buildRequestMasterColumnMap() {
  return {
    [ENHANCED_CONFIG.COLUMNS.NUMBER]: "request_number",
    [ENHANCED_CONFIG.COLUMNS.GLOBAL_ID]: "global_id",
    [ENHANCED_CONFIG.COLUMNS.STATUS]: "status",
    [ENHANCED_CONFIG.COLUMNS.ORIGIN_TYPE]: "origin_type",

    [ENHANCED_CONFIG.COLUMNS.DRUPAL_PAGE_URL]: "drupal_page_url",
    [ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK]: "production_link",
    [ENHANCED_CONFIG.COLUMNS.CREATION_LINK]: "creation_link",
    [ENHANCED_CONFIG.COLUMNS.RHAC_PAGE]: "rhac_page",

    [ENHANCED_CONFIG.COLUMNS.REQUESTOR_NAME]: "requestor_name",
    [ENHANCED_CONFIG.COLUMNS.REQUESTOR_EMAIL]: "requestor_email",
    [ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE]: "final_demo_title",
    [ENHANCED_CONFIG.COLUMNS.CREATOR_NAME]: "creator_name",
    [ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM]: "creator_team",

    [ENHANCED_CONFIG.COLUMNS.CONTENT_TYPE]: "content_type",
    [ENHANCED_CONFIG.COLUMNS.PRIORITY]: "priority",
    [ENHANCED_CONFIG.COLUMNS.PRODUCT]: "product",
    [ENHANCED_CONFIG.COLUMNS.MARKETING_PROGRAM]: "marketing_program",
    [ENHANCED_CONFIG.COLUMNS.SALES_TACTIC]: "sales_tactic",
    [ENHANCED_CONFIG.COLUMNS.TDP]: "tdp",
    [ENHANCED_CONFIG.COLUMNS.LANGUAGE]: "language",
    [ENHANCED_CONFIG.COLUMNS.EVENT]: "event",
    [ENHANCED_CONFIG.COLUMNS.METADATA]: "metadata",

    [ENHANCED_CONFIG.COLUMNS.STATUS_OPEN_TS]: "status_open_timestamp",
    [ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]: "status_received_timestamp",
    [ENHANCED_CONFIG.COLUMNS.STATUS_REVIEWED_TS]: "status_reviewed_timestamp",
    [ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS]: "status_published_timestamp"
  };
}
function buildVersionColumnMap() {
  return {
    [VERSION_SYNC_CONFIG.VERSION_COLUMNS.ARCADE_LINK]: "arcade_link",
    [VERSION_SYNC_CONFIG.VERSION_COLUMNS.ARCADE_ID]: "arcade_id",
    [VERSION_SYNC_CONFIG.VERSION_COLUMNS.TITLE]: "title",
    [VERSION_SYNC_CONFIG.VERSION_COLUMNS.NUMBER]: "number",
    [VERSION_SYNC_CONFIG.VERSION_COLUMNS.VERSION]: "version",
    [VERSION_SYNC_CONFIG.VERSION_COLUMNS.LAST_UPDATED]: "last_updated"
  };
}

function createStagingTable(stagingTableName, sourceTableName, config) {
  const sql = `CREATE TABLE ${stagingTableName} LIKE ${sourceTableName}`;
  return executeDatabricksSQL(sql, config);
}

function swapTables(targetTableName, stagingTableName, config) {
  const tempTableName = `${targetTableName}_temp_${Date.now()}`;

  const sql1 = `ALTER TABLE ${targetTableName} RENAME TO ${tempTableName}`;
  executeDatabricksSQL(sql1, config);

  const sql2 = `ALTER TABLE ${stagingTableName} RENAME TO ${targetTableName}`;
  executeDatabricksSQL(sql2, config);

  const sql3 = `DROP TABLE ${tempTableName}`;
  executeDatabricksSQL(sql3, config);
}

function dropTable(tableName, config) {
  const sql = `DROP TABLE IF EXISTS ${tableName}`;
  return executeDatabricksSQL(sql, config);
}

function insertBatchToDatabricks(batch, headers, tableName, columnMap, config) {
  if (!batch || batch.length === 0) return 0;

  const mappedColumns = [];
  const headerIndexes = [];

  headers.forEach((header, index) => {
    const sourceHeader = String(header || "").trim();
    const targetColumn = columnMap[sourceHeader];

    if (targetColumn) {
      mappedColumns.push(targetColumn);
      headerIndexes.push(index);
    }
  });

  if (mappedColumns.length === 0) {
    throw new Error("No mapped columns found for Databricks insert.");
  }

  const sqlValue = (value) => {
    if (value === null || value === undefined || value === "") {
      return "NULL";
    }

    if (Object.prototype.toString.call(value) === "[object Date]") {
      return `'${Utilities.formatDate(value, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'")}'`;
    }

    if (typeof value === "number") {
      return String(value);
    }

    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    const escaped = String(value).replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    return `'${escaped}'`;
  };

  const valuesSql = batch.map(row => {
    const values = headerIndexes.map(index => sqlValue(row[index]));
    return `(${values.join(", ")})`;
  }).join(",\n");

  const sql = `
    INSERT INTO ${tableName} (${mappedColumns.join(", ")})
    VALUES
    ${valuesSql}
  `;

  executeDatabricksSQL(sql, config);

  console.log(`Inserted ${batch.length} rows into ${tableName}`);
  return batch.length;
}

function validateDatabricksConfig(config) {
  const required = ["host", "token", "warehouseId"];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required Databricks configuration: ${missing.join(", ")}`);
  }
}

function debugDatabricksConfig() {
  const config = getDatabricksConfig();

  console.log(JSON.stringify({
    host: config.host,
    warehouseId: config.warehouseId,
    catalog: config.catalog,
    schema: config.schema,
    requestMasterTable: DATABRICKS_CONFIG.TABLES.REQUEST_MASTER,
    versionTable: DATABRICKS_CONFIG.TABLES.VERSION
  }, null, 2));
}