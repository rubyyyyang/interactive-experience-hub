/************************************************************
 * AllTimeMetricsMap.gs
 *
 * Maps all-time usage, sales, and mapping fields from the
 * "All Time Metrics" sheet back to Request_Master by
 * Request Number.
 *
 * SOURCE SHEET:
 *   All Time Metrics
 *
 * REQUIRED SOURCE COLUMN:
 *   request_number
 *
 * TARGET SHEET:
 *   Request_Master, resolved through getMasterSheet()
 *
 * RUN:
 *   syncAllTimeMetricsToRequestMaster()
 ************************************************************/

var ALL_TIME_METRICS_CONFIG = {
  SOURCE_SHEET: 'All Time Metrics',

  REQUEST_NUMBER_HEADERS: [
    'Request Number',
    'request_number',
    'Number'
  ],

  OUTPUT_COLUMNS: {
    MAPPING_STATUS: {
      header: 'Metrics Mapping Status',
      legacyHeaders: [
        'Metrics: Mapping Status'
      ],
      source: 'metrics_mapping_status',
      sourceHeaders: [
        'metrics_mapping_status',
        'Metrics Mapping Status',
        'Metrics: Mapping Status'
      ],
      format: '@'
    },

    MAPPED_DEMO_COUNT: {
      header: 'Mapped Demo Count',
      legacyHeaders: [
        'Metrics: Mapped Demo Count'
      ],
      source: 'mapped_demo_count',
      sourceHeaders: [
        'mapped_demo_count',
        'Mapped Demo Count',
        'Metrics: Mapped Demo Count'
      ],
      format: '0'
    },

    ARCADE_IDS: {
      header: 'Arcade IDs',
      legacyHeaders: [],
      source: 'arcade_ids',
      sourceHeaders: [
        'arcade_ids',
        'Arcade IDs'
      ],
      format: '@'
    },

    MAPPED_PAGE_URLS: {
      header: 'Mapped redhat.com Pages',
      legacyHeaders: [],
      source: 'mapped_page_urls',
      sourceHeaders: [
        'mapped_page_urls',
        'Mapped redhat.com Pages',
        'Mapped Page URLs'
      ],
      format: '@'
    },

    PLAYERS: {
      header: 'All-time Players',
      legacyHeaders: [
        'Metrics: Players (All-time)'
      ],
      source: 'all_time_players',
      sourceHeaders: [
        'all_time_players',
        'All-time Players',
        'Metrics: Players (All-time)'
      ],
      format: '#,##0'
    },

    COMPLETIONS: {
      header: 'All-time Completions',
      legacyHeaders: [
        'Metrics: Completions (All-time)'
      ],
      source: 'all_time_completers',
      sourceHeaders: [
        'all_time_completers',
        'All-time Completions',
        'Metrics: Completions (All-time)'
      ],
      format: '#,##0'
    },

    COMPLETION_RATE: {
      header: 'All-time Completion Rate',
      legacyHeaders: [
        'Metrics: Completion Rate (All-time)'
      ],
      source: 'all_time_completion_rate',
      sourceHeaders: [
        'all_time_completion_rate',
        'All-time Completion Rate',
        'Metrics: Completion Rate (All-time)'
      ],
      format: '0.0%'
    },

    MT_OPP_VALUE: {
      header: 'All-time MT Opportunity Value',
      legacyHeaders: [
        'Metrics: MT Opp Value (All-time)'
      ],
      source: 'all_time_mt_opp_value',
      sourceHeaders: [
        'all_time_mt_opp_value',
        'All-time MT Opportunity Value',
        'Metrics: MT Opp Value (All-time)'
      ],
      format: '$#,##0'
    },

    MT_WON_VALUE: {
      header: 'All-time MT Won Value',
      legacyHeaders: [
        'Metrics: MT Won Value (All-time)'
      ],
      source: 'all_time_mt_won_value',
      sourceHeaders: [
        'all_time_mt_won_value',
        'All-time MT Won Value',
        'Metrics: MT Won Value (All-time)'
      ],
      format: '$#,##0'
    },

    ACTIVE_MONTHS: {
      header: 'Active Months',
      legacyHeaders: [
        'Metrics: Active Months'
      ],
      source: 'active_month_count',
      sourceHeaders: [
        'active_month_count',
        'Active Months',
        'Metrics: Active Months'
      ],
      format: '0'
    },

    PLAYERS_PER_ACTIVE_MONTH: {
      header: 'All-time Players/ Active Months',
      legacyHeaders: [
        'Metrics: Players / Active Month'
      ],
      source: 'all_time_players_per_active_month',
      sourceHeaders: [
        'all_time_players_per_active_month',
        'All-time Players/ Active Months',
        'Metrics: Players / Active Month'
      ],
      format: '0.00'
    },

    MT_OPP_VALUE_PER_ACTIVE_MONTH: {
      header: 'All-time MT Opportunity Value/Active Months',
      legacyHeaders: [
        'Metrics: MT Opp Value / Active Month'
      ],
      source: 'all_time_mt_opp_value_per_active_month',
      sourceHeaders: [
        'all_time_mt_opp_value_per_active_month',
        'All-time MT Opportunity Value/Active Months',
        'Metrics: MT Opp Value / Active Month'
      ],
      format: '$#,##0.00'
    },

    FIRST_ACTIVITY: {
      header: 'First Activity Month',
      legacyHeaders: [
        'Metrics: First Activity Month'
      ],
      source: 'first_activity_month',
      sourceHeaders: [
        'first_activity_month',
        'First Activity Month',
        'Metrics: First Activity Month'
      ],
      format: 'yyyy-mm'
    },

    LAST_ACTIVITY: {
      header: 'Last Activity Month',
      legacyHeaders: [
        'Metrics: Last Activity Month'
      ],
      source: 'last_activity_month',
      sourceHeaders: [
        'last_activity_month',
        'Last Activity Month',
        'Metrics: Last Activity Month'
      ],
      format: 'yyyy-mm'
    },

    L90_PLAYERS: {
      header: 'L90 Players',
      legacyHeaders: [],
      source: 'l90_players',
      sourceHeaders: [
        'l90_players',
        'L90 Players'
      ],
      format: '#,##0'
    },

    L90_COMPLETIONS: {
      header: 'L90 Completions',
      legacyHeaders: [],
      source: 'l90_completions',
      sourceHeaders: [
        'l90_completions',
        'L90 Completions'
      ],
      format: '#,##0'
    },

    L90_MT_OPP_VALUE: {
      header: 'L90 MT Opportunity Value',
      legacyHeaders: [],
      source: 'l90_mt_opp_value',
      sourceHeaders: [
        'l90_mt_opp_value',
        'L90 MT Opportunity Value'
      ],
      format: '$#,##0'
    },

    L90_MT_WON_VALUE: {
      header: 'L90 MT Won Value',
      legacyHeaders: [],
      source: 'l90_mt_won_value',
      sourceHeaders: [
        'l90_mt_won_value',
        'L90 MT Won Value'
      ],
      format: '$#,##0'
    },

    LAST_SYNC: {
      header: 'Metrics Last Sync',
      legacyHeaders: [
        'Metrics: Last Sync'
      ],
      source: null,
      sourceHeaders: [],
      format: 'yyyy-mm-dd hh:mm'
    }
  }
};


/**
 * Reads the All Time Metrics sheet and writes all configured
 * fields into Request_Master by matching Request Number.
 */
function syncAllTimeMetricsToRequestMaster() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  var sourceSheet = spreadsheet.getSheetByName(
    ALL_TIME_METRICS_CONFIG.SOURCE_SHEET
  );

  if (!sourceSheet) {
    throw new Error(
      'Source sheet not found: "' +
      ALL_TIME_METRICS_CONFIG.SOURCE_SHEET +
      '". Paste the SQL results into this sheet first.'
    );
  }

  var masterSheet = getMasterSheet();

  if (!masterSheet) {
    throw new Error('Request_Master sheet not found.');
  }

  var headerRow = getAllTimeHeaderRow_();

  var sourceLastRow = sourceSheet.getLastRow();
  var sourceLastCol = sourceSheet.getLastColumn();

  if (sourceLastRow < 2 || sourceLastCol < 1) {
    throw new Error(
      'The All Time Metrics sheet does not contain usable SQL results.'
    );
  }

  var masterLastRow = masterSheet.getLastRow();
  var masterLastCol = masterSheet.getLastColumn();

  if (masterLastRow <= headerRow) {
    throw new Error(
      'Request_Master does not contain any data rows.'
    );
  }

  var sourceValues = sourceSheet
    .getRange(
      1,
      1,
      sourceLastRow,
      sourceLastCol
    )
    .getValues();

  var sourceHeaders = sourceValues[0].map(function(value) {
    return String(value || '').trim();
  });

  var sourceRequestNumberCol = findAllTimeHeaderIndex_(
    sourceHeaders,
    ALL_TIME_METRICS_CONFIG.REQUEST_NUMBER_HEADERS
  );

  if (sourceRequestNumberCol === -1) {
    throw new Error(
      'The All Time Metrics sheet is missing the request_number column.'
    );
  }

  var sourceMetricColumns = getSourceMetricColumns_(
    sourceHeaders
  );

  var metricsByRequestNumber = {};
  var duplicateRequestNumbers = {};

  for (
    var sourceRowIndex = 1;
    sourceRowIndex < sourceValues.length;
    sourceRowIndex++
  ) {
    var sourceRow = sourceValues[sourceRowIndex];

    var requestNumber = normalizeAllTimeRequestNumber_(
      sourceRow[sourceRequestNumberCol]
    );

    if (!requestNumber) {
      continue;
    }

    if (metricsByRequestNumber[requestNumber]) {
      duplicateRequestNumbers[requestNumber] = true;
    }

    var record = {};

    Object.keys(sourceMetricColumns).forEach(function(key) {
      var sourceColumnIndex = sourceMetricColumns[key];

      record[key] =
        sourceColumnIndex === null
          ? null
          : sourceRow[sourceColumnIndex];
    });

    metricsByRequestNumber[requestNumber] = record;
  }

  var masterValues = masterSheet
    .getRange(
      headerRow,
      1,
      masterLastRow - headerRow + 1,
      masterLastCol
    )
    .getValues();

  var masterHeaders = masterValues[0].map(function(value) {
    return String(value || '').trim();
  });

  var masterRequestNumberCol = findAllTimeHeaderIndex_(
    masterHeaders,
    ALL_TIME_METRICS_CONFIG.REQUEST_NUMBER_HEADERS
  );

  if (masterRequestNumberCol === -1) {
    throw new Error(
      'Request_Master is missing the Request Number column.'
    );
  }

  var outputColumnNumbers = ensureAllTimeOutputColumns_(
    masterSheet,
    headerRow,
    masterHeaders
  );

  var dataRowCount = masterValues.length - 1;

  if (dataRowCount <= 0) {
    throw new Error(
      'Request_Master does not contain any data rows.'
    );
  }

  var outputValues = {};

  Object.keys(
    ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS
  ).forEach(function(key) {
    outputValues[key] = [];
  });

  var matchedCount = 0;
  var unmatchedCount = 0;
  var blankRequestCount = 0;
  var blankMappingStatusCount = 0;
  var syncTimestamp = formatTimestamp(new Date());

  for (
    var masterRowIndex = 1;
    masterRowIndex < masterValues.length;
    masterRowIndex++
  ) {
    var masterRow = masterValues[masterRowIndex];

    var masterRequestNumber =
      normalizeAllTimeRequestNumber_(
        masterRow[masterRequestNumberCol]
      );

    if (!masterRequestNumber) {
      blankRequestCount++;

      Object.keys(outputValues).forEach(function(key) {
        outputValues[key].push(['']);
      });

      continue;
    }

    var metrics =
      metricsByRequestNumber[masterRequestNumber];

    if (!metrics) {
      unmatchedCount++;

      Object.keys(outputValues).forEach(function(key) {
        if (key === 'MAPPING_STATUS') {
          outputValues[key].push([
            'Not found in metrics map'
          ]);
        } else {
          outputValues[key].push(['']);
        }
      });

      continue;
    }

    matchedCount++;

    if (
      metrics.MAPPING_STATUS === null ||
      metrics.MAPPING_STATUS === undefined ||
      String(metrics.MAPPING_STATUS).trim() === ''
    ) {
      blankMappingStatusCount++;
    }

    Object.keys(
      ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS
    ).forEach(function(key) {
      var columnConfig =
        ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS[key];

      if (key === 'LAST_SYNC') {
        outputValues[key].push([syncTimestamp]);
        return;
      }

      var rawValue = metrics[key];

      outputValues[key].push([
        convertAllTimeMetricValue_(
          rawValue,
          columnConfig.source
        )
      ]);
    });
  }

  var dataStartRow = headerRow + 1;

  Object.keys(outputColumnNumbers).forEach(function(key) {
    var columnNumber = outputColumnNumbers[key];
    var columnConfig =
      ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS[key];

    var range = masterSheet.getRange(
      dataStartRow,
      columnNumber,
      dataRowCount,
      1
    );

    range.setValues(outputValues[key]);

    if (columnConfig.format) {
      range.setNumberFormat(columnConfig.format);
    }
  });

  SpreadsheetApp.flush();

  var duplicateCount =
    Object.keys(duplicateRequestNumbers).length;

  Logger.log(
    'All-time metrics sync complete. ' +
    'Matched: ' + matchedCount +
    ', unmatched: ' + unmatchedCount +
    ', blank request rows skipped: ' + blankRequestCount +
    ', duplicate source request numbers: ' + duplicateCount +
    ', matched rows with blank mapping status: ' +
    blankMappingStatusCount
  );

  spreadsheet.toast(
    'Matched ' + matchedCount +
    ' rows; ' + unmatchedCount +
    ' requests not found; ' +
    blankMappingStatusCount +
    ' blank mapping statuses.',
    'All-time metrics sync',
    8
  );
}


/**
 * Clears values only from the canonical all-time metrics columns.
 * It does not modify original request data.
 */
function clearAllTimeMetricsFromRequestMaster() {
  var masterSheet = getMasterSheet();
  var headerRow = getAllTimeHeaderRow_();

  var lastRow = masterSheet.getLastRow();
  var lastCol = masterSheet.getLastColumn();

  if (lastRow <= headerRow || lastCol < 1) {
    return;
  }

  var headers = masterSheet
    .getRange(headerRow, 1, 1, lastCol)
    .getValues()[0]
    .map(function(value) {
      return String(value || '').trim();
    });

  Object.keys(
    ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS
  ).forEach(function(key) {
    var header =
      ALL_TIME_METRICS_CONFIG
        .OUTPUT_COLUMNS[key]
        .header;

    var index = findAllTimeHeaderIndex_(
      headers,
      [header]
    );

    if (index !== -1) {
      masterSheet
        .getRange(
          headerRow + 1,
          index + 1,
          lastRow - headerRow,
          1
        )
        .clearContent();
    }
  });

  SpreadsheetApp.flush();

  Logger.log('Cleared canonical all-time metrics columns.');
}


/**
 * Reads the configured header row.
 * Defaults to row 1 when ENHANCED_CONFIG is unavailable.
 */
function getAllTimeHeaderRow_() {
  try {
    if (
      typeof ENHANCED_CONFIG !== 'undefined' &&
      ENHANCED_CONFIG.SHEETS &&
      ENHANCED_CONFIG.SHEETS.HEADER_ROW
    ) {
      return Number(
        ENHANCED_CONFIG.SHEETS.HEADER_ROW
      );
    }
  } catch (error) {
    // Fall back to row 1.
  }

  return 1;
}


/**
 * Maps each configured output key to a source-column index.
 * Source header aliases are supported.
 */
function getSourceMetricColumns_(sourceHeaders) {
  var result = {};

  Object.keys(
    ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS
  ).forEach(function(key) {
    var config =
      ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS[key];

    if (!config.source) {
      result[key] = null;
      return;
    }

    var possibleHeaders =
      (config.sourceHeaders || []).slice();

    if (
      possibleHeaders.indexOf(config.source) === -1
    ) {
      possibleHeaders.unshift(config.source);
    }

    var index = findAllTimeHeaderIndex_(
      sourceHeaders,
      possibleHeaders
    );

    if (index === -1) {
      throw new Error(
        'The All Time Metrics sheet is missing the required column: ' +
        config.source +
        '. Accepted headers: ' +
        possibleHeaders.join(', ')
      );
    }

    result[key] = index;
  });

  return result;
}


/**
 * Creates missing canonical output columns.
 *
 * When only a legacy header exists, it is renamed to the
 * canonical header instead of creating a duplicate column.
 */
function ensureAllTimeOutputColumns_(
  sheet,
  headerRow,
  existingHeaders
) {
  var headers = existingHeaders.slice();
  var outputColumnNumbers = {};

  Object.keys(
    ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS
  ).forEach(function(key) {
    var config =
      ALL_TIME_METRICS_CONFIG.OUTPUT_COLUMNS[key];

    var canonicalIndex = findAllTimeHeaderIndex_(
      headers,
      [config.header]
    );

    if (canonicalIndex !== -1) {
      outputColumnNumbers[key] =
        canonicalIndex + 1;
      return;
    }

    var legacyIndex = findAllTimeHeaderIndex_(
      headers,
      config.legacyHeaders || []
    );

    if (legacyIndex !== -1) {
      sheet
        .getRange(
          headerRow,
          legacyIndex + 1
        )
        .setValue(config.header);

      headers[legacyIndex] = config.header;
      outputColumnNumbers[key] =
        legacyIndex + 1;
      return;
    }

    var newIndex = headers.length;

    sheet
      .getRange(
        headerRow,
        newIndex + 1
      )
      .setValue(config.header);

    headers.push(config.header);
    outputColumnNumbers[key] =
      newIndex + 1;
  });

  return outputColumnNumbers;
}


/**
 * Finds a header index using normalized matching.
 */
function findAllTimeHeaderIndex_(
  headers,
  possibleHeaders
) {
  if (!possibleHeaders || possibleHeaders.length === 0) {
    return -1;
  }

  var normalizedPossibleHeaders =
    possibleHeaders.map(function(value) {
      return normalizeAllTimeHeader_(value);
    });

  for (
    var index = 0;
    index < headers.length;
    index++
  ) {
    var normalizedHeader =
      normalizeAllTimeHeader_(headers[index]);

    if (
      normalizedPossibleHeaders.indexOf(
        normalizedHeader
      ) !== -1
    ) {
      return index;
    }
  }

  return -1;
}


/**
 * Normalizes header names for punctuation-insensitive matching.
 */
function normalizeAllTimeHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}


/**
 * Converts request numbers such as 166.0 to "166".
 */
function normalizeAllTimeRequestNumber_(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  var text = String(value).trim();

  if (!text) {
    return '';
  }

  var numericValue = Number(text);

  if (isFinite(numericValue)) {
    return String(Math.trunc(numericValue));
  }

  return text;
}


/**
 * Converts source values into Google Sheets-friendly values.
 */
function convertAllTimeMetricValue_(
  value,
  sourceField
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  var numericFields = {
    mapped_demo_count: true,
    all_time_players: true,
    all_time_completers: true,
    all_time_completion_rate: true,
    all_time_mt_opp_value: true,
    all_time_mt_won_value: true,
    active_month_count: true,
    all_time_players_per_active_month: true,
    all_time_mt_opp_value_per_active_month: true
  };

  if (numericFields[sourceField]) {
    var numberValue = Number(value);

    return isFinite(numberValue)
      ? numberValue
      : '';
  }

  if (
    sourceField === 'first_activity_month' ||
    sourceField === 'last_activity_month'
  ) {
    var text = String(value).trim();

    var dateMatch = text.match(
      /^(\d{4})-(\d{2})(?:-(\d{2}))?/
    );

    if (dateMatch) {
      return formatTimestamp(new Date(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3] || 1)
      ));
    }

    return text;
  }

  return String(value);
}