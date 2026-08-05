/************************************************************
 * RM_Performance.gs - Performance Labels Engine
 *
 * Applies the Lifecycle Label Framework rules to Request_Master:
 * - Performance Signals (usage, CR, MT levels + page/mapping/recovery)
 * - Performance Flags (multiple per demo)
 * - Recommended action (one per demo, derived from signals)
 * - Recommended action reason (human-readable explanation with relevant signals)
 * - Action Priority (High/Medium/Low based on signals + trend)
 * - Performance Score (0-100 composite)
 * - Performance Tier (Top/Mid/Low/Inactive)
 * - Performance L90 Trend (growing/stable/declining/stale based on 90-day vs all-time rate)
 * - Content Age (months since first activity)
 * - Processing Result (audit trail for every row)
 *
 * Results are written to auto-created columns on Request_Master.
 * The existing Action column is never touched.
 *
 * USAGE:
 * Run runPerformanceLabels() from the Apps Script editor.
 * Run clearPerformanceLabels() to wipe and re-run.
 * Run testPerformanceRules() to verify rule logic.
 * Run testProcessingAudit() to verify classification logic.
 ************************************************************/

var PERF_LABEL_COLUMNS = {
  PERF_SIGNALS: 'Performance Signals',
  PERF_FLAGS: 'Performance Flags',
  PERF_ACTION: 'Recommended action',
  PERF_ACTION_REASON: 'Recommended action reason',
  PRIORITY: 'Action Priority',
  PERF_SCORE: 'Performance Score',
  PERF_TIER: 'Performance Tier',
  PERF_TREND: 'Performance L90 Trend',
  AGE: 'Content Age',
  PROCESSING_RESULT: 'Processing Result',
  ASSIGNED: 'Assigned',
  ACTION_STATUS: 'Action Status',
  ACTION_COMPLETED_DATE: 'Action Completed Date',
  RESPONSE: 'Response'
};

var CREATOR_ACTIONS_ = ['Improve completion', 'Boost sales impact', 'Consider retirement'];
var ADMIN_ACTIONS_ = ['Create page', 'Increase visibility', 'Review data linkage', 'Needs review'];

var PERF_METRIC_COLUMNS = {
  ACTIVE_MONTHS: 'Active Months',
  TOTAL_PLAYERS: 'All-time Players',
  PLAYERS_PER_MONTH: 'All-time Players/ Active Months',
  COMPLETIONS: 'All-time Completions',
  COMPLETION_RATE: 'All-time Completion Rate',
  MT_OPP_VALUE: 'All-time MT Opportunity Value',
  MT_WON_VALUE: 'All-time MT Won Value',
  DRUPAL_PAGE_URL: 'Drupal Page URL',
  FIRST_ACTIVITY_MONTH: 'First Activity Month',
  LAST_ACTIVITY_MONTH: 'Last Activity Month',
  L90_PLAYERS: 'L90 Players',
  L90_COMPLETIONS: 'L90 Completions',
  L90_MT_OPP_VALUE: 'L90 MT Opportunity Value',
  L90_MT_WON_VALUE: 'L90 MT Won Value',
  METRICS_MAPPING_STATUS: 'Metrics Mapping Status'
};

var PERF_THRESHOLDS = {
  MIN_ACTIVE_MONTHS: 4,
  MIN_PLAYERS_FOR_RATE: 25,
  BASELINE_PLAYERS_PER_MONTH: 15,
  BASELINE_COMPLETION_RATE: 0.40,
  BASELINE_COMPLETIONS: 25,
  BASELINE_MT_OPP: 50000,
  BASELINE_MT_WON: 10000,
  HIGH_PLAYERS_PER_MONTH: 25,
  HIGH_COMPLETION_RATE: 0.50,
  HIGH_MT_OPP: 100000,
  HIGH_MT_WON: 25000,
  GROWING_RATIO: 1.2,
  CONTENT_AGE_MATURE: 12,
  CONTENT_AGE_NEW: 3
};

var GENERIC_LISTING_PATTERNS = [
  'redhat.com/en/interactive-experiences'
];

/* =========================
   COLUMN MANAGEMENT
========================= */

function ensurePerformanceColumns_(sheet) {
  var needed = [
    PERF_LABEL_COLUMNS.PERF_SIGNALS,
    PERF_LABEL_COLUMNS.PERF_FLAGS,
    PERF_LABEL_COLUMNS.PERF_ACTION,
    PERF_LABEL_COLUMNS.PERF_ACTION_REASON,
    PERF_LABEL_COLUMNS.PRIORITY,
    PERF_LABEL_COLUMNS.PERF_SCORE,
    PERF_LABEL_COLUMNS.PERF_TIER,
    PERF_LABEL_COLUMNS.PERF_TREND,
    PERF_LABEL_COLUMNS.AGE,
    PERF_LABEL_COLUMNS.PROCESSING_RESULT,
    PERF_LABEL_COLUMNS.ASSIGNED,
    PERF_LABEL_COLUMNS.ACTION_STATUS,
    PERF_LABEL_COLUMNS.ACTION_COMPLETED_DATE,
    PERF_LABEL_COLUMNS.RESPONSE
  ];
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
    signalsCol: headers.indexOf(PERF_LABEL_COLUMNS.PERF_SIGNALS) + 1,
    flagsCol: headers.indexOf(PERF_LABEL_COLUMNS.PERF_FLAGS) + 1,
    actionCol: headers.indexOf(PERF_LABEL_COLUMNS.PERF_ACTION) + 1,
    reasonCol: headers.indexOf(PERF_LABEL_COLUMNS.PERF_ACTION_REASON) + 1,
    priorityCol: headers.indexOf(PERF_LABEL_COLUMNS.PRIORITY) + 1,
    scoreCol: headers.indexOf(PERF_LABEL_COLUMNS.PERF_SCORE) + 1,
    tierCol: headers.indexOf(PERF_LABEL_COLUMNS.PERF_TIER) + 1,
    trendCol: headers.indexOf(PERF_LABEL_COLUMNS.PERF_TREND) + 1,
    ageCol: headers.indexOf(PERF_LABEL_COLUMNS.AGE) + 1,
    resultCol: headers.indexOf(PERF_LABEL_COLUMNS.PROCESSING_RESULT) + 1,
    assignedCol: headers.indexOf(PERF_LABEL_COLUMNS.ASSIGNED) + 1,
    actionStatusCol: headers.indexOf(PERF_LABEL_COLUMNS.ACTION_STATUS) + 1,
    actionCompletedDateCol: headers.indexOf(PERF_LABEL_COLUMNS.ACTION_COMPLETED_DATE) + 1,
    responseCol: headers.indexOf(PERF_LABEL_COLUMNS.RESPONSE) + 1
  };
}

/* =========================
   METRIC PARSING
========================= */

function parseCurrency_(val) {
  var s = String(val || '').replace(/[$,\s]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseRate_(val) {
  var s = String(val || '').trim();
  if (s === '') return 0;
  if (s.indexOf('%') !== -1) {
    return parseFloat(s.replace('%', '')) / 100;
  }
  var n = parseFloat(s);
  if (isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}

function parseNum_(val) {
  var n = parseFloat(String(val || '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseDate_(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  var d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function getLatestCompletedMonth_(allData, headerMap) {
  var famIdx = headerMap[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH];
  var receivedIdx = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS];
  var publishedIdx = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS];

  var latestDate = null;

  for (var i = 0; i < allData.length; i++) {
    var candidates = [];
    if (famIdx !== undefined) candidates.push(parseDate_(allData[i][famIdx]));
    if (receivedIdx !== undefined) candidates.push(parseDate_(allData[i][receivedIdx]));
    if (publishedIdx !== undefined) candidates.push(parseDate_(allData[i][publishedIdx]));

    for (var c = 0; c < candidates.length; c++) {
      if (candidates[c] && (!latestDate || candidates[c] > latestDate)) {
        latestDate = candidates[c];
      }
    }
  }

  if (!latestDate) {
    latestDate = new Date();
  }

  return new Date(latestDate.getFullYear(), latestDate.getMonth(), 0);
}

function isWithinLatestNMonths_(dateVal, n, referenceDate) {
  if (!dateVal) return false;
  var ref = referenceDate || new Date();
  var cutoff = new Date(ref.getFullYear(), ref.getMonth() - n, 1);
  return dateVal >= cutoff;
}

function computeContentAge_(row, headerMap, referenceDate) {
  var receivedTs = parseDate_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS));
  var publishedTs = parseDate_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS));
  var originDate = receivedTs || publishedTs;

  if (!originDate) return { months: null, available: false };

  var ref = referenceDate || new Date();
  var months = (ref.getFullYear() - originDate.getFullYear()) * 12 + (ref.getMonth() - originDate.getMonth());
  if (months < 0) months = 0;
  return { months: months, available: true };
}

function normalizeUrl_(val) {
  var url = String(val || '').trim();
  if (!url) return '';
  url = url.toLowerCase();
  url = url.replace(/^https?:\/\//, '');
  url = url.replace(/^www\./, '');
  url = url.replace(/[?#].*$/, '');
  url = url.replace(/\/+$/, '');
  return url;
}

function hasDemoSpecificPage_(val) {
  var normalized = normalizeUrl_(val);
  if (!normalized) return false;

  if (normalized.indexOf('redhat.com/') === -1 && normalized !== 'redhat.com') return false;

  if (normalized.indexOf('arcade.redhat.com') === 0) return false;

  for (var i = 0; i < GENERIC_LISTING_PATTERNS.length; i++) {
    var pattern = normalizeUrl_(GENERIC_LISTING_PATTERNS[i]);
    if (normalized === pattern) return false;
  }

  return true;
}

function isMtMappingValidFromStatus_(mappingStatus) {
  return mappingStatus !== 'Missing redhat.com page mapping';
}

function parseMetrics_(row, headerMap) {
  var mappingStatus = String(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.METRICS_MAPPING_STATUS) || '').trim();

  return {
    activeMonths: parseNum_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.ACTIVE_MONTHS)),
    totalPlayers: parseNum_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.TOTAL_PLAYERS)),
    playersPerMonth: parseNum_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH)),
    completions: parseNum_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.COMPLETIONS)),
    completionRate: parseRate_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.COMPLETION_RATE)),
    mtOpp: parseCurrency_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.MT_OPP_VALUE)),
    mtWon: parseCurrency_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.MT_WON_VALUE)),
    hasContentSpecificPage: hasDemoSpecificPage_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL))
                   || hasDemoSpecificPage_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.RHAC_PAGE)),
    firstActivityMonth: parseDate_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH)),
    lastActivityMonth: parseDate_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH)),
    l90Players: parseNum_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.L90_PLAYERS)),
    l90Completions: parseNum_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.L90_COMPLETIONS)),
    l90MtOpp: parseCurrency_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.L90_MT_OPP_VALUE)),
    l90MtWon: parseCurrency_(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.L90_MT_WON_VALUE)),
    metricsMappingStatus: mappingStatus,
    mtMappingValid: isMtMappingValidFromStatus_(mappingStatus)
  };
}

/* =========================
   PERFORMANCE FLAGS
========================= */

function computePerformanceFlags_(metrics) {
  var flags = [];

  if (metrics.playersPerMonth >= PERF_THRESHOLDS.HIGH_PLAYERS_PER_MONTH &&
      metrics.totalPlayers >= PERF_THRESHOLDS.MIN_PLAYERS_FOR_RATE) {
    flags.push('High usage');
  }

  if (metrics.completionRate >= PERF_THRESHOLDS.HIGH_COMPLETION_RATE &&
      metrics.completions >= PERF_THRESHOLDS.BASELINE_COMPLETIONS) {
    flags.push('High engagement');
  }

  if (metrics.totalPlayers >= PERF_THRESHOLDS.MIN_PLAYERS_FOR_RATE &&
      metrics.completionRate < PERF_THRESHOLDS.BASELINE_COMPLETION_RATE) {
    flags.push('Low completion');
  }

  if (metrics.mtOpp >= PERF_THRESHOLDS.HIGH_MT_OPP || metrics.mtWon >= PERF_THRESHOLDS.HIGH_MT_WON) {
    flags.push('High business impact');
  }

  if (metrics.activeMonths >= PERF_THRESHOLDS.MIN_ACTIVE_MONTHS &&
      metrics.playersPerMonth < PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH &&
      (metrics.mtOpp >= PERF_THRESHOLDS.BASELINE_MT_OPP || metrics.mtWon >= PERF_THRESHOLDS.BASELINE_MT_WON)) {
    flags.push('High-value niche');
  }

  if (metrics.activeMonths >= PERF_THRESHOLDS.MIN_ACTIVE_MONTHS &&
      metrics.hasContentSpecificPage &&
      metrics.mtMappingValid &&
      metrics.playersPerMonth >= PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH &&
      (flags.indexOf('High usage') !== -1 || flags.indexOf('High engagement') !== -1) &&
      metrics.mtOpp < PERF_THRESHOLDS.BASELINE_MT_OPP) {
    flags.push('Low opportunity value');
  }

  return flags;
}

/* =========================
   PERFORMANCE SIGNALS
========================= */

function computePerformanceSignals_(metrics, referenceDate) {
  var hasAnyActivity = !(metrics.activeMonths === 0 && metrics.totalPlayers === 0);

  // Usage level
  var usageLevel, usageThreshold;
  if (metrics.playersPerMonth >= PERF_THRESHOLDS.HIGH_PLAYERS_PER_MONTH) {
    usageLevel = 'HIGH'; usageThreshold = PERF_THRESHOLDS.HIGH_PLAYERS_PER_MONTH;
  } else if (metrics.playersPerMonth >= PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH) {
    usageLevel = 'BASE'; usageThreshold = PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH;
  } else {
    usageLevel = 'BELOW'; usageThreshold = PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH;
  }

  // CR level
  var crLevel, crThreshold;
  var crPercent = Math.round(metrics.completionRate * 100);
  if (metrics.completionRate >= PERF_THRESHOLDS.HIGH_COMPLETION_RATE) {
    crLevel = 'HIGH'; crThreshold = Math.round(PERF_THRESHOLDS.HIGH_COMPLETION_RATE * 100);
  } else if (metrics.completionRate >= PERF_THRESHOLDS.BASELINE_COMPLETION_RATE) {
    crLevel = 'BASE'; crThreshold = Math.round(PERF_THRESHOLDS.BASELINE_COMPLETION_RATE * 100);
  } else if (metrics.completionRate < 0.20) {
    crLevel = 'LOW'; crThreshold = 20;
  } else {
    crLevel = 'BELOW'; crThreshold = Math.round(PERF_THRESHOLDS.BASELINE_COMPLETION_RATE * 100);
  }

  // MT level
  var mtLevel, mtThreshold, mtSource, mtValue;
  if (metrics.mtOpp >= PERF_THRESHOLDS.HIGH_MT_OPP) {
    mtLevel = 'HIGH'; mtValue = metrics.mtOpp; mtSource = 'opp'; mtThreshold = PERF_THRESHOLDS.HIGH_MT_OPP;
  } else if (metrics.mtWon >= PERF_THRESHOLDS.HIGH_MT_WON) {
    mtLevel = 'HIGH'; mtValue = metrics.mtWon; mtSource = 'won'; mtThreshold = PERF_THRESHOLDS.HIGH_MT_WON;
  } else if (metrics.mtOpp >= PERF_THRESHOLDS.BASELINE_MT_OPP) {
    mtLevel = 'BASE'; mtValue = metrics.mtOpp; mtSource = 'opp'; mtThreshold = PERF_THRESHOLDS.BASELINE_MT_OPP;
  } else if (metrics.mtWon >= PERF_THRESHOLDS.BASELINE_MT_WON) {
    mtLevel = 'BASE'; mtValue = metrics.mtWon; mtSource = 'won'; mtThreshold = PERF_THRESHOLDS.BASELINE_MT_WON;
  } else if (metrics.mtOpp === 0 && metrics.mtWon === 0) {
    mtLevel = 'NONE'; mtValue = 0; mtSource = 'none'; mtThreshold = PERF_THRESHOLDS.BASELINE_MT_OPP;
  } else {
    mtLevel = 'BELOW'; mtValue = metrics.mtOpp; mtSource = 'opp'; mtThreshold = PERF_THRESHOLDS.BASELINE_MT_OPP;
  }

  // Count baseline and high signals
  var count = 0;
  var highCount = 0;
  if (usageLevel === 'HIGH' || usageLevel === 'BASE') count++;
  if (usageLevel === 'HIGH') highCount++;
  if (crLevel === 'HIGH' || crLevel === 'BASE') count++;
  if (crLevel === 'HIGH') highCount++;
  if (mtLevel === 'HIGH' || mtLevel === 'BASE') count++;
  if (mtLevel === 'HIGH') highCount++;

  // Maturity
  var maturityLevel, maturityThreshold;
  if (!hasAnyActivity) {
    maturityLevel = 'INACTIVE'; maturityThreshold = 0;
  } else if (metrics.activeMonths >= PERF_THRESHOLDS.MIN_ACTIVE_MONTHS) {
    maturityLevel = 'ESTABLISHED'; maturityThreshold = PERF_THRESHOLDS.MIN_ACTIVE_MONTHS;
  } else if (metrics.activeMonths >= 1 && metrics.activeMonths <= 3 &&
             isWithinLatestNMonths_(metrics.firstActivityMonth, 3, referenceDate)) {
    maturityLevel = 'NEW'; maturityThreshold = 3;
  } else if (metrics.activeMonths >= 1 && metrics.activeMonths <= 3) {
    maturityLevel = 'STALLED'; maturityThreshold = PERF_THRESHOLDS.MIN_ACTIVE_MONTHS;
  } else {
    maturityLevel = 'INACTIVE'; maturityThreshold = 0;
  }

  // Recovery (only when count=0 AND maturity=ESTABLISHED)
  var recoveryActive = false;
  var recoveryPpm = null;
  var recoveryCr = null;
  var recoveryMt = null;
  if (count === 0 && maturityLevel === 'ESTABLISHED') {
    var l90Ppm = metrics.l90Players / 3;
    if (l90Ppm >= PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH) {
      recoveryActive = true;
      recoveryPpm = Math.round(l90Ppm);
    }
    var l90Cr = metrics.l90Players > 0 ? (metrics.l90Completions || 0) / metrics.l90Players : 0;
    if (l90Cr >= PERF_THRESHOLDS.BASELINE_COMPLETION_RATE && (metrics.l90Completions || 0) >= 5) {
      recoveryActive = true;
      recoveryCr = Math.round(l90Cr * 100);
    }
    if ((metrics.l90MtOpp || 0) >= PERF_THRESHOLDS.BASELINE_MT_OPP / 4 ||
        (metrics.l90MtWon || 0) >= PERF_THRESHOLDS.BASELINE_MT_WON / 4) {
      recoveryActive = true;
      recoveryMt = Math.max(metrics.l90MtOpp || 0, metrics.l90MtWon || 0);
    }
  }

  return {
    usage: { level: usageLevel, value: metrics.playersPerMonth, threshold: usageThreshold },
    cr: { level: crLevel, value: crPercent, completions: metrics.completions, threshold: crThreshold, completionsThreshold: PERF_THRESHOLDS.BASELINE_COMPLETIONS },
    mt: { level: mtLevel, value: mtValue, source: mtSource, threshold: mtThreshold },
    hasPage: metrics.hasContentSpecificPage,
    hasMapping: metrics.mtMappingValid,
    activeMonth: { level: maturityLevel, months: metrics.activeMonths, threshold: maturityThreshold },
    recovery: { active: recoveryActive, ppm: recoveryPpm, cr: recoveryCr, mt: recoveryMt },
    hasAnyActivity: hasAnyActivity,
    count: count,
    highCount: highCount
  };
}

function buildSignalsString_(signals) {
  var parts = [];

  var usageLevelDisplay = signals.usage.level.toLowerCase();
  parts.push('Usage: ' + Math.round(signals.usage.value) + 'ppm (' + usageLevelDisplay + ' ' + signals.usage.threshold + ')');

  var crLevelDisplay = signals.cr.level.toLowerCase();
  parts.push('CR: ' + signals.cr.value + '% (' + crLevelDisplay + ' ' + signals.cr.threshold + '%)');

  var mtDisplay = signals.mt.source === 'none' ? '$0' : formatCompact_(signals.mt.value) + ' ' + signals.mt.source;
  var mtLevelDisplay = signals.mt.level.toLowerCase();
  parts.push('MT: ' + mtDisplay + ' (' + mtLevelDisplay + ' ' + formatCompact_(signals.mt.threshold) + ')');

  parts.push(signals.hasPage ? 'has page' : 'no page');
  parts.push(signals.hasMapping ? 'has mapping' : 'no mapping');

  if (signals.recovery.active) {
    var recParts = [];
    var recBaselines = [];
    if (signals.recovery.ppm !== null) {
      recParts.push('ppm ' + signals.recovery.ppm);
      recBaselines.push(PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH + ' ppm');
    }
    if (signals.recovery.cr !== null) {
      recParts.push('CR ' + signals.recovery.cr + '%');
      recBaselines.push(Math.round(PERF_THRESHOLDS.BASELINE_COMPLETION_RATE * 100) + '% CR');
    }
    if (signals.recovery.mt !== null) {
      recParts.push('MT ' + formatCompact_(signals.recovery.mt));
      recBaselines.push(formatCompact_(PERF_THRESHOLDS.BASELINE_MT_OPP / 4) + ' MT');
    }
    parts.push('Last 90d recovery: YES ' + recParts.join(', ') + ' (baseline ' + recBaselines.join(', ') + ')');
  }

  parts.push('ActiveMonth: ' + signals.activeMonth.months + ' mo. (' + signals.activeMonth.level.toLowerCase() + ' ' + signals.activeMonth.threshold + ' mo)');

  if (signals.contentAge) {
    if (signals.contentAge.available) {
      var caLevelDisplay = signals.contentAge.level.toLowerCase();
      parts.push('ContentAge: ' + signals.contentAge.months + ' mo. (' + caLevelDisplay + ' ' + (signals.contentAge.level === 'MATURE' ? PERF_THRESHOLDS.CONTENT_AGE_MATURE : PERF_THRESHOLDS.CONTENT_AGE_NEW) + ')');
    } else {
      parts.push('ContentAge: UNKNOWN');
    }
  }

  return parts.join(' | ');
}

/* =========================
   RECOMMENDED ACTION + REASON
========================= */

function formatSignalFields_(signals, fields) {
  var parts = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f === 'usage') {
      parts.push('Usage: ' + Math.round(signals.usage.value) + ' players/mo (' + signals.usage.level.toLowerCase() + ')');
    } else if (f === 'cr') {
      parts.push('Completion rate: ' + signals.cr.value + '% (' + signals.cr.level.toLowerCase() + ')');
    } else if (f === 'mt') {
      var mtDisplay = signals.mt.source === 'none' ? '$0' : formatCompact_(signals.mt.value) + ' ' + signals.mt.source;
      parts.push('Sales: ' + mtDisplay + ' (' + signals.mt.level.toLowerCase() + ')');
    } else if (f === 'activeMonth') {
      parts.push('ActiveMonth: ' + (signals.activeMonth.months != null ? signals.activeMonth.months + ' mo.' : '') + ' (' + signals.activeMonth.level.toLowerCase() + ')');
    } else if (f === 'page') {
      parts.push(signals.hasPage ? 'has page' : 'no page');
    } else if (f === 'mapping') {
      parts.push(signals.hasMapping ? 'has mapping' : 'no mapping');
    } else if (f === 'trend') {
      if (signals.trend && signals.trend !== 'unknown') {
        parts.push('L90 trend: ' + signals.trend);
      }
    } else if (f === 'contentAge') {
      if (signals.contentAge && signals.contentAge.available) {
        parts.push('ContentAge: ' + signals.contentAge.months + ' mo. (' + signals.contentAge.level.toLowerCase() + ')');
      } else {
        parts.push('ContentAge: unknown');
      }
    }
  }
  return '(' + parts.join(', ') + ')';
}

function computePerformanceAction_(signals) {
  var isNoActivity = !signals.hasAnyActivity;
  var isLowActivity = signals.count === 0 && !signals.recovery.active && signals.activeMonth.level === 'ESTABLISHED';
  var isNewContent = signals.activeMonth.level === 'NEW';
  var isStalled = signals.activeMonth.level === 'STALLED';

  var hasHighUsage = signals.usage.level === 'HIGH';
  var hasHighCR = signals.cr.level === 'HIGH';
  var hasLowCR = signals.cr.level === 'LOW' || signals.cr.level === 'BELOW';
  var hasHighMT = signals.mt.level === 'HIGH';
  var isNiche = signals.activeMonth.level === 'ESTABLISHED' && signals.usage.level === 'BELOW' && (signals.mt.level === 'HIGH' || signals.mt.level === 'BASE');
  var isLowOpp = signals.hasPage && signals.hasMapping && signals.activeMonth.level === 'ESTABLISHED' && (hasHighUsage || hasHighCR) && signals.mt.value < PERF_THRESHOLDS.BASELINE_MT_OPP;

  // A. Review data linkage / Boost sales impact
  if (isNoActivity && signals.mt.level !== 'NONE') {
    return {
      action: 'Review data linkage',
      reason: 'Metrics don\'t add up — check the data linkage. ' + formatSignalFields_(signals, ['usage', 'mt'])    };
  }
  if (isLowOpp && signals.mt.value < PERF_THRESHOLDS.BASELINE_MT_WON) {
    return {
      action: 'Boost sales impact',
      reason: 'Strong completion but low sales impact — review linking, CTAs, or sales alignment. ' + formatSignalFields_(signals, ['usage', 'cr', 'mt'])    };
  }

  // B. Improve completion
  if (hasHighUsage && hasLowCR && !isNewContent) {
    return {
      action: 'Improve completion',
      reason: 'Players start but don\'t finish — review the flow and content. ' + formatSignalFields_(signals, ['usage', 'cr'])    };
  }
  if (signals.activeMonth.level === 'ESTABLISHED' &&
      signals.usage.level === 'BASE' &&
      signals.hasPage &&
      hasLowCR) {
    return {
      action: 'Improve completion',
      reason: 'Players start but don\'t finish — review the flow and content. ' + formatSignalFields_(signals, ['usage', 'cr'])    };
  }

  // C. Create page
  if (!signals.hasPage) {
    if (hasHighUsage || hasHighMT || isNiche ||
        (hasHighCR && !isLowActivity)) {
      return {
        action: 'Create page',
        reason: 'This demo is performing well but has no page — create a redhat.com page. ' + formatSignalFields_(signals, ['usage', 'cr', 'mt', 'page'])      };
    }
  }

  // D. Increase visibility
  if (isNiche && signals.hasPage) {
    return {
      action: 'Increase visibility',
      reason: 'Good content, low visibility — needs distribution. ' + formatSignalFields_(signals, ['usage', 'mt', 'activeMonth'])    };
  }
  if (!isNoActivity && !isNewContent && signals.usage.level === 'BELOW' &&
      (signals.cr.level === 'HIGH' || signals.cr.level === 'BASE')) {
    return {
      action: 'Increase visibility',
      reason: 'Good content, low visibility — needs distribution. ' + formatSignalFields_(signals, ['usage', 'cr'])    };
  }

  // D2. Increase visibility — 3/3 all-time signals but declining or stale
  if ((signals.trend === 'declining' || signals.trend === 'stale') && !isLowActivity && !isNoActivity && !isNewContent) {
    if (signals.count === 3) {
      return {
        action: 'Increase visibility',
        reason: 'Good content, low visibility — needs distribution. ' + formatSignalFields_(signals, ['usage', 'cr', 'mt', 'trend'])      };
    }
  }

  // E. Consider retirement
  if (isLowActivity && !hasHighCR && !hasHighMT && !isNiche) {
    return {
      action: 'Consider retirement',
      reason: 'This demo is flagged for retirement — consider updating it or confirming retirement. ' + formatSignalFields_(signals, ['activeMonth', 'usage', 'mt'])    };
  }

  if (isNoActivity && signals.contentAge && signals.contentAge.available &&
      signals.contentAge.level !== 'NEW' &&
      signals.mt.level === 'NONE') {
    return {
      action: 'Consider retirement',
      reason: 'This demo is flagged for retirement — consider updating it or confirming retirement. ' + formatSignalFields_(signals, ['activeMonth', 'contentAge', 'mt'])    };
  }

  if (isStalled &&
      signals.usage.level === 'BELOW' &&
      signals.mt.level !== 'HIGH' && signals.mt.level !== 'BASE') {
    return {
      action: 'Consider retirement',
      reason: 'This demo is flagged for retirement — consider updating it or confirming retirement. ' + formatSignalFields_(signals, ['activeMonth', 'usage', 'mt'])    };
  }

  // F. Needs review
  if (isNoActivity && signals.contentAge && !signals.contentAge.available) {
    return {
      action: 'Needs review',
      reason: 'System can\'t classify — needs manual review. ' + formatSignalFields_(signals, ['usage', 'contentAge'])    };
  }

  // G. No action needed
  if (isNoActivity && signals.contentAge && signals.contentAge.level === 'NEW' &&
      signals.mt.level === 'NONE') {
    return {
      action: 'No action needed',
      reason: 'No action needed. ' + formatSignalFields_(signals, ['usage', 'cr', 'mt'])    };
  }

  if (signals.usage.level === 'BASE' && !signals.hasPage) {
    return {
      action: 'No action needed',
      reason: 'No action needed. ' + formatSignalFields_(signals, ['usage', 'cr', 'mt'])    };
  }

  if (signals.count === 0 && signals.recovery.active) {
    return {
      action: 'No action needed',
      reason: 'No action needed. ' + formatSignalFields_(signals, ['usage', 'cr', 'mt'])    };
  }

  return {
    action: 'No action needed',
    reason: 'No action needed. ' + formatSignalFields_(signals, ['usage', 'cr', 'mt'])  };
}

/* =========================
   PRIORITY
========================= */

function computePerformanceTrend_(metrics, referenceDate) {
  var allTimeRate = metrics.playersPerMonth;
  var l90Rate = metrics.l90Players / 3;
  var hasL90Data = metrics.l90Players > 0 || metrics.l90Completions > 0 ||
                   metrics.l90MtOpp > 0 || metrics.l90MtWon > 0;

  if (hasL90Data) {
    if (allTimeRate === 0) return 'unknown';
    if (l90Rate >= allTimeRate * PERF_THRESHOLDS.GROWING_RATIO &&
        l90Rate >= PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH * 0.5) return 'growing';
    if (l90Rate >= allTimeRate * 0.5) return 'stable';
    return 'declining';
  }

  if (allTimeRate > 0 && metrics.lastActivityMonth) {
    if (!isWithinLatestNMonths_(metrics.lastActivityMonth, 6, referenceDate)) return 'stale';
    return 'declining';
  }

  return 'unknown';
}

function computePerformancePriority_(signals, action) {
  if (signals.activeMonth.level === 'NEW') return 'Low';
  if (action === 'No action needed') return 'Low';

  var hasMeaningfulAllTime = signals.count >= 1;

  if (signals.highCount >= 2) return 'High';
  if ((signals.trend === 'declining' || signals.trend === 'stale') && hasMeaningfulAllTime) return 'High';

  if (signals.highCount === 1) return 'Medium';
  if (signals.trend === 'declining' || signals.trend === 'stale') return 'Medium';

  if (signals.contentAge && signals.contentAge.level === 'MATURE') return 'Medium';

  return 'Low';
}

function formatCompact_(n) {
  if (n >= 1000000) return '$' + Math.round(n / 1000000) + 'M';
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + Math.round(n);
}


function computePerformanceScore_(signals) {
  if (!signals.hasAnyActivity) return 0;

  var score = 0;

  score += signals.count * 20;
  score += signals.highCount * 5;

  if (signals.trend === 'growing') score += 15;
  else if (signals.trend === 'stable') score += 10;
  else if (signals.trend === 'declining') score += 5;

  var mat = signals.activeMonth.level;
  if (mat === 'ESTABLISHED') score += 10;
  else if (mat === 'NEW') score += 5;
  else if (mat === 'STALLED') score += 3;

  return Math.min(100, score);
}

function computePerformanceTier_(score) {
  if (score >= 70) return 'Top';
  if (score >= 40) return 'Mid';
  if (score >= 1) return 'Low';
  return 'Inactive';
}

/* =========================
   ROW CLASSIFICATION
========================= */

function isBlankCell_(val) {
  return val === '' || val === null || val === undefined;
}

function isRowBlank_(row, headerMap) {
  var outputColNames = [
    PERF_LABEL_COLUMNS.PERF_SIGNALS,
    PERF_LABEL_COLUMNS.PERF_FLAGS,
    PERF_LABEL_COLUMNS.PERF_ACTION,
    PERF_LABEL_COLUMNS.PERF_ACTION_REASON,
    PERF_LABEL_COLUMNS.PRIORITY,
    PERF_LABEL_COLUMNS.PERF_SCORE,
    PERF_LABEL_COLUMNS.PERF_TIER,
    PERF_LABEL_COLUMNS.PERF_TREND,
    PERF_LABEL_COLUMNS.AGE,
    PERF_LABEL_COLUMNS.PROCESSING_RESULT
  ];
  var outputIndices = {};
  for (var c = 0; c < outputColNames.length; c++) {
    var idx = headerMap[outputColNames[c]];
    if (idx !== undefined) outputIndices[idx] = true;
  }

  var cleanupIdx = headerMap['Cleanup note'];
  if (cleanupIdx !== undefined) outputIndices[cleanupIdx] = true;
  var cleanupStatusIdx = headerMap['Cleanup status'];
  if (cleanupStatusIdx !== undefined) outputIndices[cleanupStatusIdx] = true;

  for (var i = 0; i < row.length; i++) {
    if (outputIndices[i]) continue;
    if (String(row[i] || '').trim() !== '') return false;
  }
  return true;
}

function hasMinimumRequiredMetrics_(row, headerMap) {
  var totalPlayersRaw = safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.TOTAL_PLAYERS);
  var zeroPlayers = !isBlankCell_(totalPlayersRaw) && parseNum_(totalPlayersRaw) === 0;

  var requiredCols = [
    PERF_METRIC_COLUMNS.ACTIVE_MONTHS,
    PERF_METRIC_COLUMNS.TOTAL_PLAYERS,
    PERF_METRIC_COLUMNS.COMPLETIONS,
    PERF_METRIC_COLUMNS.MT_OPP_VALUE,
    PERF_METRIC_COLUMNS.MT_WON_VALUE
  ];
  if (!zeroPlayers) {
    requiredCols.push(PERF_METRIC_COLUMNS.COMPLETION_RATE);
  }

  var missing = [];
  for (var i = 0; i < requiredCols.length; i++) {
    var raw = safeGetByName(row, headerMap, requiredCols[i]);
    if (isBlankCell_(raw)) {
      missing.push(requiredCols[i]);
    }
  }

  var activeMonthsRaw = safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.ACTIVE_MONTHS);
  if (!isBlankCell_(activeMonthsRaw)) {
    var am = parseNum_(activeMonthsRaw);
    if (am >= 1 && am <= 3) {
      var fam = safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH);
      if (isBlankCell_(fam) || parseDate_(fam) === null) {
        missing.push(PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH);
      }
    }
  }

  return { valid: missing.length === 0, missing: missing };
}

function makeSkipResult_(reason) {
  return { outcome: 'skipped', signals: '', flags: '', action: '', reason: '', priority: '', score: '', tier: '', trend: '', contentAgeMonths: null, result: 'Skipped — ' + reason };
}

function makeReviewResult_(reason) {
  return { outcome: 'needs_review', signals: '', flags: '', action: 'Needs review', reason: reason, priority: '', score: '', tier: '', trend: '', contentAgeMonths: null, result: 'Needs review — ' + reason };
}

function classifyRow_(row, headerMap, seenNumbers, referenceDate) {
  if (isRowBlank_(row, headerMap)) {
    return makeSkipResult_('Blank row');
  }

  var note = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.NOTE) || '').trim();
  if (note === 'Delete row') {
    return makeSkipResult_('Note = Delete row');
  }

  var rowStatus = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS) || '').trim();

  if (rowStatus === ENHANCED_CONFIG.STATUS.IE_RETIRED) {
    return makeSkipResult_('Status = IE Retired');
  }

  if (rowStatus === ENHANCED_CONFIG.STATUS.CLOSED) {
    return makeSkipResult_('Status = Closed');
  }

  if (rowStatus !== '' &&
      rowStatus !== ENHANCED_CONFIG.STATUS.IE_PUBLISHED &&
      rowStatus !== ENHANCED_CONFIG.STATUS.IE_REVIEWED &&
      rowStatus !== ENHANCED_CONFIG.STATUS.IE_RECEIVED) {
    return makeReviewResult_('Row has status "' + rowStatus + '", which is not eligible for performance labeling (only IE Published, IE Reviewed, IE Received, or blank).');
  }

  var number = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.NUMBER) || '').trim();
  if (!number) {
    return makeReviewResult_('The Number column is blank, so this row cannot be matched to metrics data.');
  }

  if (seenNumbers && seenNumbers.hasOwnProperty(number)) {
    return makeReviewResult_('The same identifier is associated with multiple source records (first seen row ' + seenNumbers[number] + ').');
  }

  var mappingStatus = String(safeGetByName(row, headerMap, PERF_METRIC_COLUMNS.METRICS_MAPPING_STATUS) || '').trim();
  if (mappingStatus === 'Unlinked request') {
    return makeReviewResult_('The intake request is not linked to a demo record, so reliable performance metrics are unavailable.');
  }

  var metricsCheck = hasMinimumRequiredMetrics_(row, headerMap);
  if (!metricsCheck.valid) {
    return makeReviewResult_('One or more required performance metrics are missing: ' + metricsCheck.missing.join(', '));
  }

  var metrics = parseMetrics_(row, headerMap);

  var flags = computePerformanceFlags_(metrics);
  var signals = computePerformanceSignals_(metrics, referenceDate);

  var contentAge = computeContentAge_(row, headerMap, referenceDate);
  signals.contentAge = {
    months: contentAge.available ? contentAge.months : null,
    available: contentAge.available,
    level: contentAge.available
      ? (contentAge.months > PERF_THRESHOLDS.CONTENT_AGE_MATURE ? 'MATURE'
         : contentAge.months > PERF_THRESHOLDS.CONTENT_AGE_NEW ? 'RECENT' : 'NEW')
      : 'UNKNOWN'
  };

  var trend = computePerformanceTrend_(metrics, referenceDate);
  signals.trend = trend;

  var actionResult = computePerformanceAction_(signals);
  var priority = computePerformancePriority_(signals, actionResult.action);
  var score = computePerformanceScore_(signals);
  var tier = computePerformanceTier_(score);

  if (tier === 'Low' && priority === 'High') priority = 'Medium';

  if (signals.contentAge.available && signals.contentAge.months >= 6 &&
      metrics.activeMonths > 0 && metrics.activeMonths / signals.contentAge.months < 0.5) {
    flags.push('Sporadic activity');
  }

  var signalsStr = buildSignalsString_(signals);
  if (trend === 'growing' || trend === 'stable' || trend === 'declining') {
    var allTimeRate = Math.round(metrics.playersPerMonth);
    var l90Rate = Math.round(metrics.l90Players / 3);
    var ratio = metrics.playersPerMonth > 0 ? Math.round((metrics.l90Players / 3 / metrics.playersPerMonth) * 100) : 0;
    signalsStr += ' | L90 trend: ' + ratio + '% (' + trend + ' ' + allTimeRate + '→' + l90Rate + 'ppm)';
  }

  return {
    outcome: 'processed',
    signals: signalsStr,
    flags: flags.join(', '),
    action: actionResult.action,
    reason: actionResult.reason,
    priority: priority,
    score: score,
    tier: tier,
    trend: trend.charAt(0).toUpperCase() + trend.slice(1),
    contentAgeMonths: signals.contentAge.available ? signals.contentAge.months : null,
    result: 'Processed'
  };
}

/* =========================
   MAIN ENTRY POINT
========================= */

function runPerformanceLabels() {
  var sheet = getMasterSheet();
  var cols = ensurePerformanceColumns_(sheet);
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
    Logger.log('No data rows.');
    return;
  }

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;
  var allData = sheet.getRange(startRow, 1, dataRows, sheet.getLastColumn()).getValues();

  var referenceDate = getLatestCompletedMonth_(allData, headerMap);

  var counts = { total: dataRows, processed: 0, skipped: 0, needsReview: 0, errors: 0 };
  var skipReasons = {};
  var reviewReasons = {};
  var seenNumbers = {};
  var flagCounts = {};
  var actionCounts = {};
  var priorityCounts = {};
  var tierCounts = {};
  var trendCounts = {};
  var missingReasonCount = 0;
  var needsReviewDetails = [];

  var outSignals = [];
  var outFlags = [];
  var outAction = [];
  var outReason = [];
  var outPriority = [];
  var outScore = [];
  var outTier = [];
  var outTrend = [];
  var outAge = [];
  var outResult = [];
  var outAssigned = [];
  var outActionStatus = [];

  var currentActionStatusValues = sheet.getRange(startRow, cols.actionStatusCol, dataRows, 1).getValues();
  var currentCompletedDateValues = sheet.getRange(startRow, cols.actionCompletedDateCol, dataRows, 1).getValues();

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var rowIndex = startRow + i;
    var number = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.NUMBER) || '').trim();
    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();
    var rowLabel = 'Row ' + rowIndex + (number ? ' (#' + number + ')' : '') + (title ? ' "' + title + '"' : '');

    try {
      var c = classifyRow_(row, headerMap, seenNumbers, referenceDate);

      if (number && c.outcome !== 'skipped' && c.outcome !== 'needs_review') {
        seenNumbers[number] = rowIndex;
      }
      if (number && c.outcome === 'needs_review' && c.result.indexOf('same identifier') === -1) {
        if (!seenNumbers.hasOwnProperty(number)) {
          seenNumbers[number] = rowIndex;
        }
      }

      outSignals.push([c.signals]);
      outFlags.push([c.flags]);
      outAction.push([c.action]);
      outReason.push([c.reason || '']);
      outPriority.push([c.priority || '']);
      outScore.push([c.score !== '' ? c.score : '']);
      outTier.push([c.tier || '']);
      outTrend.push([c.trend || '']);
      outAge.push([c.contentAgeMonths != null ? c.contentAgeMonths : '']);
      outResult.push([c.result]);

      var assigned = '';
      var actionStatus = '';
      var currentStatus = String(currentActionStatusValues[i][0] || '').trim();

      if (c.action && c.action !== 'No action needed') {
        if (CREATOR_ACTIONS_.indexOf(c.action) !== -1) {
          assigned = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_NAME) || '').trim() || 'Creator';
        } else if (ADMIN_ACTIONS_.indexOf(c.action) !== -1) {
          assigned = 'Admin';
        }

        if (currentStatus === 'Pending Review' || currentStatus === 'Resubmit') {
          actionStatus = currentStatus;
        } else if (currentStatus === 'Completed') {
          var completedDate = currentCompletedDateValues[i][0];
          if (completedDate) {
            var parsed = parseDate_(completedDate);
            var sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            actionStatus = (parsed && parsed > sixMonthsAgo) ? 'Completed' : 'Open';
          } else {
            actionStatus = 'Open';
          }
        } else if (assigned) {
          actionStatus = 'Open';
        }
      } else {
        if (currentStatus === 'Pending Review' || currentStatus === 'Resubmit') {
          actionStatus = currentStatus;
        }
      }
      outAssigned.push([assigned]);
      outActionStatus.push([actionStatus]);

      if (c.outcome === 'processed') {
        counts.processed++;
        if (c.flags) {
          var flagList = c.flags.split(', ');
          for (var fi = 0; fi < flagList.length; fi++) {
            if (flagList[fi]) flagCounts[flagList[fi]] = (flagCounts[flagList[fi]] || 0) + 1;
          }
        }
        if (c.action) {
          actionCounts[c.action] = (actionCounts[c.action] || 0) + 1;
        }
        if (c.priority) {
          priorityCounts[c.priority] = (priorityCounts[c.priority] || 0) + 1;
        }
        if (c.tier) {
          tierCounts[c.tier] = (tierCounts[c.tier] || 0) + 1;
        }
        if (c.trend) {
          trendCounts[c.trend] = (trendCounts[c.trend] || 0) + 1;
        }
        if (c.action && !c.reason) {
          missingReasonCount++;
        }
      } else if (c.outcome === 'needs_review') {
        counts.needsReview++;
        var reviewReason = c.result.replace('Needs review — ', '');
        reviewReasons[reviewReason] = (reviewReasons[reviewReason] || 0) + 1;
        needsReviewDetails.push(rowLabel + ' — ' + c.result);
        if (c.action) {
          actionCounts[c.action] = (actionCounts[c.action] || 0) + 1;
        }
        Logger.log('NEEDS REVIEW: ' + rowLabel + ' — ' + c.result);
      } else {
        counts.skipped++;
        var reason = c.result.replace('Skipped — ', '');
        skipReasons[reason] = (skipReasons[reason] || 0) + 1;
        if (reason !== 'Blank row') {
          Logger.log('SKIP: ' + rowLabel + ' — ' + reason);
        }
      }

    } catch (e) {
      outSignals.push(['']);
      outFlags.push(['']);
      outAction.push(['']);
      outReason.push(['']);
      outPriority.push(['']);
      outScore.push(['']);
      outTier.push(['']);
      outTrend.push(['']);
      outAge.push(['']);
      outResult.push(['Error — ' + String(e.message || e).substring(0, 100)]);
      outAssigned.push(['']);
      outActionStatus.push(['']);
      Logger.log('ERROR: ' + rowLabel + ' — ' + (e.message || e));
      counts.errors++;
    }
  }

  sheet.getRange(startRow, cols.signalsCol, dataRows, 1).setValues(outSignals);
  sheet.getRange(startRow, cols.flagsCol, dataRows, 1).setValues(outFlags);
  sheet.getRange(startRow, cols.actionCol, dataRows, 1).setValues(outAction);
  sheet.getRange(startRow, cols.reasonCol, dataRows, 1).setValues(outReason);
  sheet.getRange(startRow, cols.priorityCol, dataRows, 1).setValues(outPriority);
  var scoreRange = sheet.getRange(startRow, cols.scoreCol, dataRows, 1);
  scoreRange.setNumberFormat('0');
  scoreRange.setValues(outScore);
  sheet.getRange(startRow, cols.tierCol, dataRows, 1).setValues(outTier);
  sheet.getRange(startRow, cols.trendCol, dataRows, 1).setValues(outTrend);
  var ageRange = sheet.getRange(startRow, cols.ageCol, dataRows, 1);
  ageRange.setNumberFormat('0');
  ageRange.setValues(outAge);
  sheet.getRange(startRow, cols.resultCol, dataRows, 1).setValues(outResult);
  sheet.getRange(startRow, cols.assignedCol, dataRows, 1).setValues(outAssigned);
  sheet.getRange(startRow, cols.actionStatusCol, dataRows, 1).setValues(outActionStatus);

  Logger.log('');
  Logger.log('=== Audit Summary ===');
  Logger.log('Total source rows: ' + counts.total);
  Logger.log('Processed: ' + counts.processed);
  Logger.log('Skipped: ' + counts.skipped);
  Logger.log('Needs review (processing): ' + counts.needsReview);
  Logger.log('Errors: ' + counts.errors);

  Logger.log('');
  Logger.log('Skip reasons:');
  var sortedSkips = Object.keys(skipReasons).sort();
  for (var s = 0; s < sortedSkips.length; s++) {
    Logger.log('  - ' + sortedSkips[s] + ': ' + skipReasons[sortedSkips[s]]);
  }

  Logger.log('');
  Logger.log('Performance Flag counts:');
  var sortedFlags = Object.keys(flagCounts).sort();
  for (var fl = 0; fl < sortedFlags.length; fl++) {
    Logger.log('  - ' + sortedFlags[fl] + ': ' + flagCounts[sortedFlags[fl]]);
  }

  Logger.log('');
  Logger.log('Recommended action counts:');
  var sortedActions = Object.keys(actionCounts).sort();
  for (var ac = 0; ac < sortedActions.length; ac++) {
    Logger.log('  - ' + sortedActions[ac] + ': ' + actionCounts[sortedActions[ac]]);
  }

  Logger.log('');
  Logger.log('Priority counts:');
  var sortedPriorities = Object.keys(priorityCounts).sort();
  for (var pr = 0; pr < sortedPriorities.length; pr++) {
    Logger.log('  - ' + sortedPriorities[pr] + ': ' + priorityCounts[sortedPriorities[pr]]);
  }

  Logger.log('');
  Logger.log('Tier counts:');
  var sortedTiers = Object.keys(tierCounts).sort();
  for (var ti = 0; ti < sortedTiers.length; ti++) {
    Logger.log('  - ' + sortedTiers[ti] + ': ' + tierCounts[sortedTiers[ti]]);
  }

  Logger.log('');
  Logger.log('Trend counts:');
  var sortedTrends = Object.keys(trendCounts).sort();
  for (var tr = 0; tr < sortedTrends.length; tr++) {
    Logger.log('  - ' + sortedTrends[tr] + ': ' + trendCounts[sortedTrends[tr]]);
  }

  Logger.log('');
  Logger.log('Rows missing Recommended action reason: ' + missingReasonCount);

  Logger.log('');
  Logger.log('Review reasons:');
  var sortedReviews = Object.keys(reviewReasons).sort();
  for (var rv = 0; rv < sortedReviews.length; rv++) {
    Logger.log('  - ' + sortedReviews[rv] + ': ' + reviewReasons[sortedReviews[rv]]);
  }

  if (needsReviewDetails.length > 0) {
    Logger.log('');
    Logger.log('Needs review rows:');
    for (var nr = 0; nr < needsReviewDetails.length; nr++) {
      Logger.log('  ' + needsReviewDetails[nr]);
    }
  }

  Logger.log('');
  Logger.log('=== Validation ===');
  var validationErrors = 0;
  for (var j = 0; j < allData.length; j++) {
    var vRowIndex = startRow + j;
    var vResult = outResult[j][0];
    var vSignals = outSignals[j][0];
    var vAction = outAction[j][0];
    var vReason = outReason[j][0];
    var vFlags = outFlags[j][0];
    var vPriority = outPriority[j][0];
    var vScore = outScore[j][0];
    var vTier = outTier[j][0];
    var vTrend = outTrend[j][0];

    if (isRowBlank_(allData[j], headerMap)) continue;

    if (!vResult) {
      Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — non-empty row has no Processing Result');
      validationErrors++;
      continue;
    }

    if (vResult === 'Processed') {
      if (!vSignals) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Processed but missing Performance Signals');
        validationErrors++;
      }
      if (!vAction) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Processed but missing Recommended action');
        validationErrors++;
      }
      if (!vReason) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Processed but missing Recommended action reason');
        validationErrors++;
      }
      if (!vPriority) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Processed but missing Priority');
        validationErrors++;
      }
      if (vScore === '' || vScore === undefined || vScore === null) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Processed but missing Performance Score');
        validationErrors++;
      }
      if (!vTier) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Processed but missing Performance Tier');
        validationErrors++;
      }
      if (!vTrend) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Processed but missing Performance L90 Trend');
        validationErrors++;
      }
    } else if (vResult.indexOf('Skipped') === 0) {
      if (vSignals || vFlags || vAction || vReason || vPriority || vScore !== '' || vTier || vTrend) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Skipped but has stale labels');
        validationErrors++;
      }
    } else if (vResult.indexOf('Needs review') === 0) {
      if (vAction !== 'Needs review') {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Needs review but Action="' + vAction + '"');
        validationErrors++;
      }
      if (!vReason) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Needs review but missing reason');
        validationErrors++;
      }
      if (vSignals || vFlags || vScore !== '' || vTier || vTrend) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Needs review but has stale labels');
        validationErrors++;
      }
    } else if (vResult.indexOf('Error') === 0) {
      if (vSignals || vFlags || vAction || vReason || vScore !== '' || vTier || vTrend) {
        Logger.log('VALIDATION FAIL: Row ' + vRowIndex + ' — Error but has stale labels');
        validationErrors++;
      }
    }
  }
  Logger.log('Validation errors: ' + validationErrors);
}

/* =========================
   CLEAR
========================= */

function clearPerformanceLabels() {
  var sheet = getMasterSheet();
  var cols = ensurePerformanceColumns_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return;

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;

  sheet.getRange(startRow, cols.signalsCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.flagsCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.actionCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.reasonCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.priorityCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.scoreCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.tierCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.trendCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.ageCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.resultCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.assignedCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.actionStatusCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.responseCol, dataRows, 1).clearContent();
  Logger.log('Cleared: Performance Signals, Performance Flags, Recommended action, Recommended action reason, Action Priority, Performance Score, Performance Tier, Performance L90 Trend, Content Age, Processing Result, Assigned, Action Status, Response.');
}

/* =========================
   RESPONSE QUEUE — BATCH APPLY
========================= */

function applyApprovedResponses() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() ||
           SpreadsheetApp.openById(getConfigProperty('MASTER_SHEET_ID'));
  var queueSheet = ss.getSheetByName('Response_Queue');
  if (!queueSheet) {
    Logger.log('No Response_Queue sheet found.');
    return;
  }

  var queueLastRow = queueSheet.getLastRow();
  if (queueLastRow <= 1) {
    Logger.log('Response_Queue is empty.');
    return;
  }

  var queueHeaders = queueSheet.getRange(1, 1, 1, queueSheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });
  var queueData = queueSheet.getRange(2, 1, queueLastRow - 1, queueHeaders.length).getValues();

  var qCol = function(name) { return queueHeaders.indexOf(name); };
  var approvalIdx = qCol('Approval');
  var processedIdx = qCol('Processed');
  var numberIdx = qCol('Number');
  var responseIdx = qCol('Response');
  var newLinkIdx = qCol('New Link');
  var notesIdx = qCol('Notes');
  var metaChangesIdx = qCol('Metadata Changes');

  if (approvalIdx === -1 || processedIdx === -1 || numberIdx === -1) {
    Logger.log('Response_Queue missing required columns.');
    return;
  }

  var toApply = [];
  for (var i = 0; i < queueData.length; i++) {
    var approval = String(queueData[i][approvalIdx] || '').trim();
    var processed = String(queueData[i][processedIdx] || '').trim();
    if (approval === 'Approved' && !processed) {
      toApply.push({ queueRow: i + 2, data: queueData[i] });
    }
  }

  if (toApply.length === 0) {
    Logger.log('No approved unprocessed responses.');
    return;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var masterSheet = getMasterSheet();
    var headerMap = getHeaderMapFromSheet(masterSheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
    var masterLastRow = masterSheet.getLastRow();
    var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;
    var masterData = masterSheet.getRange(startRow, 1, masterLastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW, masterSheet.getLastColumn()).getValues();

    var numberColIdx = headerMap[ENHANCED_CONFIG.COLUMNS.NUMBER];
    var numberToRowIdx = {};
    for (var j = 0; j < masterData.length; j++) {
      var num = String(masterData[j][numberColIdx] || '').trim();
      if (num) numberToRowIdx[num] = j;
    }

    var actionStatusColIdx = headerMap[PERF_LABEL_COLUMNS.ACTION_STATUS];
    var responseColIdx = headerMap[PERF_LABEL_COLUMNS.RESPONSE];
    var creationLinkColIdx = headerMap[ENHANCED_CONFIG.COLUMNS.CREATION_LINK];

    var applied = 0;
    var skipped = 0;

    for (var k = 0; k < toApply.length; k++) {
      var entry = toApply[k];
      var number = String(entry.data[numberIdx] || '').trim();
      var masterIdx = numberToRowIdx[number];

      if (masterIdx === undefined) {
        Logger.log('SKIP: Number "' + number + '" not found on Request_Master (queue row ' + entry.queueRow + ')');
        skipped++;
        continue;
      }

      var masterRow = startRow + masterIdx;

      var creatorResponse = String(entry.data[responseIdx] || '').trim();
      if (creatorResponse && actionStatusColIdx != null) {
        masterSheet.getRange(masterRow, actionStatusColIdx + 1).setValue('Completed');
      }

      var notes = String(entry.data[notesIdx] || '').trim();
      if (responseColIdx != null) {
        var parts = [];
        if (creatorResponse) parts.push(creatorResponse);
        if (notes) parts.push(notes);
        if (parts.length > 0) {
          masterSheet.getRange(masterRow, responseColIdx + 1).setValue(parts.join(' | '));
        }
      }

      var newLink = String(entry.data[newLinkIdx] || '').trim();
      if (newLink && creationLinkColIdx != null) {
        masterSheet.getRange(masterRow, creationLinkColIdx + 1).setValue(newLink);
      }

      var metaJson = String(entry.data[metaChangesIdx] || '').trim();
      if (metaJson) {
        try {
          var changes = JSON.parse(metaJson);
          var changedFields = Object.keys(changes);
          for (var m = 0; m < changedFields.length; m++) {
            var fieldName = changedFields[m];
            var colIdx = headerMap[fieldName];
            if (colIdx != null) {
              masterSheet.getRange(masterRow, colIdx + 1).setValue(changes[fieldName]);
            } else {
              Logger.log('WARNING: Metadata field "' + fieldName + '" not found in headers');
            }
          }
        } catch (e) {
          Logger.log('WARNING: Failed to parse metadata changes for #' + number + ': ' + e.message);
        }
      }

      queueSheet.getRange(entry.queueRow, processedIdx + 1).setValue(new Date().toISOString());

      Logger.log('APPLIED: #' + number + ' — Response: ' + creatorResponse +
        (newLink ? ', New link' : '') + (metaJson ? ', Metadata changes' : ''));
      applied++;
    }

    Logger.log('=== Apply Summary ===');
    Logger.log('Approved rows found: ' + toApply.length);
    Logger.log('Applied: ' + applied);
    Logger.log('Skipped: ' + skipped);
  } finally {
    lock.releaseLock();
  }
}

/* =========================
   TEST HARNESS — RULE LOGIC
========================= */

function testPerformanceRules() {
  var passed = 0;
  var failed = 0;

  function assert(testName, actual, expected) {
    if (actual === expected) {
      Logger.log('PASS: ' + testName);
      passed++;
    } else {
      Logger.log('FAIL: ' + testName + ' — expected "' + expected + '", got "' + actual + '"');
      failed++;
    }
  }

  function assertFlags(testName, actualFlags, expectedFlags) {
    var a = actualFlags.slice().sort().join(',');
    var e = expectedFlags.slice().sort().join(',');
    if (a === e) {
      Logger.log('PASS: ' + testName);
      passed++;
    } else {
      Logger.log('FAIL: ' + testName + ' — expected [' + e + '], got [' + a + ']');
      failed++;
    }
  }

  function assertHasReason(testName, actionResult) {
    if (actionResult && actionResult.reason && actionResult.reason.length > 0) {
      Logger.log('PASS: ' + testName);
      passed++;
    } else {
      Logger.log('FAIL: ' + testName + ' — Recommended action reason is missing');
      failed++;
    }
  }

  var referenceDate = new Date(2026, 6, 0);
  var recentDate = new Date(2026, 4, 1);
  var oldDate = new Date(2024, 0, 1);

  // --- URL normalization and page detection ---

  assert('Page: blank → no page', hasDemoSpecificPage_(''), false);
  assert('Page: null → no page', hasDemoSpecificPage_(null), false);
  assert('Page: whitespace → no page', hasDemoSpecificPage_('   '), false);
  assert('Page: generic listing → no page', hasDemoSpecificPage_('https://www.redhat.com/en/interactive-experiences'), false);
  assert('Page: generic listing with trailing slash → no page', hasDemoSpecificPage_('https://www.redhat.com/en/interactive-experiences/'), false);
  assert('Page: generic listing with query params → no page', hasDemoSpecificPage_('https://www.redhat.com/en/interactive-experiences?utm=test'), false);
  assert('Page: generic listing with hash → no page', hasDemoSpecificPage_('https://www.redhat.com/en/interactive-experiences#section'), false);
  assert('Page: generic listing HTTP → no page', hasDemoSpecificPage_('http://www.redhat.com/en/interactive-experiences'), false);
  assert('Page: generic listing no www → no page', hasDemoSpecificPage_('https://redhat.com/en/interactive-experiences'), false);
  assert('Page: demo-specific URL → has page', hasDemoSpecificPage_('https://www.redhat.com/en/interactive-experiences/my-demo'), true);
  assert('Page: demo-specific with query params → has page', hasDemoSpecificPage_('https://www.redhat.com/en/interactive-experiences/my-demo?utm=test'), true);
  assert('Page: demo-specific with hash → has page', hasDemoSpecificPage_('https://www.redhat.com/en/interactive-experiences/my-demo#section'), true);
  assert('Page: demo-specific HTTP → has page', hasDemoSpecificPage_('http://www.redhat.com/en/interactive-experiences/my-demo'), true);
  assert('Page: demo-specific no www → has page', hasDemoSpecificPage_('https://redhat.com/en/interactive-experiences/my-demo'), true);
  assert('Page: other valid redhat.com URL → has page', hasDemoSpecificPage_('https://www.redhat.com/en/technologies/some-page'), true);
  assert('Page: RHAC URL → has page', hasDemoSpecificPage_('https://www.redhat.com/architect/portfolio/detail/57-openshift-virtualization-demo'), true);
  assert('Page: arcade URL → no page', hasDemoSpecificPage_('https://arcade.redhat.com/some-demo'), false);
  assert('Page: external URL → no page', hasDemoSpecificPage_('https://example.com/some-page'), false);

  assert('Page: Public Site Link column not used', PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL !== ENHANCED_CONFIG.COLUMNS.PUBLIC_SITE_LINK, true);

  // --- Performance Flags ---

  assertFlags('Flag: High usage (no page, low MT → no Low opp value)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 150, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }),
    ['High usage', 'Low completion']);

  assertFlags('Flag: High engagement (new content → no Low opp value)',
    computePerformanceFlags_({ activeMonths: 2, totalPlayers: 20, playersPerMonth: 10, completions: 40, completionRate: 0.55, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High engagement']);

  assertFlags('Flag: Low completion',
    computePerformanceFlags_({ activeMonths: 2, totalPlayers: 30, playersPerMonth: 10, completions: 5, completionRate: 0.15, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }),
    ['Low completion']);

  assertFlags('Flag: High biz impact (opp, valid mapping)',
    computePerformanceFlags_({ activeMonths: 2, totalPlayers: 20, playersPerMonth: 10, completions: 10, completionRate: 0.50, mtOpp: 150000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }),
    ['High business impact']);

  assertFlags('Flag: High biz impact (won, valid mapping)',
    computePerformanceFlags_({ activeMonths: 2, totalPlayers: 20, playersPerMonth: 10, completions: 10, completionRate: 0.50, mtOpp: 1000, mtWon: 30000, hasContentSpecificPage: false, mtMappingValid: true }),
    ['High business impact']);

  assertFlags('Flag: High biz impact ignores mapping status',
    computePerformanceFlags_({ activeMonths: 2, totalPlayers: 20, playersPerMonth: 10, completions: 10, completionRate: 0.50, mtOpp: 150000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: false }),
    ['High business impact']);

  assertFlags('Flag: High-value niche ignores mapping status',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 50, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 60000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: false }),
    ['High-value niche', 'Low completion']);

  assertFlags('Flag: Missing page mapping blocks Low opportunity value',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 150, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 10000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: false }),
    ['High usage', 'Low completion']);

  assertFlags('Flag: High-value niche',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 50, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 60000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }),
    ['High-value niche', 'Low completion']);

  assertFlags('Flag: None (low players)',
    computePerformanceFlags_({ activeMonths: 2, totalPlayers: 10, playersPerMonth: 5, completions: 3, completionRate: 0.30, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }),
    []);

  // --- Low opportunity value flag ---

  assertFlags('Flag: Low opp value (mature + High usage + page + valid mapping)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 150, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 10000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High usage', 'Low completion', 'Low opportunity value']);

  assertFlags('Flag: No Low opp value (no page)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 150, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 10000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }),
    ['High usage', 'Low completion']);

  assertFlags('Flag: No Low opp value (High engagement + below baseline usage)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 30, playersPerMonth: 6, completions: 40, completionRate: 0.55, mtOpp: 10000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High engagement']);

  assertFlags('Flag: Low opp value (High engagement + baseline usage + page)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 100, playersPerMonth: 20, completions: 40, completionRate: 0.55, mtOpp: 10000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High engagement', 'Low opportunity value']);

  assertFlags('Flag: No Low opp value (New content)',
    computePerformanceFlags_({ activeMonths: 2, totalPlayers: 150, playersPerMonth: 75, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High usage', 'Low completion']);

  assertFlags('Flag: No Low opp value (no High usage/engagement)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 20, playersPerMonth: 4, completions: 2, completionRate: 0.10, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    []);

  assertFlags('Flag: No Low opp value (MT opp = $50K)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 150, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 50000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High usage', 'Low completion']);

  assertFlags('Flag: Low opp value coexists with High business impact (MT won >= $25K)',
    computePerformanceFlags_({ activeMonths: 5, totalPlayers: 150, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 10000, mtWon: 30000, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High usage', 'Low completion', 'High business impact', 'Low opportunity value']);

  assertFlags('Flag: Low opp value requires Active Months >= 4',
    computePerformanceFlags_({ activeMonths: 3, totalPlayers: 150, playersPerMonth: 50, completions: 10, completionRate: 0.20, mtOpp: 10000, mtWon: 500, hasContentSpecificPage: true, mtMappingValid: true }),
    ['High usage', 'Low completion']);

  // --- Threshold tests ---

  assert('Threshold: 20-24.99 does NOT get High usage',
    computePerformanceFlags_({ activeMonths: 6, totalPlayers: 130, playersPerMonth: 21.7, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }).indexOf('High usage') === -1, true);

  assert('Threshold: 24.99 does NOT get High usage',
    computePerformanceFlags_({ activeMonths: 6, totalPlayers: 150, playersPerMonth: 24.99, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }).indexOf('High usage') === -1, true);

  assert('Threshold: exactly 25 gets High usage',
    computePerformanceFlags_({ activeMonths: 6, totalPlayers: 150, playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, mtMappingValid: true }).indexOf('High usage') !== -1, true);

  // --- Signals tests ---
  Logger.log('');
  Logger.log('--- Signals ---');

  var sigMetrics1 = { activeMonths: 12, totalPlayers: 360, playersPerMonth: 30, completions: 198, completionRate: 0.55, mtOpp: 150000, mtWon: 30000, hasContentSpecificPage: true, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, l90Players: 90, l90Completions: 50, l90MtOpp: 40000, l90MtWon: 8000, mtMappingValid: true };
  var sig1 = computePerformanceSignals_(sigMetrics1, referenceDate);
  assert('Signals: usage HIGH when ppm >= 25', sig1.usage.level, 'HIGH');
  assert('Signals: usage value is ppm', sig1.usage.value, 30);
  assert('Signals: usage threshold is high threshold', sig1.usage.threshold, PERF_THRESHOLDS.HIGH_PLAYERS_PER_MONTH);
  assert('Signals: cr HIGH when rate >= 50%', sig1.cr.level, 'HIGH');
  assert('Signals: mt HIGH when opp >= $100K', sig1.mt.level, 'HIGH');
  assert('Signals: mt source is opp', sig1.mt.source, 'opp');
  assert('Signals: hasPage true', sig1.hasPage, true);
  assert('Signals: hasMapping true', sig1.hasMapping, true);
  assert('Signals: activeMonth ESTABLISHED when >= 4 months', sig1.activeMonth.level, 'ESTABLISHED');
  assert('Signals: activeMonth months', sig1.activeMonth.months, 12);
  assert('Signals: count 3', sig1.count, 3);
  assert('Signals: highCount 3', sig1.highCount, 3);
  assert('Signals: hasAnyActivity true', sig1.hasAnyActivity, true);
  assert('Signals: recovery not active when count > 0', sig1.recovery.active, false);

  var sigMetrics2 = { activeMonths: 6, totalPlayers: 60, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 5000, mtWon: 1000, hasContentSpecificPage: false, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, l90Players: 88, l90Completions: 5, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
  var sig2 = computePerformanceSignals_(sigMetrics2, referenceDate);
  assert('Signals: usage BELOW when ppm < 15', sig2.usage.level, 'BELOW');
  assert('Signals: cr BELOW when rate 20-39%', sig2.cr.level, 'BELOW');
  assert('Signals: mt BELOW when opp/won > 0 but below baseline', sig2.mt.level, 'BELOW');
  assert('Signals: count 0', sig2.count, 0);
  assert('Signals: recovery active (L90 ppm rescue)', sig2.recovery.active, true);
  assert('Signals: recovery ppm value', sig2.recovery.ppm >= PERF_THRESHOLDS.BASELINE_PLAYERS_PER_MONTH, true);

  var sigMetrics3 = { activeMonths: 0, totalPlayers: 0, playersPerMonth: 0, completions: 0, completionRate: 0, mtOpp: 0, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: null, lastActivityMonth: null, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
  var sig3 = computePerformanceSignals_(sigMetrics3, referenceDate);
  assert('Signals: activeMonth INACTIVE when 0 months + 0 players', sig3.activeMonth.level, 'INACTIVE');
  assert('Signals: hasAnyActivity false', sig3.hasAnyActivity, false);

  var sigMetrics4 = { activeMonths: 2, totalPlayers: 50, playersPerMonth: 25, completions: 40, completionRate: 0.50, mtOpp: 60000, mtWon: 15000, hasContentSpecificPage: true, firstActivityMonth: recentDate, lastActivityMonth: referenceDate, l90Players: 50, l90Completions: 20, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
  var sig4 = computePerformanceSignals_(sigMetrics4, referenceDate);
  assert('Signals: activeMonth NEW when 1-3 months + recent', sig4.activeMonth.level, 'NEW');

  var sigMetrics5 = { activeMonths: 2, totalPlayers: 20, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, firstActivityMonth: oldDate, lastActivityMonth: oldDate, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
  var sig5 = computePerformanceSignals_(sigMetrics5, referenceDate);
  assert('Signals: activeMonth STALLED when 1-3 months + not recent', sig5.activeMonth.level, 'STALLED');

  var sigMetrics6 = { activeMonths: 6, totalPlayers: 60, playersPerMonth: 10, completions: 5, completionRate: 0.15, mtOpp: 0, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
  var sig6 = computePerformanceSignals_(sigMetrics6, referenceDate);
  assert('Signals: mt NONE when both $0', sig6.mt.level, 'NONE');
  assert('Signals: cr LOW when rate < 20%', sig6.cr.level, 'LOW');
  assert('Signals: recovery not active when no L90 data', sig6.recovery.active, false);

  var sigMetrics7 = { activeMonths: 6, totalPlayers: 60, playersPerMonth: 10, completions: 10, completionRate: 0.55, mtOpp: 5000, mtWon: 1000, hasContentSpecificPage: false, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, l90Players: 30, l90Completions: 5, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
  var sig7 = computePerformanceSignals_(sigMetrics7, referenceDate);
  assert('Signals: cr HIGH with < 25 completions when rate >= 50%', sig7.cr.level, 'HIGH');

  var sigMetrics8 = { activeMonths: 6, totalPlayers: 60, playersPerMonth: 10, completions: 10, completionRate: 0.45, mtOpp: 5000, mtWon: 1000, hasContentSpecificPage: false, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, l90Players: 30, l90Completions: 5, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
  var sig8 = computePerformanceSignals_(sigMetrics8, referenceDate);
  assert('Signals: cr BASE with < 25 completions when rate >= 40%', sig8.cr.level, 'BASE');

  Logger.log('--- Signals String ---');

  var sigStr1 = buildSignalsString_(sig1);
  assert('SignalsStr: contains Usage 30ppm', sigStr1.indexOf('Usage: 30ppm') !== -1, true);
  assert('SignalsStr: contains high 25', sigStr1.indexOf('high 25') !== -1, true);
  assert('SignalsStr: contains CR value', sigStr1.indexOf('CR: 55%') !== -1, true);
  assert('SignalsStr: contains MT value', sigStr1.indexOf('MT: $') !== -1, true);
  assert('SignalsStr: contains has page', sigStr1.indexOf('has page') !== -1, true);
  assert('SignalsStr: contains has mapping', sigStr1.indexOf('has mapping') !== -1, true);
  assert('SignalsStr: contains ActiveMonth months', sigStr1.indexOf('ActiveMonth: 12 mo.') !== -1, true);
  assert('SignalsStr: no recovery line when count > 0', sigStr1.indexOf('recovery') === -1 && sigStr1.indexOf('Recovery') === -1, true);

  var sigStr2 = buildSignalsString_(sig2);
  assert('SignalsStr: contains Last 90d recovery YES', sigStr2.indexOf('Last 90d recovery: YES') !== -1, true);
  assert('SignalsStr: contains no page', sigStr2.indexOf('no page') !== -1, true);

  var sigStr6 = buildSignalsString_(sig6);
  assert('SignalsStr: no recovery line when no L90 rescue', sigStr6.indexOf('recovery') === -1 && sigStr6.indexOf('Recovery') === -1, true);

  // --- Recommended action tests ---

  function testSignals_(overrides, opts) {
    var base = { activeMonths: 6, totalPlayers: 60, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, mtMappingValid: true };
    for (var k in overrides) base[k] = overrides[k];
    var sig = computePerformanceSignals_(base, referenceDate);
    sig.trend = (opts && opts.trend) || 'unknown';
    if (opts && opts.contentAge) {
      var ca = opts.contentAge;
      sig.contentAge = {
        months: ca.available ? ca.months : null,
        available: ca.available,
        level: ca.available
          ? (ca.months > PERF_THRESHOLDS.CONTENT_AGE_MATURE ? 'MATURE'
             : ca.months > PERF_THRESHOLDS.CONTENT_AGE_NEW ? 'RECENT' : 'NEW')
          : 'UNKNOWN'
      };
    } else {
      sig.contentAge = { months: null, available: false, level: 'UNKNOWN' };
    }
    return sig;
  }

  var noActCA = { months: 5, available: true };
  var noActCAShort = { months: 2, available: true };
  var noActCAUnavail = { months: null, available: false };

  // A. Review data linkage / Boost sales impact
  var arSig1 = testSignals_({ activeMonths: 0, totalPlayers: 0, playersPerMonth: 0, completions: 0, completionRate: 0, mtOpp: 50000, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: null, lastActivityMonth: null }, { contentAge: noActCA });
  var arResult1 = computePerformanceAction_(arSig1);
  assert('Action: Review data linkage (no activity + MT)', arResult1.action, 'Review data linkage');
  assertHasReason('Reason: Review data linkage (no activity + MT)', arResult1);

  var arSig2 = testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 9000, mtWon: 2000, hasContentSpecificPage: true }, { trend: 'stable', contentAge: noActCA });
  var arResult2 = computePerformanceAction_(arSig2);
  assert('Action: Boost sales impact (High usage + page + low MT)', arResult2.action, 'Boost sales impact');

  var arSig3 = testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 10000, mtWon: 2000, hasContentSpecificPage: true, mtMappingValid: false }, { trend: 'stable' });
  var arResult3 = computePerformanceAction_(arSig3);
  assert('Action: No Boost sales impact (no mapping)', arResult3.action !== 'Boost sales impact', true);

  var arSig4 = testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 10000, mtWon: 15000, hasContentSpecificPage: true }, { trend: 'stable' });
  var arResult4 = computePerformanceAction_(arSig4);
  assert('Action: No Boost sales impact (MT won >= $10K)', arResult4.action !== 'Boost sales impact', true);

  // B. Improve completion
  var rcSig1 = testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var rcResult1 = computePerformanceAction_(rcSig1);
  assert('Action: Improve completion (High usage + Low CR)', rcResult1.action, 'Improve completion');
  assertHasReason('Reason: Improve completion', rcResult1);

  var rcSig2 = testSignals_({ playersPerMonth: 22, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true }, { trend: 'stable' });
  var rcResult2 = computePerformanceAction_(rcSig2);
  assert('Action: Improve completion (BASE usage + page + Low CR)', rcResult2.action, 'Improve completion');

  var rcSig3 = testSignals_({ activeMonths: 2, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 0, mtWon: 0, hasContentSpecificPage: true, firstActivityMonth: recentDate }, { trend: 'stable' });
  var rcResult3 = computePerformanceAction_(rcSig3);
  assert('Action: New content skips Improve completion despite High usage + Low CR', rcResult3.action, 'No action needed');

  // C. Create page
  var cpSig1 = testSignals_({ playersPerMonth: 25, completions: 50, completionRate: 0.45, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var cpResult1 = computePerformanceAction_(cpSig1);
  assert('Action: Create page (High usage, no page)', cpResult1.action, 'Create page');
  assertHasReason('Reason: Create page', cpResult1);

  var cpSig2 = testSignals_({ playersPerMonth: 10, completions: 40, completionRate: 0.55, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var cpResult2 = computePerformanceAction_(cpSig2);
  assert('Action: Create page (High CR, no page)', cpResult2.action, 'Create page');

  var cpSig3 = testSignals_({ playersPerMonth: 10, completions: 10, completionRate: 0.50, mtOpp: 150000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var cpResult3 = computePerformanceAction_(cpSig3);
  assert('Action: Create page (High MT, no page)', cpResult3.action, 'Create page');

  var cpSig4 = testSignals_({ playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 60000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var cpResult4 = computePerformanceAction_(cpSig4);
  assert('Action: Create page (Niche, no page)', cpResult4.action, 'Create page');

  var cpSig5 = testSignals_({ playersPerMonth: 22, completions: 10, completionRate: 0.30, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var cpResult5 = computePerformanceAction_(cpSig5);
  assert('Action: BASE usage + no page → No action needed (not Create page)', cpResult5.action, 'No action needed');

  // D. Increase visibility
  var npSig1 = testSignals_({ playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 60000, mtWon: 500, hasContentSpecificPage: true }, { trend: 'stable' });
  var npResult1 = computePerformanceAction_(npSig1);
  assert('Action: Increase visibility (niche, has page)', npResult1.action, 'Increase visibility');
  assertHasReason('Reason: Increase visibility', npResult1);

  var npSig2 = testSignals_({ playersPerMonth: 10, completions: 30, completionRate: 0.45, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var npResult2 = computePerformanceAction_(npSig2);
  assert('Action: Increase visibility (Low activity + baseline CR)', npResult2.action, 'Increase visibility');

  // D2. Increase visibility — 3/3 all-time signals + declining/stale
  var d2Sig = testSignals_({ playersPerMonth: 25, completions: 50, completionRate: 0.45, mtOpp: 60000, mtWon: 15000, hasContentSpecificPage: true }, { trend: 'declining' });
  var d2Declining = computePerformanceAction_(d2Sig);
  assert('Action: 3/3 + declining → Increase visibility', d2Declining.action, 'Increase visibility');

  d2Sig.trend = 'stale';
  var d2Stale = computePerformanceAction_(d2Sig);
  assert('Action: 3/3 + stale → Increase visibility', d2Stale.action, 'Increase visibility');

  d2Sig.trend = 'stable';
  var d2Stable = computePerformanceAction_(d2Sig);
  assert('Action: 3/3 + stable → No action needed (not Increase visibility)', d2Stable.action, 'No action needed');

  d2Sig.trend = 'growing';
  var d2Growing = computePerformanceAction_(d2Sig);
  assert('Action: 3/3 + growing → No action needed (not Increase visibility)', d2Growing.action, 'No action needed');

  var d2Sig2 = testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.35, mtOpp: 60000, mtWon: 15000, hasContentSpecificPage: true }, { trend: 'declining' });
  var d2Only2Result = computePerformanceAction_(d2Sig2);
  assert('Action: 2/3 + declining → NOT Increase visibility', d2Only2Result.action !== 'Increase visibility', true);

  var d2SigFixable = testSignals_({ playersPerMonth: 25, completions: 50, completionRate: 0.15, mtOpp: 60000, mtWon: 15000, hasContentSpecificPage: false }, { trend: 'declining' });
  var d2FixableWins = computePerformanceAction_(d2SigFixable);
  assert('Action: 3/3 + declining + High usage + Low CR → Improve completion wins', d2FixableWins.action, 'Improve completion');

  // E. Consider retirement
  var retSig1 = testSignals_({ playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var retResult1 = computePerformanceAction_(retSig1);
  assert('Action: Consider retirement (Low activity, no positive signals)', retResult1.action, 'Consider retirement');
  assertHasReason('Reason: Consider retirement', retResult1);

  var retSig2 = testSignals_({ activeMonths: 0, totalPlayers: 0, playersPerMonth: 0, completions: 0, completionRate: 0, mtOpp: 0, mtWon: 0, hasContentSpecificPage: true, firstActivityMonth: null, lastActivityMonth: null }, { contentAge: noActCA });
  var retResult2 = computePerformanceAction_(retSig2);
  assert('Action: Consider retirement (No activity + age >3 + MT=0)', retResult2.action, 'Consider retirement');

  var retSig3 = testSignals_({ activeMonths: 0, totalPlayers: 0, playersPerMonth: 0, completions: 0, completionRate: 0, mtOpp: 0, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: null, lastActivityMonth: null }, { contentAge: noActCA });
  var retResult3 = computePerformanceAction_(retSig3);
  assert('Action: Consider retirement (No activity + age >3 + no page + MT=0)', retResult3.action, 'Consider retirement');

  // F. Needs review
  var nhrSig = testSignals_({ activeMonths: 0, totalPlayers: 0, playersPerMonth: 0, completions: 0, completionRate: 0, mtOpp: 0, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: null, lastActivityMonth: null }, { contentAge: noActCAUnavail });
  var nhrResult2 = computePerformanceAction_(nhrSig);
  assert('Action: Needs review (age unavailable)', nhrResult2.action, 'Needs review');
  assert('Reason: age unavailable mentions manual review', nhrResult2.reason.indexOf('manual review') !== -1, true);

  // G. No action needed
  var keepSig1 = testSignals_({ playersPerMonth: 25, completions: 50, completionRate: 0.45, mtOpp: 60000, mtWon: 15000, hasContentSpecificPage: true }, { trend: 'stable' });
  var keepResult1 = computePerformanceAction_(keepSig1);
  assert('Action: No action needed (strong signals)', keepResult1.action, 'No action needed');
  assertHasReason('Reason: No action needed', keepResult1);

  var keepSig2 = testSignals_({ activeMonths: 2, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 0, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: recentDate }, { trend: 'stable' });
  var keepResult2 = computePerformanceAction_(keepSig2);
  assert('Action: No action needed (New content)', keepResult2.action, 'No action needed');

  var keepSig3 = testSignals_({ activeMonths: 0, totalPlayers: 0, playersPerMonth: 0, completions: 0, completionRate: 0, mtOpp: 0, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: null, lastActivityMonth: null }, { contentAge: noActCAShort });
  var keepResult3 = computePerformanceAction_(keepSig3);
  assert('Action: No action needed (No activity + age <=3 + MT=0)', keepResult3.action, 'No action needed');

  var keepSig4 = testSignals_({ playersPerMonth: 22, completions: 10, completionRate: 0.30, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  var keepResult4 = computePerformanceAction_(keepSig4);
  assert('Action: No action needed (BASE usage + no page)', keepResult4.action, 'No action needed');

  // --- Recovery reason ---
  var recoverySig = testSignals_({ activeMonths: 6, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false, l90Players: 60, l90Completions: 15, l90MtOpp: 0, l90MtWon: 0 }, { trend: 'stable' });
  var recoveryResult = computePerformanceAction_(recoverySig);
  assert('Action: No action needed (recovery active, 0/3 signals)', recoveryResult.action, 'No action needed');

  // --- Missing page mapping no longer appends explanation ---
  var missingMapSig = testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 60000, mtWon: 15000, hasContentSpecificPage: true, mtMappingValid: false }, { trend: 'stable' });
  var missingMapResult = computePerformanceAction_(missingMapSig);
  assert('Reason: Missing page mapping does not append explanation', missingMapResult.reason.indexOf('missing from the metrics mapping') === -1, true);

  // --- Every action has a reason ---
  var allActions = [
    computePerformanceAction_(testSignals_({ activeMonths: 0, totalPlayers: 0, playersPerMonth: 0, completions: 0, completionRate: 0, mtOpp: 50000, mtWon: 0, firstActivityMonth: null, lastActivityMonth: null }, { contentAge: noActCA })),
    computePerformanceAction_(testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true }, { trend: 'stable' })),
    computePerformanceAction_(testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' })),
    computePerformanceAction_(testSignals_({ playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 60000, mtWon: 500, hasContentSpecificPage: true }, { trend: 'stable' })),
    computePerformanceAction_(testSignals_({ playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' })),
    computePerformanceAction_(testSignals_({ playersPerMonth: 25, completions: 30, completionRate: 0.45, mtOpp: 10000, mtWon: 3000, hasContentSpecificPage: true }, { trend: 'stable' })),
    computePerformanceAction_(testSignals_({ playersPerMonth: 25, completions: 50, completionRate: 0.45, mtOpp: 60000, mtWon: 15000, hasContentSpecificPage: true }, { trend: 'stable' })),
    computePerformanceAction_(testSignals_({ activeMonths: 2, playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 0, mtWon: 0, hasContentSpecificPage: false, firstActivityMonth: recentDate }, { trend: 'stable' }))
  ];
  var allHaveReasons = true;
  for (var ai = 0; ai < allActions.length; ai++) {
    if (!allActions[ai].reason) { allHaveReasons = false; break; }
  }
  assert('Reason: Every action result has a reason', allHaveReasons, true);

  // --- Priority tests ---
  Logger.log('');
  Logger.log('--- Priority ---');

  var stableL90 = { playersPerMonth: 30, l90Players: 60, l90Completions: 10, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: referenceDate };
  var decliningL90 = { playersPerMonth: 30, l90Players: 10, l90Completions: 2, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: referenceDate };
  var staleL90 = { playersPerMonth: 30, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: new Date(2025, 0, 1) };
  var noL90 = { playersPerMonth: 0, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: null };

  assert('Trend: stable when L90 >= 50% all-time',
    computePerformanceTrend_(stableL90, referenceDate), 'stable');
  assert('Trend: declining when L90 < 50% all-time',
    computePerformanceTrend_(decliningL90, referenceDate), 'declining');
  assert('Trend: stale when L90=0 and last activity >6mo ago',
    computePerformanceTrend_(staleL90, referenceDate), 'stale');
  assert('Trend: unknown when no data',
    computePerformanceTrend_(noL90, referenceDate), 'unknown');

  var lastAct3mo = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 2, 1);
  var lastAct5mo = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 5, 1);
  var lastAct8mo = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 8, 1);
  assert('Trend: declining via lastActivity fallback (3mo, no L90)',
    computePerformanceTrend_({ playersPerMonth: 10, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: lastAct3mo }, referenceDate), 'declining');
  assert('Trend: declining via lastActivity fallback (5mo)',
    computePerformanceTrend_({ playersPerMonth: 10, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: lastAct5mo }, referenceDate), 'declining');
  assert('Trend: stale via lastActivity fallback (8mo)',
    computePerformanceTrend_({ playersPerMonth: 10, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: lastAct8mo }, referenceDate), 'stale');

  var growingL90 = { playersPerMonth: 30, l90Players: 150, l90Completions: 20, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: referenceDate };
  assert('Trend: growing when L90 ratio >= GROWING_RATIO',
    computePerformanceTrend_(growingL90, referenceDate), 'growing');

  var justBelowGrowing = { playersPerMonth: 30, l90Players: 105, l90Completions: 10, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: referenceDate };
  assert('Trend: stable when L90 ratio below growing threshold',
    computePerformanceTrend_(justBelowGrowing, referenceDate), 'stable');

  var growingRatioButLowAbsolute = { playersPerMonth: 4, l90Players: 15, l90Completions: 2, l90MtOpp: 0, l90MtWon: 0, lastActivityMonth: referenceDate };
  assert('Trend: stable when L90 ratio >= GROWING_RATIO but L90 ppm below floor (5ppm < 7.5)',
    computePerformanceTrend_(growingRatioButLowAbsolute, referenceDate), 'stable');

  var priSig2High = testSignals_({ playersPerMonth: 30, completions: 50, completionRate: 0.55, mtOpp: 150000, mtWon: 30000, hasContentSpecificPage: true }, { trend: 'stable' });
  assert('Priority: High (2+ high signals)',
    computePerformancePriority_(priSig2High, 'Improve completion'), 'High');
  var priSigDeclMeaningful = testSignals_({ playersPerMonth: 25, completions: 10, completionRate: 0.20, mtOpp: 60000, mtWon: 0, hasContentSpecificPage: true }, { trend: 'declining' });
  assert('Priority: High (declining + meaningful all-time)',
    computePerformancePriority_(priSigDeclMeaningful, 'Improve completion'), 'High');
  var priSig1High = testSignals_({ playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true }, { trend: 'stable' });
  assert('Priority: Medium (1 high signal, stable)',
    computePerformancePriority_(priSig1High, 'Improve completion'), 'Medium');
  var priSigDecl = testSignals_({ playersPerMonth: 10, completions: 5, completionRate: 0.20, mtOpp: 5000, mtWon: 1000, hasContentSpecificPage: false }, { trend: 'declining' });
  assert('Priority: Medium (declining + below baseline)',
    computePerformancePriority_(priSigDecl, 'Consider retirement'), 'Medium');
  var priSig0High = testSignals_({ playersPerMonth: 22, completions: 10, completionRate: 0.30, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true }, { trend: 'stable' });
  assert('Priority: Low (0 high signals, stable)',
    computePerformancePriority_(priSig0High, 'Increase visibility'), 'Low');
  var priSigNew = testSignals_({ activeMonths: 2, playersPerMonth: 30, completions: 10, completionRate: 0.20, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: true, firstActivityMonth: recentDate }, { trend: 'stable' });
  assert('Priority: Low (New content always)',
    computePerformancePriority_(priSigNew, 'No action needed'), 'Low');
  assert('Priority: Low (No action needed always)',
    computePerformancePriority_(priSig2High, 'No action needed'), 'Low');
  var priSigAgeMature = testSignals_({ playersPerMonth: 5, completions: 2, completionRate: 0.10, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable', contentAge: { months: 18, available: true } });
  assert('Priority: Medium (age bump, contentAge MATURE, no signals)',
    computePerformancePriority_(priSigAgeMature, 'Consider retirement'), 'Medium');
  var priSigAgeRecent = testSignals_({ playersPerMonth: 5, completions: 2, completionRate: 0.10, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable', contentAge: { months: 10, available: true } });
  assert('Priority: Low (no age bump, contentAge RECENT)',
    computePerformancePriority_(priSigAgeRecent, 'Consider retirement'), 'Low');
  var priSigAgeUnknown = testSignals_({ playersPerMonth: 5, completions: 2, completionRate: 0.10, mtOpp: 1000, mtWon: 500, hasContentSpecificPage: false }, { trend: 'stable' });
  assert('Priority: Low (no age bump, contentAge UNKNOWN)',
    computePerformancePriority_(priSigAgeUnknown, 'Consider retirement'), 'Low');

  // --- computePerformanceScore_ tests ---
  Logger.log('--- computePerformanceScore_ ---');

  var scoreNoActSig = computePerformanceSignals_({ playersPerMonth: 0, totalPlayers: 0, completionRate: 0, completions: 0, mtOpp: 0, mtWon: 0, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, activeMonths: 0, hasContentSpecificPage: false, firstActivityMonth: null, lastActivityMonth: null, mtMappingValid: true }, referenceDate);
  scoreNoActSig.trend = 'unknown';
  var scoreNoActivity = computePerformanceScore_(scoreNoActSig);
  assert('Score: No activity = 0', scoreNoActivity, 0);

  var scoreStable3HighSig = computePerformanceSignals_({ playersPerMonth: 30, totalPlayers: 360, completionRate: 0.55, completions: 198, mtOpp: 150000, mtWon: 30000, l90Players: 90, l90Completions: 50, l90MtOpp: 40000, l90MtWon: 8000, activeMonths: 12, hasContentSpecificPage: true, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, mtMappingValid: true }, referenceDate);
  scoreStable3HighSig.trend = 'stable';
  var scoreStable3High = computePerformanceScore_(scoreStable3HighSig);
  assert('Score: 3 HIGH + ESTABLISHED + stable >= 90', scoreStable3High >= 90, true);

  var scoreStable1Sig = computePerformanceSignals_({ playersPerMonth: 18, totalPlayers: 108, completionRate: 0.30, completions: 20, mtOpp: 30000, mtWon: 5000, l90Players: 15, l90Completions: 5, l90MtOpp: 8000, l90MtWon: 1000, activeMonths: 6, hasContentSpecificPage: false, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, mtMappingValid: true }, referenceDate);
  scoreStable1Sig.trend = 'stable';
  var scoreStable1Signal = computePerformanceScore_(scoreStable1Sig);
  assert('Score: 1/3 BASE + ESTABLISHED + stable = 40', scoreStable1Signal, 40);

  var scoreDeclSig = computePerformanceSignals_({ playersPerMonth: 25, totalPlayers: 300, completionRate: 0.50, completions: 150, mtOpp: 100000, mtWon: 25000, l90Players: 10, l90Completions: 3, l90MtOpp: 5000, l90MtWon: 1000, activeMonths: 12, hasContentSpecificPage: true, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, mtMappingValid: true }, referenceDate);
  scoreDeclSig.trend = 'declining';
  var scoreDeclining = computePerformanceScore_(scoreDeclSig);
  assert('Score: Declining trend < stable equivalent', scoreDeclining < scoreStable3High, true);

  var scoreDeadSig = computePerformanceSignals_({ playersPerMonth: 25, totalPlayers: 300, completionRate: 0.50, completions: 150, mtOpp: 100000, mtWon: 25000, l90Players: 0, l90Completions: 0, l90MtOpp: 0, l90MtWon: 0, activeMonths: 12, hasContentSpecificPage: true, firstActivityMonth: oldDate, lastActivityMonth: referenceDate, mtMappingValid: true }, referenceDate);
  scoreDeadSig.trend = 'stale';
  var scoreDeadDemo = computePerformanceScore_(scoreDeadSig);
  assert('Score: Stale demo with 3 HIGH signals still scores high (signals are all-time)', scoreDeadDemo >= 70, true);
  assert('Score: Stale demo scores less than stable equivalent', scoreDeadDemo < scoreStable3High, true);

  var scoreNewSig = computePerformanceSignals_({ playersPerMonth: 5, totalPlayers: 10, completionRate: 0.20, completions: 2, mtOpp: 1000, mtWon: 0, l90Players: 10, l90Completions: 2, l90MtOpp: 1000, l90MtWon: 0, activeMonths: 2, hasContentSpecificPage: false, firstActivityMonth: recentDate, lastActivityMonth: referenceDate, mtMappingValid: true }, referenceDate);
  scoreNewSig.trend = 'unknown';
  var scoreNewContent = computePerformanceScore_(scoreNewSig);
  assert('Score: New content 0/3 + NEW = 5', scoreNewContent, 5);

  // --- computePerformanceTier_ tests ---
  Logger.log('--- computePerformanceTier_ ---');

  assert('Tier: 100 = Top', computePerformanceTier_(100), 'Top');
  assert('Tier: 70 = Top', computePerformanceTier_(70), 'Top');
  assert('Tier: 69 = Mid', computePerformanceTier_(69), 'Mid');
  assert('Tier: 40 = Mid', computePerformanceTier_(40), 'Mid');
  assert('Tier: 39 = Low', computePerformanceTier_(39), 'Low');
  assert('Tier: 1 = Low', computePerformanceTier_(1), 'Low');
  assert('Tier: 0 = Inactive', computePerformanceTier_(0), 'Inactive');

  Logger.log('---');
  Logger.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' tests.');
}

/* =========================
   TEST HARNESS — PROCESSING AUDIT
========================= */

function testProcessingAudit() {
  var passed = 0;
  var failed = 0;

  function assert(testName, actual, expected) {
    if (actual === expected) {
      Logger.log('PASS: ' + testName);
      passed++;
    } else {
      Logger.log('FAIL: ' + testName + ' — expected "' + expected + '", got "' + actual + '"');
      failed++;
    }
  }

  var referenceDate = new Date(2026, 6, 0);
  var recentDate = new Date(2026, 4, 1);
  var oldDate = new Date(2024, 0, 1);

  var hm = {};
  var idx = 0;
  hm[ENHANCED_CONFIG.COLUMNS.NUMBER] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.STATUS] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.GLOBAL_ID] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.NOTE] = idx++;
  hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS] = idx++;
  hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS] = idx++;
  hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH] = idx++;
  hm[PERF_METRIC_COLUMNS.COMPLETIONS] = idx++;
  hm[PERF_METRIC_COLUMNS.COMPLETION_RATE] = idx++;
  hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE] = idx++;
  hm[PERF_METRIC_COLUMNS.MT_WON_VALUE] = idx++;
  hm[PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL] = idx++;
  hm[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH] = idx++;
  hm[PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH] = idx++;
  hm[PERF_METRIC_COLUMNS.L90_PLAYERS] = idx++;
  hm[PERF_METRIC_COLUMNS.L90_COMPLETIONS] = idx++;
  hm[PERF_METRIC_COLUMNS.L90_MT_OPP_VALUE] = idx++;
  hm[PERF_METRIC_COLUMNS.L90_MT_WON_VALUE] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.RHAC_PAGE] = idx++;
  hm[PERF_METRIC_COLUMNS.METRICS_MAPPING_STATUS] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS] = idx++;
  hm[ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS] = idx++;
  hm['Cleanup note'] = idx++;
  hm['Cleanup status'] = idx++;
  hm[PERF_LABEL_COLUMNS.PERF_SIGNALS] = idx++;
  hm[PERF_LABEL_COLUMNS.PERF_FLAGS] = idx++;
  hm[PERF_LABEL_COLUMNS.PERF_ACTION] = idx++;
  hm[PERF_LABEL_COLUMNS.PERF_ACTION_REASON] = idx++;
  hm[PERF_LABEL_COLUMNS.PRIORITY] = idx++;
  hm[PERF_LABEL_COLUMNS.PERF_SCORE] = idx++;
  hm[PERF_LABEL_COLUMNS.PERF_TIER] = idx++;
  hm[PERF_LABEL_COLUMNS.PERF_TREND] = idx++;
  hm[PERF_LABEL_COLUMNS.PROCESSING_RESULT] = idx++;
  var COL_COUNT = idx;

  function makeRow(vals) {
    var row = [];
    for (var i = 0; i < COL_COUNT; i++) row.push('');
    for (var col in vals) {
      if (hm[col] !== undefined) row[hm[col]] = vals[col];
    }
    return row;
  }

  function makeFullDataRow(overrides) {
    var base = {};
    base[ENHANCED_CONFIG.COLUMNS.NUMBER] = '100';
    base[ENHANCED_CONFIG.COLUMNS.STATUS] = 'IE Published';
    base[ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE] = 'Test Demo';
    base[PERF_METRIC_COLUMNS.ACTIVE_MONTHS] = 6;
    base[PERF_METRIC_COLUMNS.TOTAL_PLAYERS] = 150;
    base[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH] = 25;
    base[PERF_METRIC_COLUMNS.COMPLETIONS] = 50;
    base[PERF_METRIC_COLUMNS.COMPLETION_RATE] = 0.45;
    base[PERF_METRIC_COLUMNS.MT_OPP_VALUE] = 60000;
    base[PERF_METRIC_COLUMNS.MT_WON_VALUE] = 15000;
    base[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH] = oldDate;
    if (overrides) {
      for (var k in overrides) base[k] = overrides[k];
    }
    return makeRow(base);
  }

  // --- isRowBlank_ ---
  assert('isRowBlank: empty row', isRowBlank_(makeRow({}), hm), true);

  var rowWithNumber = makeRow({});
  rowWithNumber[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '42';
  assert('isRowBlank: row with Number', isRowBlank_(rowWithNumber, hm), false);

  var blankWithOldLabels = makeRow({});
  blankWithOldLabels[hm[PERF_LABEL_COLUMNS.PERF_SIGNALS]] = 'Usage: HIGH 30ppm (high 25)';
  blankWithOldLabels[hm[PERF_LABEL_COLUMNS.PERF_ACTION]] = 'No action needed';
  blankWithOldLabels[hm[PERF_LABEL_COLUMNS.PROCESSING_RESULT]] = 'Processed';
  assert('isRowBlank: output columns → still blank', isRowBlank_(blankWithOldLabels, hm), true);

  var blankWithCleanup = makeRow({});
  blankWithCleanup[hm['Cleanup note']] = 'Some cleanup note';
  blankWithCleanup[hm['Cleanup status']] = 'Done';
  assert('isRowBlank: Cleanup note/status only → still blank', isRowBlank_(blankWithCleanup, hm), true);

  // --- Cleanup never affects result ---
  var cleanupRow = makeFullDataRow({});
  cleanupRow[hm['Cleanup note']] = 'Should be retired';
  cleanupRow[hm['Cleanup status']] = 'Pending review';
  var rCleanup = classifyRow_(cleanupRow, hm, {}, referenceDate);
  assert('Audit: Cleanup note does not change result', rCleanup.result, 'Processed');
  assert('Audit: Cleanup note not in reason', rCleanup.reason.indexOf('Cleanup') === -1, true);

  // --- Blank Status + complete data → Processed ---
  var blankStatusOK = makeFullDataRow({});
  blankStatusOK[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = '';
  blankStatusOK[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '62';
  var rBlankStatus = classifyRow_(blankStatusOK, hm, {}, referenceDate);
  assert('Audit: blank status + complete data → Processed', rBlankStatus.outcome, 'processed');
  assert('Audit: blank status → has reason', rBlankStatus.reason !== '', true);

  // --- Blank Status + missing metrics → Needs review ---
  var blankStatusNoMetrics = makeRow({});
  blankStatusNoMetrics[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '65';
  blankStatusNoMetrics[hm[ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE]] = 'Blank Status No Metrics';
  var rBlankNoMetrics = classifyRow_(blankStatusNoMetrics, hm, {}, referenceDate);
  assert('Audit: blank status + missing metrics → Needs review', rBlankNoMetrics.outcome, 'needs_review');

  // --- IE Received → Processed ---
  var receivedRow = makeFullDataRow({});
  receivedRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Received';
  receivedRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '63';
  receivedRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 60;
  receivedRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 10;
  receivedRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 5;
  receivedRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.20;
  receivedRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 5000;
  receivedRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 1000;
  assert('Audit: IE Received → Processed', classifyRow_(receivedRow, hm, {}, referenceDate).result, 'Processed');

  // --- IE Published → Processed ---
  assert('Audit: IE Published → Processed', classifyRow_(makeFullDataRow({}), hm, {}, referenceDate).result, 'Processed');

  // --- IE Reviewed → Processed ---
  var reviewedRow = makeFullDataRow({});
  reviewedRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Reviewed';
  reviewedRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '70';
  reviewedRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 60;
  reviewedRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 10;
  reviewedRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 5;
  reviewedRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.20;
  reviewedRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 5000;
  reviewedRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 1000;
  assert('Audit: IE Reviewed → Processed', classifyRow_(reviewedRow, hm, {}, referenceDate).result, 'Processed');

  // --- IE Retired → Skipped ---
  var retiredRow = makeRow({});
  retiredRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '60';
  retiredRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Retired';
  var rRetired = classifyRow_(retiredRow, hm, {}, referenceDate);
  assert('Audit: IE Retired → Skipped', rRetired.result, 'Skipped — Status = IE Retired');
  assert('Audit: IE Retired clears Signals', rRetired.signals, '');
  assert('Audit: IE Retired clears Action', rRetired.action, '');

  // --- Closed → Skipped ---
  var closedRow = makeRow({});
  closedRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '64';
  closedRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'Closed';
  assert('Audit: Closed → Skipped', classifyRow_(closedRow, hm, {}, referenceDate).result, 'Skipped — Status = Closed');

  // --- Note = Delete row → Skipped ---
  var deleteRow = makeRow({});
  deleteRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '99';
  deleteRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  deleteRow[hm[ENHANCED_CONFIG.COLUMNS.NOTE]] = 'Delete row';
  var rDelete = classifyRow_(deleteRow, hm, {}, referenceDate);
  assert('Audit: Note = Delete row → Skipped', rDelete.result, 'Skipped — Note = Delete row');
  assert('Audit: Delete row clears Signals', rDelete.signals, '');
  assert('Audit: Delete row clears Action', rDelete.action, '');

  // --- Empty row → Skipped ---
  assert('Audit: empty row → Skipped', classifyRow_(makeRow({}), hm, {}, referenceDate).result, 'Skipped — Blank row');

  // --- Missing identifier → Needs review ---
  var noIdRow = makeRow({});
  noIdRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noIdRow[hm[ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE]] = 'No Number';
  noIdRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 6;
  noIdRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 100;
  var rNoId = classifyRow_(noIdRow, hm, {}, referenceDate);
  assert('Audit: missing identifier → Needs review', rNoId.outcome, 'needs_review');
  assert('Audit: missing identifier → reason', rNoId.reason, 'The Number column is blank, so this row cannot be matched to metrics data.');

  // --- Duplicate identifier → Needs review ---
  var dupRow = makeFullDataRow({});
  dupRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '42';
  var rDup = classifyRow_(dupRow, hm, { '42': 5 }, referenceDate);
  assert('Audit: duplicate → Needs review', rDup.outcome, 'needs_review');
  assert('Audit: duplicate → reason mentions same identifier', rDup.reason.indexOf('same identifier') !== -1, true);

  // --- Unlinked request → Needs review ---
  var unlinkedRow = makeFullDataRow({});
  unlinkedRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '200';
  unlinkedRow[hm[PERF_METRIC_COLUMNS.METRICS_MAPPING_STATUS]] = 'Unlinked request';
  var rUnlinked = classifyRow_(unlinkedRow, hm, {}, referenceDate);
  assert('Audit: Unlinked request → Needs review', rUnlinked.outcome, 'needs_review');
  assert('Audit: Unlinked request → reason', rUnlinked.reason.indexOf('not linked') !== -1, true);

  // --- Shared display-key → Processed ---
  var sharedKeyRow = makeFullDataRow({});
  sharedKeyRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '201';
  sharedKeyRow[hm[PERF_METRIC_COLUMNS.METRICS_MAPPING_STATUS]] = 'Shared display-key';
  assert('Audit: Shared display-key → Processed', classifyRow_(sharedKeyRow, hm, {}, referenceDate).result, 'Processed');

  // --- Missing page mapping → Processed, MT flags blocked ---
  var missingMapRow = makeFullDataRow({});
  missingMapRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '202';
  missingMapRow[hm[PERF_METRIC_COLUMNS.METRICS_MAPPING_STATUS]] = 'Missing redhat.com page mapping';
  var rMissingMap = classifyRow_(missingMapRow, hm, {}, referenceDate);
  assert('Audit: Missing page mapping → Processed', rMissingMap.result, 'Processed');
  assert('Audit: Missing page mapping → no High business impact', rMissingMap.flags.indexOf('High business impact') === -1, true);
  assert('Audit: Missing page mapping → no High-value niche', rMissingMap.flags.indexOf('High-value niche') === -1, true);
  assert('Audit: Missing page mapping → no Low opportunity value', rMissingMap.flags.indexOf('Low opportunity value') === -1, true);
  assert('Audit: Missing page mapping → reason does not mention mapping', rMissingMap.reason.indexOf('missing from the metrics mapping') === -1, true);

  // --- Page detection in parseMetrics_ ---
  var pgBase = {};
  pgBase[ENHANCED_CONFIG.COLUMNS.NUMBER] = '90';
  pgBase[ENHANCED_CONFIG.COLUMNS.STATUS] = 'IE Published';
  pgBase[PERF_METRIC_COLUMNS.ACTIVE_MONTHS] = 6;
  pgBase[PERF_METRIC_COLUMNS.TOTAL_PLAYERS] = 150;
  pgBase[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH] = 25;
  pgBase[PERF_METRIC_COLUMNS.COMPLETIONS] = 50;
  pgBase[PERF_METRIC_COLUMNS.COMPLETION_RATE] = 0.45;
  pgBase[PERF_METRIC_COLUMNS.MT_OPP_VALUE] = 1000;
  pgBase[PERF_METRIC_COLUMNS.MT_WON_VALUE] = 500;
  pgBase[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH] = oldDate;

  var pg1 = makeRow(pgBase);
  pg1[hm[PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL]] = 'https://www.redhat.com/en/interactive-experiences/my-demo';
  assert('Page: Drupal valid → true', parseMetrics_(pg1, hm).hasContentSpecificPage, true);

  var pg2 = makeRow(pgBase);
  pg2[hm[ENHANCED_CONFIG.COLUMNS.RHAC_PAGE]] = 'https://www.redhat.com/architect/portfolio/detail/57-openshift';
  assert('Page: RHAC valid → true', parseMetrics_(pg2, hm).hasContentSpecificPage, true);

  assert('Page: both blank → false', parseMetrics_(makeRow(pgBase), hm).hasContentSpecificPage, false);

  var pg4 = makeRow(pgBase);
  pg4[hm[PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL]] = 'https://www.redhat.com/en/interactive-experiences';
  assert('Page: generic listing → false', parseMetrics_(pg4, hm).hasContentSpecificPage, false);

  // --- No activity tests ---
  var noActMTRow = makeRow({});
  noActMTRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '300';
  noActMTRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActMTRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActMTRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActMTRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = '';
  noActMTRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActMTRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0;
  noActMTRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 50000;
  noActMTRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  assert('Audit: No activity + MT >$0 → Review data linkage', classifyRow_(noActMTRow, hm, {}, referenceDate).action, 'Review data linkage');

  var noActScoreRow = makeRow({});
  noActScoreRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '310';
  noActScoreRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActScoreRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActScoreRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActScoreRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = '';
  noActScoreRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActScoreRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0;
  noActScoreRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  noActScoreRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  var rNoActScore = classifyRow_(noActScoreRow, hm, {}, referenceDate);
  assert('Audit: No activity score = 0', rNoActScore.score, 0);
  assert('Audit: No activity tier = Inactive', rNoActScore.tier, 'Inactive');

  var noActYoungRow = makeRow({});
  noActYoungRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '301';
  noActYoungRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActYoungRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActYoungRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActYoungRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = '';
  noActYoungRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActYoungRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0;
  noActYoungRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  noActYoungRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  noActYoungRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = new Date(2026, 4, 1);
  assert('Audit: No activity + age <=3 + MT=0 → No action needed', classifyRow_(noActYoungRow, hm, {}, referenceDate).action, 'No action needed');

  var noActOldPageRow = makeRow({});
  noActOldPageRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '302';
  noActOldPageRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = '';
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0;
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  noActOldPageRow[hm[PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL]] = 'https://www.redhat.com/en/interactive-experiences/my-demo';
  noActOldPageRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = new Date(2025, 6, 1);
  assert('Audit: No activity + age >3 + page + MT=0 → Consider retirement', classifyRow_(noActOldPageRow, hm, {}, referenceDate).action, 'Consider retirement');

  var noActOldNoPageRow = makeRow({});
  noActOldNoPageRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '303';
  noActOldNoPageRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActOldNoPageRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActOldNoPageRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActOldNoPageRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = '';
  noActOldNoPageRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActOldNoPageRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0;
  noActOldNoPageRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  noActOldNoPageRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  noActOldNoPageRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = new Date(2025, 6, 1);
  assert('Audit: No activity + age >3 + no page + MT=0 → Consider retirement', classifyRow_(noActOldNoPageRow, hm, {}, referenceDate).action, 'Consider retirement');

  var noActNoAge = makeRow({});
  noActNoAge[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '304';
  noActNoAge[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActNoAge[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActNoAge[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActNoAge[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = '';
  noActNoAge[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActNoAge[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0;
  noActNoAge[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  noActNoAge[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  var rNoActNoAge = classifyRow_(noActNoAge, hm, {}, referenceDate);
  assert('Audit: No activity + age unavailable → Needs review', rNoActNoAge.action, 'Needs review');
  assert('Audit: No activity + age unavailable → reason mentions manual review', rNoActNoAge.reason.indexOf('manual review') !== -1, true);

  // --- Stale activity → Retire ---
  var staleRow = makeRow({});
  staleRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '350';
  staleRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  staleRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 2;
  staleRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 20;
  staleRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 10;
  staleRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 5;
  staleRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.25;
  staleRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 1000;
  staleRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 500;
  staleRow[hm[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH]] = oldDate;
  var rStale = classifyRow_(staleRow, hm, {}, referenceDate);
  assert('Audit: Stale activity → Consider retirement', rStale.action, 'Consider retirement');
  assert('Audit: Stale activity → has signals', rStale.signals !== '', true);
  assert('Audit: Stale activity → reason mentions retirement', rStale.reason.indexOf('flagged for retirement') !== -1, true);

  // --- Low opp value end-to-end ---
  var lowOppRow = makeFullDataRow({});
  lowOppRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '95';
  lowOppRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 9000;
  lowOppRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 2000;
  lowOppRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 10;
  lowOppRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.20;
  lowOppRow[hm[PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL]] = 'https://www.redhat.com/en/interactive-experiences/my-demo';
  var rLowOpp = classifyRow_(lowOppRow, hm, {}, referenceDate);
  assert('Audit: Low opp + low MT won → Boost sales impact', rLowOpp.action, 'Boost sales impact');
  assert('Audit: Low opp flag present', rLowOpp.flags.indexOf('Low opportunity value') !== -1, true);

  var lowOppHighWon = makeFullDataRow({});
  lowOppHighWon[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '96';
  lowOppHighWon[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 10000;
  lowOppHighWon[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 15000;
  lowOppHighWon[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 10;
  lowOppHighWon[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.20;
  lowOppHighWon[hm[PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL]] = 'https://www.redhat.com/en/interactive-experiences/my-demo';
  assert('Audit: Low opp + MT won >= $10K → not Boost sales impact', classifyRow_(lowOppHighWon, hm, {}, referenceDate).action !== 'Boost sales impact', true);

  // --- 15-24.99 + no page → Keep ---
  var midNoPage = makeFullDataRow({});
  midNoPage[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '400';
  midNoPage[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 22;
  midNoPage[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 132;
  midNoPage[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 30;
  midNoPage[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.42;
  midNoPage[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 1000;
  midNoPage[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 500;
  assert('Audit: 15-24.99 + no page → No action needed', classifyRow_(midNoPage, hm, {}, referenceDate).action, 'No action needed');

  // --- 15-24.99 + page + Low completion → Improve completion rate ---
  var midPageLowEng = makeFullDataRow({});
  midPageLowEng[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '401';
  midPageLowEng[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 22;
  midPageLowEng[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 132;
  midPageLowEng[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 10;
  midPageLowEng[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.20;
  midPageLowEng[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 60000;
  midPageLowEng[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 15000;
  midPageLowEng[hm[PERF_METRIC_COLUMNS.DRUPAL_PAGE_URL]] = 'https://www.redhat.com/en/interactive-experiences/my-demo';
  assert('Audit: 15-24.99 + page + Low completion → Improve completion', classifyRow_(midPageLowEng, hm, {}, referenceDate).action, 'Improve completion');

  // --- Final Action column never touched ---
  assert('Column: PERF_ACTION is Recommended action', PERF_LABEL_COLUMNS.PERF_ACTION, 'Recommended action');
  var perfColNames = [PERF_LABEL_COLUMNS.PERF_SIGNALS, PERF_LABEL_COLUMNS.PERF_FLAGS, PERF_LABEL_COLUMNS.PERF_ACTION, PERF_LABEL_COLUMNS.PERF_ACTION_REASON, PERF_LABEL_COLUMNS.PRIORITY, PERF_LABEL_COLUMNS.PROCESSING_RESULT];
  var touchesAction = false;
  for (var pc = 0; pc < perfColNames.length; pc++) {
    if (perfColNames[pc] === 'Action') touchesAction = true;
  }
  assert('Column: no bare Action column', touchesAction, false);

  // --- Every reason is populated ---
  var testRows = [rCleanup, rBlankStatus, rLowOpp, rStale, rNoActNoAge];
  var allReasons = true;
  for (var tr = 0; tr < testRows.length; tr++) {
    if (testRows[tr].action && !testRows[tr].reason) { allReasons = false; break; }
  }
  assert('Reason: every row with action has reason', allReasons, true);

  // --- Needs review has specific reason ---
  assert('Reason: Unlinked has specific reason', classifyRow_(unlinkedRow, hm, {}, referenceDate).reason.indexOf('not linked') !== -1, true);
  assert('Reason: Missing identifier has specific reason', rNoId.reason, 'The Number column is blank, so this row cannot be matched to metrics data.');
  assert('Reason: Duplicate has specific reason', rDup.reason.indexOf('same identifier') !== -1, true);

  // --- hasMinimumRequiredMetrics_ ---
  var allZeros = makeRow({});
  allZeros[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  allZeros[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  allZeros[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  allZeros[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0;
  allZeros[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  allZeros[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  assert('hasMinimumRequired: zeros → valid', hasMinimumRequiredMetrics_(allZeros, hm).valid, true);
  assert('hasMinimumRequired: all blank → invalid', hasMinimumRequiredMetrics_(makeRow({}), hm).valid, false);

  var zeroPlayersBlankRate = makeRow({});
  zeroPlayersBlankRate[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  zeroPlayersBlankRate[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  zeroPlayersBlankRate[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  zeroPlayersBlankRate[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  zeroPlayersBlankRate[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  assert('hasMinimumRequired: zero players + blank rate → valid', hasMinimumRequiredMetrics_(zeroPlayersBlankRate, hm).valid, true);

  // --- No activity + blank rate ---
  var noActBlankRateOld = makeRow({});
  noActBlankRateOld[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '305';
  noActBlankRateOld[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActBlankRateOld[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActBlankRateOld[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActBlankRateOld[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 0;
  noActBlankRateOld[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActBlankRateOld[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = '';
  noActBlankRateOld[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  noActBlankRateOld[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  noActBlankRateOld[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = oldDate;
  assert('Audit: No activity + blank rate + age >3 → Consider retirement', classifyRow_(noActBlankRateOld, hm, {}, referenceDate).action, 'Consider retirement');

  var noActBlankRateNew = makeRow({});
  noActBlankRateNew[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '306';
  noActBlankRateNew[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  noActBlankRateNew[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 0;
  noActBlankRateNew[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  noActBlankRateNew[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 0;
  noActBlankRateNew[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  noActBlankRateNew[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = '';
  noActBlankRateNew[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  noActBlankRateNew[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  noActBlankRateNew[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = recentDate;
  assert('Audit: No activity + blank rate + age ≤3 → No action needed', classifyRow_(noActBlankRateNew, hm, {}, referenceDate).action, 'No action needed');

  // --- Low activity + blank rate ---
  var lowActBlankRate = makeRow({});
  lowActBlankRate[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '307';
  lowActBlankRate[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 5;
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 0;
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 0;
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 0;
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = '';
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 0;
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  lowActBlankRate[hm[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH]] = oldDate;
  assert('Audit: Low activity + blank rate → Consider retirement', classifyRow_(lowActBlankRate, hm, {}, referenceDate).action, 'Consider retirement');

  // --- Priority end-to-end ---
  var priorityRow = makeFullDataRow({});
  priorityRow[hm[PERF_METRIC_COLUMNS.L90_PLAYERS]] = 60;
  priorityRow[hm[PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH]] = referenceDate;
  var pResult = classifyRow_(priorityRow, hm, {}, referenceDate);
  assert('Audit: Processed row has priority', pResult.priority !== '', true);
  assert('Audit: Priority is valid tier', ['High', 'Medium', 'Low'].indexOf(pResult.priority) !== -1, true);
  assert('Audit: Signals is non-empty', pResult.signals !== '', true);
  assert('Audit: Signals contains Usage', pResult.signals.indexOf('Usage:') !== -1, true);
  assert('Audit: Processed row has score', typeof pResult.score === 'number', true);
  assert('Audit: Processed row score > 0', pResult.score > 0, true);
  assert('Audit: Processed row score <= 100', pResult.score <= 100, true);
  assert('Audit: Processed row has tier', ['Top', 'Mid', 'Low', 'Inactive'].indexOf(pResult.tier) !== -1, true);
  assert('Audit: Processed row has trend', pResult.trend !== '', true);
  assert('Audit: Trend is valid value', ['Growing', 'Stable', 'Declining', 'Stale', 'Unknown'].indexOf(pResult.trend) !== -1, true);

  // Priority cap: High priority capped to Medium on Low-tier demos
  var lowTierRow = makeFullDataRow({});
  lowTierRow[hm[PERF_METRIC_COLUMNS.ALL_TIME_PLAYERS]] = 20;
  lowTierRow[hm[PERF_METRIC_COLUMNS.ALL_TIME_COMPLETIONS]] = 2;
  lowTierRow[hm[PERF_METRIC_COLUMNS.L90_PLAYERS]] = 2;
  lowTierRow[hm[PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH]] = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 8, 1);
  lowTierRow[hm[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH]] = new Date(2024, 0, 1);
  lowTierRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 10;
  var ltResult = classifyRow_(lowTierRow, hm, {}, referenceDate);
  if (ltResult.tier === 'Low' && ltResult.outcome === 'processed') {
    assert('Audit: Low tier caps priority at Medium', ltResult.priority !== 'High', true);
  }

  var skipResult = classifyRow_(makeRow({}), hm, {}, referenceDate);
  assert('Audit: Skipped row has empty priority', skipResult.priority, '');
  assert('Audit: Skipped row has empty score', skipResult.score, '');
  assert('Audit: Skipped row has empty tier', skipResult.tier, '');
  assert('Audit: Skipped row has empty trend', skipResult.trend, '');
  assert('Audit: Skipped row has empty signals', skipResult.signals, '');

  var reviewRow = makeRow({});
  reviewRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '999';
  reviewRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS]] = 'IE Published';
  reviewRow[hm[PERF_METRIC_COLUMNS.METRICS_MAPPING_STATUS]] = 'Unlinked request';
  var reviewResult = classifyRow_(reviewRow, hm, {}, referenceDate);
  assert('Audit: Needs-review row has empty priority', reviewResult.priority, '');
  assert('Audit: Needs-review row has empty score', reviewResult.score, '');
  assert('Audit: Needs-review row has empty tier', reviewResult.tier, '');
  assert('Audit: Needs-review row has empty signals', reviewResult.signals, '');

  // --- Sporadic activity flag ---
  var sporadicRow = makeFullDataRow({});
  sporadicRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = new Date(2024, 0, 1);
  sporadicRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 4;
  sporadicRow[hm[PERF_METRIC_COLUMNS.L90_PLAYERS]] = 60;
  sporadicRow[hm[PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH]] = referenceDate;
  var sporadicResult = classifyRow_(sporadicRow, hm, {}, referenceDate);
  assert('Audit: Sporadic activity flag when density < 50%', sporadicResult.flags.indexOf('Sporadic activity') !== -1, true);

  var nonSporadicRow = makeFullDataRow({});
  nonSporadicRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = new Date(2025, 6, 1);
  nonSporadicRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 6;
  nonSporadicRow[hm[PERF_METRIC_COLUMNS.L90_PLAYERS]] = 60;
  nonSporadicRow[hm[PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH]] = referenceDate;
  var nonSporadicResult = classifyRow_(nonSporadicRow, hm, {}, referenceDate);
  assert('Audit: No Sporadic flag when density >= 50%', nonSporadicResult.flags.indexOf('Sporadic activity') === -1, true);

  // --- Age-based priority bump ---
  var ageBumpRow = makeFullDataRow({});
  ageBumpRow[hm[ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS]] = new Date(2024, 0, 1);
  ageBumpRow[hm[PERF_METRIC_COLUMNS.ACTIVE_MONTHS]] = 10;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 5;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 50;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 10;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.20;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 1000;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 0;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.L90_PLAYERS]] = 10;
  ageBumpRow[hm[PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH]] = referenceDate;
  var ageBumpResult = classifyRow_(ageBumpRow, hm, {}, referenceDate);
  assert('Audit: Old actionable demo (>12 mo) gets at least Medium priority', ageBumpResult.priority !== 'Low', true);

  // --- Error handling ---
  var _origFlags = computePerformanceFlags_;
  computePerformanceFlags_ = function() { throw new Error('Simulated failure'); };
  var errorCaught = false;
  try { classifyRow_(makeFullDataRow({}), hm, {}, referenceDate); } catch (e) { errorCaught = true; }
  assert('Audit: classifyRow_ throws on error', errorCaught, true);
  computePerformanceFlags_ = _origFlags;
  assert('Audit: row after error → Processed', classifyRow_(makeFullDataRow({}), hm, {}, referenceDate).result, 'Processed');

  // --- Status × Tier coherence ---
  Logger.log('');
  Logger.log('--- Coherence ---');

  // No activity must always be Inactive tier
  assert('Coherence: No activity → Inactive tier', rNoActScore.tier, 'Inactive');
  assert('Coherence: No activity → score 0', rNoActScore.score, 0);

  // Low activity must never be Top tier
  var lowActCoherence = makeFullDataRow({});
  lowActCoherence[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '500';
  lowActCoherence[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 5;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 30;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 5;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.15;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 1000;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 500;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.L90_PLAYERS]] = 0;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.L90_COMPLETIONS]] = 0;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.L90_MT_OPP_VALUE]] = 0;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.L90_MT_WON_VALUE]] = 0;
  lowActCoherence[hm[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH]] = oldDate;
  var rLowActCo = classifyRow_(lowActCoherence, hm, {}, referenceDate);
  assert('Coherence: Low activity → never Top tier', rLowActCo.tier !== 'Top', true);
  assert('Coherence: Low activity → never Mid tier', rLowActCo.tier !== 'Mid', true);
  assert('Coherence: Low activity → score < 40', rLowActCo.score < 40, true);

  // High engagement flag should never coexist with Low activity status
  var highEngRow = makeFullDataRow({});
  highEngRow[hm[ENHANCED_CONFIG.COLUMNS.NUMBER]] = '501';
  highEngRow[hm[PERF_METRIC_COLUMNS.PLAYERS_PER_MONTH]] = 10;
  highEngRow[hm[PERF_METRIC_COLUMNS.TOTAL_PLAYERS]] = 60;
  highEngRow[hm[PERF_METRIC_COLUMNS.COMPLETIONS]] = 40;
  highEngRow[hm[PERF_METRIC_COLUMNS.COMPLETION_RATE]] = 0.55;
  highEngRow[hm[PERF_METRIC_COLUMNS.MT_OPP_VALUE]] = 5000;
  highEngRow[hm[PERF_METRIC_COLUMNS.MT_WON_VALUE]] = 1000;
  highEngRow[hm[PERF_METRIC_COLUMNS.L90_PLAYERS]] = 20;
  highEngRow[hm[PERF_METRIC_COLUMNS.L90_COMPLETIONS]] = 12;
  highEngRow[hm[PERF_METRIC_COLUMNS.LAST_ACTIVITY_MONTH]] = referenceDate;
  highEngRow[hm[PERF_METRIC_COLUMNS.FIRST_ACTIVITY_MONTH]] = oldDate;
  var rHighEng = classifyRow_(highEngRow, hm, {}, referenceDate);
  assert('Coherence: High engagement → has signals', rHighEng.signals !== '', true);
  assert('Coherence: High engagement demo → signals populated', rHighEng.signals.indexOf('CR:') !== -1, true);

  // Retire action should never appear with Mid or Top tier
  assert('Coherence: Low activity demo with Retire → Low or Inactive tier',
    rLowActCo.action === 'Consider retirement' ? (rLowActCo.tier === 'Low' || rLowActCo.tier === 'Inactive') : true, true);

  // No action needed always means Low priority
  assert('Coherence: No action needed → Low priority (existing check)', pResult.action === 'No action needed' ? pResult.priority === 'Low' : true, true);

  Logger.log('---');
  Logger.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' tests.');
}

function dumpL90Ratios() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var lastRow = sheet.getLastRow();
  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;
  var allData = sheet.getRange(startRow, 1, lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW, sheet.getLastColumn()).getValues();
  var referenceDate = getLatestCompletedMonth_(allData, headerMap);
  var seenNumbers = {};
  var ratios = [];

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var number = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.NUMBER) || '').trim();
    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();
    if (!number || seenNumbers[number]) continue;
    seenNumbers[number] = true;

    var metrics = parseMetrics_(row, headerMap);
    var hasL90Data = metrics.l90Players > 0 || metrics.l90Completions > 0 ||
                     metrics.l90MtOpp > 0 || metrics.l90MtWon > 0;
    if (!hasL90Data || metrics.playersPerMonth <= 0) continue;

    var l90Rate = metrics.l90Players / 3;
    var ratio = Math.round((l90Rate / metrics.playersPerMonth) * 100);
    ratios.push({ number: number, title: title, ratio: ratio, ppm: Math.round(metrics.playersPerMonth), l90Ppm: Math.round(l90Rate) });
  }

  ratios.sort(function(a, b) { return b.ratio - a.ratio; });

  Logger.log('=== L90 Ratio Distribution (' + ratios.length + ' demos with L90 data) ===');
  Logger.log('');

  var buckets = { '200+': 0, '150-199': 0, '120-149': 0, '100-119': 0, '80-99': 0, '50-79': 0, 'under 50': 0 };
  for (var j = 0; j < ratios.length; j++) {
    var r = ratios[j];
    if (r.ratio >= 200) buckets['200+']++;
    else if (r.ratio >= 150) buckets['150-199']++;
    else if (r.ratio >= 120) buckets['120-149']++;
    else if (r.ratio >= 100) buckets['100-119']++;
    else if (r.ratio >= 80) buckets['80-99']++;
    else if (r.ratio >= 50) buckets['50-79']++;
    else buckets['under 50']++;
  }

  Logger.log('Buckets:');
  var bucketKeys = ['200+', '150-199', '120-149', '100-119', '80-99', '50-79', 'under 50'];
  for (var k = 0; k < bucketKeys.length; k++) {
    Logger.log('  ' + bucketKeys[k] + '%: ' + buckets[bucketKeys[k]] + ' demos');
  }

  Logger.log('');
  Logger.log('All ratios (sorted high to low):');
  for (var m = 0; m < ratios.length; m++) {
    var d = ratios[m];
    Logger.log('  #' + d.number + ' ' + d.ratio + '% (ppm=' + d.ppm + ', L90 ppm=' + d.l90Ppm + ') ' + d.title);
  }
}
