/************************************************************
 * RM_Metrics.gs - Databricks Metrics Pull
 *
 * WHAT THIS FILE DOES:
 * Queries Databricks for YTD engagement and sales metrics per demo,
 * computes month-over-month trends, and writes results to
 * auto-created columns on Request_Master.
 *
 * YTD is the primary metric window for lifecycle scoring.
 * Detailed monthly/all-time breakdowns live in Superset.
 *
 * USAGE:
 * Run pullMetricsFromDatabricks() from the sheet menu or editor.
 * Run clearMetricsData() to wipe and re-pull.
 ************************************************************/

var METRICS_COLUMNS = {
  PLAYERS_YTD: 'Metrics: Players (YTD)',
  COMPLETIONS_YTD: 'Metrics: Completions (YTD)',
  COMPLETION_RATE: 'Metrics: Completion Rate',
  CTA_CLICKS_YTD: 'Metrics: CTA Clicks (YTD)',
  CTA_CLICK_RATE: 'Metrics: CTA Click Rate',
  UNIQUE_VISITORS_YTD: 'Metrics: UVs (YTD)',
  INQUIRIES_YTD: 'Metrics: Inquiries (YTD)',
  OPPS_YTD: 'Metrics: MT Opps (YTD)',
  OPP_VALUE_YTD: 'Metrics: MT Opp Value (YTD)',
  WINS_YTD: 'Metrics: MT Wins (YTD)',
  WON_VALUE_YTD: 'Metrics: MT Won Value (YTD)',
  PLAYERS_TREND: 'Metrics: Players Trend',
  COMPLETION_TREND: 'Metrics: Completion Trend',
  LAST_PULL: 'Metrics: Last Pull'
};

function ensureMetricsColumns_(sheet) {
  var needed = Object.keys(METRICS_COLUMNS).map(function(k) { return METRICS_COLUMNS[k]; });
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); })
    : [];

  needed.forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(header);
      headers.push(header);
    }
  });

  var cols = {};
  Object.keys(METRICS_COLUMNS).forEach(function(k) {
    cols[k] = headers.indexOf(METRICS_COLUMNS[k]) + 1;
  });
  return cols;
}

/* =========================
   DATABRICKS QUERIES
========================= */

function buildEngagementYTDQuery_(config) {
  var table = config.catalog + '.' + config.schema + '.' + ENHANCED_CONFIG.DATABRICKS.VIEWS.ENGAGEMENT;
  return 'SELECT ' +
    'arcade_display_key, ' +
    'SUM(arcade_players_sum) AS players_ytd, ' +
    'SUM(arcade_completers_sum) AS completers_ytd, ' +
    'AVG(arcade_completion_rate_avg) AS completion_rate_avg, ' +
    'SUM(arcade_cta_clicks_sum) AS cta_clicks_ytd, ' +
    'AVG(arcade_cta_click_rate_avg) AS cta_click_rate_avg, ' +
    'SUM(sales_uv_unique) AS uvs_ytd, ' +
    'SUM(sales_inquiries_sum) AS inquiries_ytd, ' +
    'SUM(sales_mt_opps_sum) AS opps_ytd, ' +
    'SUM(sales_mt_opp_value_syb_sum) AS opp_value_ytd, ' +
    'SUM(sales_mt_wins_sum) AS wins_ytd, ' +
    'SUM(sales_mt_won_value_syb_sum) AS won_value_ytd ' +
    'FROM ' + table + ' ' +
    'WHERE arcade_year = YEAR(CURRENT_DATE()) ' +
    'GROUP BY arcade_display_key';
}

function buildEngagementTrendQuery_(config) {
  var table = config.catalog + '.' + config.schema + '.' + ENHANCED_CONFIG.DATABRICKS.VIEWS.ENGAGEMENT;
  return 'SELECT ' +
    'arcade_display_key, ' +
    'arcade_year, arcade_month, ' +
    'arcade_players_sum, ' +
    'arcade_completion_rate_avg ' +
    'FROM ' + table + ' ' +
    'WHERE date_ym >= ADD_MONTHS(CURRENT_DATE(), -' + ENHANCED_CONFIG.METRICS.TREND_MONTHS + ') ' +
    'ORDER BY arcade_display_key, arcade_year DESC, arcade_month DESC';
}

/* =========================
   DATA FETCHING
========================= */

function parseDatabricksRows_(result) {
  if (!result || !result.manifest || !result.result) return [];
  var columns = result.manifest.schema.columns.map(function(c) { return c.name; });
  var dataArray = result.result.data_array || [];
  return dataArray.map(function(row) {
    var obj = {};
    for (var i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj;
  });
}

function fetchEngagementYTD_(config) {
  var sql = buildEngagementYTDQuery_(config);
  Logger.log('Fetching YTD engagement metrics...');
  var result = executeDatabricksSQL(sql, config);
  var rows = parseDatabricksRows_(result);
  Logger.log('Got ' + rows.length + ' YTD engagement rows.');

  var metricsMap = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var key = String(r.arcade_display_key || '').trim();
    if (!key) continue;
    var normalizedKey = key.toLowerCase();

    metricsMap[normalizedKey] = {
      displayKey: key,
      playersYtd: Number(r.players_ytd) || 0,
      completersYtd: Number(r.completers_ytd) || 0,
      completionRate: Number(r.completion_rate_avg) || 0,
      ctaClicksYtd: Number(r.cta_clicks_ytd) || 0,
      ctaClickRate: Number(r.cta_click_rate_avg) || 0,
      uvsYtd: Number(r.uvs_ytd) || 0,
      inquiriesYtd: Number(r.inquiries_ytd) || 0,
      oppsYtd: Number(r.opps_ytd) || 0,
      oppValueYtd: Number(r.opp_value_ytd) || 0,
      winsYtd: Number(r.wins_ytd) || 0,
      wonValueYtd: Number(r.won_value_ytd) || 0
    };
  }
  return metricsMap;
}

function fetchEngagementTrends_(config) {
  var sql = buildEngagementTrendQuery_(config);
  Logger.log('Fetching engagement trends...');
  var result = executeDatabricksSQL(sql, config);
  var rows = parseDatabricksRows_(result);
  Logger.log('Got ' + rows.length + ' trend rows.');

  var trendMap = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var key = String(r.arcade_display_key || '').trim();
    if (!key) continue;
    var normalizedKey = key.toLowerCase();

    if (!trendMap[normalizedKey]) {
      trendMap[normalizedKey] = [];
    }
    trendMap[normalizedKey].push({
      year: Number(r.arcade_year),
      month: Number(r.arcade_month),
      players: Number(r.arcade_players_sum) || 0,
      completionRate: Number(r.arcade_completion_rate_avg) || 0
    });
  }
  return trendMap;
}

/* =========================
   TREND COMPUTATION
========================= */

function computeTrend_(current, previous) {
  if (!previous || previous === 0) return current > 0 ? '↑' : '→';
  var change = (current - previous) / previous;
  if (change > ENHANCED_CONFIG.METRICS.TREND_THRESHOLD) return '↑';
  if (change < -ENHANCED_CONFIG.METRICS.TREND_THRESHOLD) return '↓';
  return '→';
}

function getTrendForKey_(trendMap, normalizedKey) {
  var months = trendMap[normalizedKey];
  if (!months || months.length < 2) return { playersTrend: '→', completionTrend: '→' };

  months.sort(function(a, b) {
    return (b.year * 100 + b.month) - (a.year * 100 + a.month);
  });

  var latest = months[0];
  var previous = months[1];

  return {
    playersTrend: computeTrend_(latest.players, previous.players),
    completionTrend: computeTrend_(latest.completionRate, previous.completionRate)
  };
}

/* =========================
   MAIN PULL FUNCTION
========================= */

function pullMetricsFromDatabricks() {
  var config = getDatabricksConfig();
  if (!config.host || !config.token || !config.warehouseId) {
    throw new Error('Databricks not configured. Set DATABRICKS_HOST, DATABRICKS_TOKEN, WAREHOUSE_ID in Script Properties.');
  }

  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var cols = ensureMetricsColumns_(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
    Logger.log('No data rows.');
    return;
  }

  var ytdMap = fetchEngagementYTD_(config);
  var trendMap = fetchEngagementTrends_(config);

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var allData = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, 1, dataRows, sheet.getLastColumn()).getValues();

  var matched = 0, unmatched = 0;
  var batchValues = {};
  Object.keys(cols).forEach(function(k) { batchValues[k] = []; });

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var status = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS) || '').trim();
    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();
    var normalizedTitle = title.toLowerCase();

    var isEligible = status === ENHANCED_CONFIG.STATUS.IE_PUBLISHED || status === ENHANCED_CONFIG.STATUS.IE_REVIEWED;

    if (!isEligible || !title) {
      Object.keys(cols).forEach(function(k) { batchValues[k].push(['']); });
      continue;
    }

    var ytd = ytdMap[normalizedTitle];
    var trends = getTrendForKey_(trendMap, normalizedTitle);

    if (!ytd) {
      unmatched++;
      Object.keys(cols).forEach(function(k) { batchValues[k].push(['']); });
      continue;
    }

    matched++;

    batchValues.PLAYERS_YTD.push([ytd.playersYtd]);
    batchValues.COMPLETIONS_YTD.push([ytd.completersYtd]);
    batchValues.COMPLETION_RATE.push([Math.round(ytd.completionRate * 100) / 100]);
    batchValues.CTA_CLICKS_YTD.push([ytd.ctaClicksYtd]);
    batchValues.CTA_CLICK_RATE.push([Math.round(ytd.ctaClickRate * 100) / 100]);
    batchValues.UNIQUE_VISITORS_YTD.push([ytd.uvsYtd]);
    batchValues.INQUIRIES_YTD.push([ytd.inquiriesYtd]);
    batchValues.OPPS_YTD.push([ytd.oppsYtd]);
    batchValues.OPP_VALUE_YTD.push([Math.round(ytd.oppValueYtd)]);
    batchValues.WINS_YTD.push([ytd.winsYtd]);
    batchValues.WON_VALUE_YTD.push([Math.round(ytd.wonValueYtd)]);

    batchValues.PLAYERS_TREND.push([trends.playersTrend]);
    batchValues.COMPLETION_TREND.push([trends.completionTrend]);
    batchValues.LAST_PULL.push([new Date().toISOString()]);
  }

  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;
  Object.keys(cols).forEach(function(k) {
    if (batchValues[k].length > 0) {
      sheet.getRange(startRow, cols[k], batchValues[k].length, 1).setValues(batchValues[k]);
    }
  });

  Logger.log('Metrics pull complete. Matched: ' + matched + ', Unmatched: ' + unmatched + ', Total Databricks keys: ' + Object.keys(ytdMap).length);
  if (unmatched > 0) {
    Logger.log('Unmatched demos had no Databricks data for their Final Demo Title.');
  }
}

function clearMetricsData() {
  var sheet = getMasterSheet();
  var cols = ensureMetricsColumns_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return;

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  Object.keys(cols).forEach(function(k) {
    sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, cols[k], dataRows, 1).clearContent();
  });
  Logger.log('Cleared all metrics columns.');
}
