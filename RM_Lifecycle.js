/************************************************************
 * RM_Lifecycle.gs - Lifecycle Scoring & Dashboard Data
 *
 * WHAT THIS FILE DOES:
 * Combines Claude quality scores, Databricks YTD engagement metrics,
 * content age, and overlap scores into a composite lifecycle
 * recommendation per demo: Promote, Refresh, Retire, Review, Keep.
 *
 * Also provides getDashboardData() for the lifecycle dashboard
 * and onOpen() for the sheet menu.
 *
 * USAGE:
 * Use the "Lifecycle" menu in the sheet, or run functions
 * from the Apps Script editor.
 ************************************************************/

var LIFECYCLE_COLUMNS = {
  ACTION: 'Lifecycle: Action',
  SCORE: 'Lifecycle: Score',
  REASON: 'Lifecycle: Reason',
  EVALUATED: 'Lifecycle: Last Evaluated'
};

var LIFECYCLE_WEIGHTS = {
  QUALITY: 0.30,
  ENGAGEMENT: 0.30,
  FRESHNESS: 0.20,
  UNIQUENESS: 0.20
};

function ensureLifecycleColumns_(sheet) {
  var needed = [LIFECYCLE_COLUMNS.ACTION, LIFECYCLE_COLUMNS.SCORE, LIFECYCLE_COLUMNS.REASON, LIFECYCLE_COLUMNS.EVALUATED];
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

  return {
    actionCol: headers.indexOf(LIFECYCLE_COLUMNS.ACTION) + 1,
    scoreCol: headers.indexOf(LIFECYCLE_COLUMNS.SCORE) + 1,
    reasonCol: headers.indexOf(LIFECYCLE_COLUMNS.REASON) + 1,
    evaluatedCol: headers.indexOf(LIFECYCLE_COLUMNS.EVALUATED) + 1
  };
}

function parseQualityScore_(cellValue) {
  var s = String(cellValue || '');
  var match = s.match(/^(\d+)\/100/);
  return match ? Number(match[1]) : null;
}

function parseOverlapScore_(cellValue) {
  var s = String(cellValue || '');
  var match = s.match(/Score:\s*(\d+)\/100/);
  return match ? Number(match[1]) : null;
}

/* =========================
   SUB-SCORE COMPUTATION
========================= */

function computeFreshnessScore_(publishedDate) {
  if (!publishedDate) return 50;
  var pub = new Date(publishedDate);
  if (isNaN(pub.getTime())) return 50;
  var now = new Date();
  var monthsOld = (now.getFullYear() - pub.getFullYear()) * 12 + (now.getMonth() - pub.getMonth());
  if (monthsOld <= 3) return 100;
  if (monthsOld >= 24) return 0;
  return Math.round(100 * (1 - (monthsOld - 3) / 21));
}

function computePercentileRanks_(values) {
  var validValues = values.filter(function(v) { return v !== null && v !== undefined && !isNaN(v); });
  validValues.sort(function(a, b) { return a - b; });
  var ranks = {};
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v === null || v === undefined || isNaN(v)) {
      ranks[i] = 50;
      continue;
    }
    var position = 0;
    for (var j = 0; j < validValues.length; j++) {
      if (validValues[j] <= v) position = j + 1;
    }
    ranks[i] = validValues.length > 0 ? Math.round((position / validValues.length) * 100) : 50;
  }
  return ranks;
}

function computeEngagementScore_(playersPctile, completionPctile, ctaPctile) {
  return Math.round(playersPctile * 0.4 + completionPctile * 0.4 + ctaPctile * 0.2);
}

/* =========================
   ACTION DETERMINATION
========================= */

function determineAction_(composite, quality, engagement, freshness, uniqueness, trend) {
  if (quality !== null && quality < 30 && (engagement < 30 || engagement === 50)) return 'Retire';
  if (uniqueness < 20) return 'Retire';
  if (composite >= 75 && (trend === '↑' || trend === '→') && quality >= 70) return 'Promote';
  if (quality >= 60 && freshness < 40) return 'Refresh';
  if (engagement < 40 && trend === '↓' && quality >= 50) return 'Refresh';
  if (quality !== null && quality < 40 && engagement >= 50) return 'Review';
  if (uniqueness < 40 && uniqueness >= 20) return 'Review';
  if (composite < 30) return 'Retire';
  return 'Keep';
}

function buildReason_(action, quality, engagement, freshness, uniqueness, trend, players) {
  var parts = [];
  switch (action) {
    case 'Promote':
      parts.push('Strong quality (' + (quality || '?') + '/100)');
      if (trend === '↑') parts.push('growing engagement');
      if (players) parts.push(players + ' players YTD');
      return parts.join(', ') + '. Good candidate for featured placement.';
    case 'Refresh':
      if (freshness < 40) parts.push('Content aging (freshness ' + freshness + '/100)');
      if (trend === '↓') parts.push('engagement declining');
      if (quality >= 60) parts.push('quality still solid (' + quality + '/100)');
      return parts.join(', ') + '. Update to maintain value.';
    case 'Retire':
      if (quality !== null && quality < 30) parts.push('Low quality (' + quality + '/100)');
      if (uniqueness < 20) parts.push('near-duplicate content (overlap ' + (100 - uniqueness) + '/100)');
      if (engagement < 30 && engagement !== 50) parts.push('low engagement');
      return parts.join(', ') + '. Consider removing or consolidating.';
    case 'Review':
      if (quality !== null && quality < 40 && engagement >= 50) parts.push('Users engage but quality is low (' + quality + '/100)');
      if (uniqueness < 40) parts.push('significant overlap with other demos');
      return parts.join(', ') + '. Needs attention.';
    default:
      return 'Performing adequately (score ' + Math.round(quality || 50) + '/100). No immediate action needed.';
  }
}

/* =========================
   MAIN SCORING FUNCTION
========================= */

function runLifecycleScoring() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var cols = ensureLifecycleColumns_(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
    Logger.log('No data rows.');
    return;
  }

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var allData = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, 1, dataRows, sheet.getLastColumn()).getValues();

  var demos = [];
  var playerValues = [];
  var completionValues = [];
  var ctaValues = [];

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var status = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS) || '').trim();
    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();

    var isEligible = status === ENHANCED_CONFIG.STATUS.IE_PUBLISHED || status === ENHANCED_CONFIG.STATUS.IE_REVIEWED;

    var quality = isEligible ? parseQualityScore_(safeGetByName(row, headerMap, CLAUDE_COLUMNS.QUALITY)) : null;
    var overlap = isEligible ? parseOverlapScore_(safeGetByName(row, headerMap, CLAUDE_COLUMNS.OVERLAP)) : null;
    var players = isEligible ? Number(safeGetByName(row, headerMap, METRICS_COLUMNS.PLAYERS_YTD)) || null : null;
    var completionRate = isEligible ? Number(safeGetByName(row, headerMap, METRICS_COLUMNS.COMPLETION_RATE)) || null : null;
    var ctaClickRate = isEligible ? Number(safeGetByName(row, headerMap, METRICS_COLUMNS.CTA_CLICK_RATE)) || null : null;
    var playersTrend = isEligible ? String(safeGetByName(row, headerMap, METRICS_COLUMNS.PLAYERS_TREND) || '') : '';
    var publishedDate = safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS);

    demos.push({
      index: i,
      isEligible: isEligible,
      title: title,
      quality: quality,
      overlap: overlap,
      players: players,
      completionRate: completionRate,
      ctaClickRate: ctaClickRate,
      playersTrend: playersTrend,
      publishedDate: publishedDate
    });

    playerValues.push(isEligible ? players : null);
    completionValues.push(isEligible ? completionRate : null);
    ctaValues.push(isEligible ? ctaClickRate : null);
  }

  var playerRanks = computePercentileRanks_(playerValues);
  var completionRanks = computePercentileRanks_(completionValues);
  var ctaRanks = computePercentileRanks_(ctaValues);

  var actionBatch = [];
  var scoreBatch = [];
  var reasonBatch = [];
  var evalBatch = [];
  var now = new Date().toISOString();

  for (var d = 0; d < demos.length; d++) {
    var demo = demos[d];
    if (!demo.isEligible) {
      actionBatch.push(['']);
      scoreBatch.push(['']);
      reasonBatch.push(['']);
      evalBatch.push(['']);
      continue;
    }

    var qualityScore = demo.quality !== null ? demo.quality : 50;
    var engagementScore = computeEngagementScore_(playerRanks[d], completionRanks[d], ctaRanks[d]);
    var freshnessScore = computeFreshnessScore_(demo.publishedDate);
    var uniquenessScore = demo.overlap !== null ? (100 - demo.overlap) : 75;

    var composite = Math.round(
      qualityScore * LIFECYCLE_WEIGHTS.QUALITY +
      engagementScore * LIFECYCLE_WEIGHTS.ENGAGEMENT +
      freshnessScore * LIFECYCLE_WEIGHTS.FRESHNESS +
      uniquenessScore * LIFECYCLE_WEIGHTS.UNIQUENESS
    );

    var action = determineAction_(composite, demo.quality, engagementScore, freshnessScore, uniquenessScore, demo.playersTrend);
    var reason = buildReason_(action, demo.quality, engagementScore, freshnessScore, uniquenessScore, demo.playersTrend, demo.players);

    actionBatch.push([action]);
    scoreBatch.push([composite]);
    reasonBatch.push([reason]);
    evalBatch.push([now]);
  }

  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;
  sheet.getRange(startRow, cols.actionCol, actionBatch.length, 1).setValues(actionBatch);
  sheet.getRange(startRow, cols.scoreCol, scoreBatch.length, 1).setValues(scoreBatch);
  sheet.getRange(startRow, cols.reasonCol, reasonBatch.length, 1).setValues(reasonBatch);
  sheet.getRange(startRow, cols.evaluatedCol, evalBatch.length, 1).setValues(evalBatch);

  var counts = { Promote: 0, Refresh: 0, Retire: 0, Review: 0, Keep: 0 };
  actionBatch.forEach(function(a) { if (a[0] && counts[a[0]] !== undefined) counts[a[0]]++; });
  Logger.log('Lifecycle scoring complete. Promote: ' + counts.Promote + ', Keep: ' + counts.Keep + ', Refresh: ' + counts.Refresh + ', Review: ' + counts.Review + ', Retire: ' + counts.Retire);
}

function clearLifecycleData() {
  var sheet = getMasterSheet();
  var cols = ensureLifecycleColumns_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return;

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  [cols.actionCol, cols.scoreCol, cols.reasonCol, cols.evaluatedCol].forEach(function(col) {
    sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, col, dataRows, 1).clearContent();
  });
  Logger.log('Cleared lifecycle columns.');
}

/* =========================
   MENU
========================= */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Lifecycle')
    .addItem('Pull Metrics from Databricks', 'pullMetricsFromDatabricks')
    .addItem('Run Lifecycle Scoring', 'runLifecycleScoring')
    .addSeparator()
    .addItem('Apply Claude Results', 'applyClaudeResults')
    .addItem('Export for Claude Analysis', 'exportForClaudeAnalysis')
    .addSeparator()
    .addItem('Open Dashboard', 'openLifecycleDashboard_')
    .addSeparator()
    .addSubMenu(ui.createMenu('Clear Data')
      .addItem('Clear Metrics', 'clearMetricsData')
      .addItem('Clear Lifecycle Scores', 'clearLifecycleData')
      .addItem('Clear Claude Results', 'clearClaudeResults'))
    .addToUi();
}

function openLifecycleDashboard_() {
  var url = ScriptApp.getService().getUrl() + '?page=lifecycle';
  var html = HtmlService.createHtmlOutput(
    '<p>Open the Lifecycle Dashboard:</p>' +
    '<p><a href="' + url + '" target="_blank" style="font-size:16px">' + url + '</a></p>' +
    '<script>window.open("' + url + '");google.script.host.close();</script>'
  ).setWidth(500).setHeight(120);
  SpreadsheetApp.getUi().showModalDialog(html, 'Lifecycle Dashboard');
}

/* =========================
   DASHBOARD DATA
========================= */

function getDashboardData() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return { demos: [], tdpSummary: {}, teamSummary: {}, actionSummary: {} };

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var allData = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, 1, dataRows, sheet.getLastColumn()).getValues();

  var demos = [];
  var tdpSummary = {};
  var teamSummary = {};
  var actionSummary = { Promote: 0, Refresh: 0, Retire: 0, Review: 0, Keep: 0 };

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var status = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS) || '').trim();
    if (status !== ENHANCED_CONFIG.STATUS.IE_PUBLISHED && status !== ENHANCED_CONFIG.STATUS.IE_REVIEWED) continue;

    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();
    if (!title) continue;

    var tdp = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.TDP) || '').trim() || 'Unassigned';
    var team = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM) || '').trim() || 'Unknown';
    var action = String(safeGetByName(row, headerMap, LIFECYCLE_COLUMNS.ACTION) || '').trim() || 'Keep';
    var lifecycleScore = Number(safeGetByName(row, headerMap, LIFECYCLE_COLUMNS.SCORE)) || 0;
    var quality = parseQualityScore_(safeGetByName(row, headerMap, CLAUDE_COLUMNS.QUALITY));
    var playersYtd = Number(safeGetByName(row, headerMap, METRICS_COLUMNS.PLAYERS_YTD)) || 0;
    var completionRate = Number(safeGetByName(row, headerMap, METRICS_COLUMNS.COMPLETION_RATE)) || 0;
    var playersTrend = String(safeGetByName(row, headerMap, METRICS_COLUMNS.PLAYERS_TREND) || '');

    var demo = {
      row: i + ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1,
      title: title,
      tdp: tdp,
      product: String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PRODUCT) || ''),
      team: team,
      creator: String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_NAME) || ''),
      quality: quality,
      playersYtd: playersYtd,
      completionRate: completionRate,
      ctaClicksYtd: Number(safeGetByName(row, headerMap, METRICS_COLUMNS.CTA_CLICKS_YTD)) || 0,
      playersTrend: playersTrend,
      completionTrend: String(safeGetByName(row, headerMap, METRICS_COLUMNS.COMPLETION_TREND) || ''),
      uvsYtd: Number(safeGetByName(row, headerMap, METRICS_COLUMNS.UNIQUE_VISITORS_YTD)) || 0,
      inquiriesYtd: Number(safeGetByName(row, headerMap, METRICS_COLUMNS.INQUIRIES_YTD)) || 0,
      oppsYtd: Number(safeGetByName(row, headerMap, METRICS_COLUMNS.OPPS_YTD)) || 0,
      oppValueYtd: Number(safeGetByName(row, headerMap, METRICS_COLUMNS.OPP_VALUE_YTD)) || 0,
      winsYtd: Number(safeGetByName(row, headerMap, METRICS_COLUMNS.WINS_YTD)) || 0,
      wonValueYtd: Number(safeGetByName(row, headerMap, METRICS_COLUMNS.WON_VALUE_YTD)) || 0,
      overlapScore: parseOverlapScore_(safeGetByName(row, headerMap, CLAUDE_COLUMNS.OVERLAP)),
      overlapNote: String(safeGetByName(row, headerMap, CLAUDE_COLUMNS.OVERLAP) || ''),
      qualityNote: String(safeGetByName(row, headerMap, CLAUDE_COLUMNS.QUALITY) || ''),
      note: String(safeGetByName(row, headerMap, CLAUDE_COLUMNS.NOTE) || ''),
      action: action,
      lifecycleScore: lifecycleScore,
      lifecycleReason: String(safeGetByName(row, headerMap, LIFECYCLE_COLUMNS.REASON) || ''),
      publishedDate: String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS) || '')
    };

    demos.push(demo);

    if (actionSummary[action] !== undefined) actionSummary[action]++;

    if (!tdpSummary[tdp]) tdpSummary[tdp] = { count: 0, totalQuality: 0, totalPlayers: 0, qualityCount: 0, actions: { Promote: 0, Refresh: 0, Retire: 0, Review: 0, Keep: 0 } };
    tdpSummary[tdp].count++;
    if (quality !== null) { tdpSummary[tdp].totalQuality += quality; tdpSummary[tdp].qualityCount++; }
    tdpSummary[tdp].totalPlayers += playersYtd;
    if (tdpSummary[tdp].actions[action] !== undefined) tdpSummary[tdp].actions[action]++;

    if (!teamSummary[team]) teamSummary[team] = { count: 0, totalQuality: 0, totalPlayers: 0, qualityCount: 0, actions: { Promote: 0, Refresh: 0, Retire: 0, Review: 0, Keep: 0 } };
    teamSummary[team].count++;
    if (quality !== null) { teamSummary[team].totalQuality += quality; teamSummary[team].qualityCount++; }
    teamSummary[team].totalPlayers += playersYtd;
    if (teamSummary[team].actions[action] !== undefined) teamSummary[team].actions[action]++;
  }

  Object.keys(tdpSummary).forEach(function(k) {
    var s = tdpSummary[k];
    s.avgQuality = s.qualityCount > 0 ? Math.round(s.totalQuality / s.qualityCount) : null;
    s.avgPlayers = s.count > 0 ? Math.round(s.totalPlayers / s.count) : 0;
  });
  Object.keys(teamSummary).forEach(function(k) {
    var s = teamSummary[k];
    s.avgQuality = s.qualityCount > 0 ? Math.round(s.totalQuality / s.qualityCount) : null;
    s.avgPlayers = s.count > 0 ? Math.round(s.totalPlayers / s.count) : 0;
  });

  return {
    demos: demos,
    tdpSummary: tdpSummary,
    teamSummary: teamSummary,
    actionSummary: actionSummary,
    lastUpdated: new Date().toISOString()
  };
}
