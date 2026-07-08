/************************************************************
 * RM_LifecycleScoring.gs - Lifecycle Scoring Pipeline
 *
 * WHAT THIS FILE DOES:
 * Reads Request_Master rows, builds normalized content profiles,
 * exports them for Claude analysis, builds a copyable scoring
 * prompt, imports Claude JSON results, and writes them to a
 * canonical Lifecycle_Scores tab. Manual review fields are
 * preserved across scoring runs.
 *
 * Apps Script does NOT score content. All quality, overlap,
 * and lifecycle scoring is performed by Claude via the
 * export/import workflow.
 *
 * USAGE:
 * Use Lifecycle > Claude Lifecycle Analysis menu items.
 ************************************************************/

/* =========================
   CONFIGURATION
========================= */

var LIFECYCLE_SCORING_CONFIG = {
  RUBRIC_VERSION: 'claude-lifecycle-v1',
  PROMPT_VERSION: 'claude-lifecycle-v1',
  SCORES_SHEET: 'Lifecycle_Scores',
  INPUT_SHEET: 'Lifecycle_Claude_Input',
  PROMPT_SHEET: 'Lifecycle_Claude_Prompt',
  CELL_LIMIT: 45000,
  TEST_LIMIT: 10
};

var MANUAL_REVIEW_FIELDS = [
  'manual_review_status',
  'manual_review_notes',
  'manual_override',
  'final_decision',
  'decision_owner',
  'decision_date'
];

var LIFECYCLE_SCORE_HEADERS = [
  'content_id',
  'source_row_number',
  'repo_number',
  'join_key',
  'status',
  'title',
  'tdp',
  'product',
  'primary_product',
  'content_type',
  'sales_tactic',
  'marketing_program',
  'creation_link',
  'production_link',
  'public_site_link',
  'latest_prod_link',
  'rhac_page',
  'quality_score_abs',
  'quality_grade',
  'quality_title_score',
  'quality_description_score',
  'quality_workflow_specificity_score',
  'quality_metadata_completeness_score',
  'quality_cta_relevance_score',
  'quality_audience_clarity_score',
  'quality_score_reason',
  'metadata_issues',
  'recommended_metadata_fixes',
  'quality_rubric_version',
  'quality_scored_at',
  'quality_input_hash',
  'quality_tdp_rank',
  'quality_tdp_percentile',
  'quality_portfolio_rank',
  'quality_portfolio_percentile',
  'overlap_score',
  'overlap_type',
  'overlap_scope',
  'overlap_cluster_id',
  'overlap_with_ids',
  'overlap_reason',
  'primary_candidate_id',
  'duplicate_risk_level',
  'overlap_review_priority',
  'lifecycle_recommendation',
  'lifecycle_priority_score',
  'lifecycle_priority',
  'lifecycle_confidence',
  'lifecycle_reason',
  'recommended_owner',
  'review_due_quarter',
  'scoring_model',
  'scoring_provider',
  'scoring_prompt_version',
  'scoring_run_id',
  'scored_at',
  'input_hash',
  'source_snapshot_date',
  'source_row_hash',
  'manual_review_status',
  'manual_review_notes',
  'manual_override',
  'final_decision',
  'decision_owner',
  'decision_date'
];

/* =========================
   CONTENT PROFILE HELPERS
========================= */

function lcNormalizeText_(val) {
  return String(val || '').trim().replace(/\s+/g, ' ');
}

function extractArcadeIdFromUrl_(url) {
  if (!url) return '';
  var str = String(url).trim();
  var match = str.match(
    /(?:interact\.redhat\.com|(?:app\.)?arcade\.software)\/(?:share|flows)\/([A-Za-z0-9_-]+)/
  );
  if (match) return match[1];
  match = str.match(/demo\.arcade\.software\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return '';
}

function lcSimpleHash_(str) {
  var hash = 0;
  var s = String(str || '');
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function generateLifecycleContentId_(row, headerMap) {
  var COL = ENHANCED_CONFIG.COLUMNS;

  var number = lcNormalizeText_(safeGetByName(row, headerMap, COL.NUMBER));
  if (number) return 'NUM-' + number;

  var joinKey = lcNormalizeText_(safeGetByName(row, headerMap, COL.JOIN_KEY));
  if (joinKey) return 'JK-' + joinKey;

  var links = [
    safeGetByName(row, headerMap, COL.CREATION_LINK),
    safeGetByName(row, headerMap, COL.PROD_ARCADE_LINK),
    safeGetByName(row, headerMap, COL.PUBLIC_SITE_LINK),
    safeGetByName(row, headerMap, COL.LATEST_PROD_LINK),
    safeGetByName(row, headerMap, COL.RHAC_PAGE)
  ];
  for (var i = 0; i < links.length; i++) {
    var arcadeId = extractArcadeIdFromUrl_(links[i]);
    if (arcadeId) return 'ARC-' + arcadeId;
  }

  var title = lcNormalizeText_(safeGetByName(row, headerMap, COL.FINAL_DEMO_TITLE));
  var cl = lcNormalizeText_(safeGetByName(row, headerMap, COL.CREATION_LINK));
  var pl = lcNormalizeText_(safeGetByName(row, headerMap, COL.PROD_ARCADE_LINK));
  return 'HASH-' + lcSimpleHash_(title + '|' + cl + '|' + pl);
}

function lcComputeRowHash_(p) {
  return lcSimpleHash_([p.title, p.tdp, p.product, p.status,
    p.demo_description, p.creation_link, p.production_link].join('|'));
}

function lcComputeInputHash_(p) {
  return lcSimpleHash_([p.title, p.demo_description, p.seo_words,
    p.seo_description, p.cta_link, p.primary_audience,
    p.context_description, p.relevant_links_ctas].join('|'));
}

/* =========================
   CONTENT PROFILE BUILDER
========================= */

function buildLifecycleContentProfiles_(options) {
  options = options || {};
  var limit = options.limit || 0;
  var COL = ENHANCED_CONFIG.COLUMNS;

  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var lastRow = sheet.getLastRow();
  var errors = [];

  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
    return { profiles: [], errors: ['No data rows in Request_Master'] };
  }

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var allData = sheet.getRange(
    ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, 1, dataRows, sheet.getLastColumn()
  ).getValues();

  var profiles = [];
  var seenIds = {};

  for (var i = 0; i < allData.length; i++) {
    if (limit > 0 && profiles.length >= limit) break;

    var row = allData[i];
    var status = lcNormalizeText_(safeGetByName(row, headerMap, COL.STATUS));

    if (status !== ENHANCED_CONFIG.STATUS.IE_PUBLISHED &&
        status !== ENHANCED_CONFIG.STATUS.IE_REVIEWED) continue;

    var rowNum = i + ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;

    try {
      var contentId = generateLifecycleContentId_(row, headerMap);
      if (seenIds[contentId]) {
        errors.push('Duplicate content_id "' + contentId + '" at rows ' +
          seenIds[contentId] + ' and ' + rowNum);
        contentId = contentId + '-R' + rowNum;
      }
      seenIds[contentId] = rowNum;

      var profile = {
        content_id: contentId,
        source_row_number: rowNum,
        repo_number: lcNormalizeText_(safeGetByName(row, headerMap, COL.NUMBER)),
        join_key: lcNormalizeText_(safeGetByName(row, headerMap, COL.JOIN_KEY)),
        status: status,
        title: lcNormalizeText_(safeGetByName(row, headerMap, COL.FINAL_DEMO_TITLE))
          || lcNormalizeText_(safeGetByName(row, headerMap, COL.SUGGESTED_TITLE)),
        tdp: lcNormalizeText_(safeGetByName(row, headerMap, COL.TDP)),
        product: lcNormalizeText_(safeGetByName(row, headerMap, COL.PRODUCT)),
        primary_product: lcNormalizeText_(safeGetByName(row, headerMap, COL.PRIMARY_PRODUCT)),
        content_type: lcNormalizeText_(safeGetByName(row, headerMap, COL.FINAL_CONTENT_TYPE))
          || lcNormalizeText_(safeGetByName(row, headerMap, COL.CONTENT_TYPE)),
        sales_tactic: lcNormalizeText_(safeGetByName(row, headerMap, COL.SALES_TACTIC)),
        marketing_program: lcNormalizeText_(safeGetByName(row, headerMap, COL.MARKETING_PROGRAM)),
        creation_link: lcNormalizeText_(safeGetByName(row, headerMap, COL.CREATION_LINK)),
        production_link: lcNormalizeText_(safeGetByName(row, headerMap, COL.PROD_ARCADE_LINK)),
        public_site_link: lcNormalizeText_(safeGetByName(row, headerMap, COL.PUBLIC_SITE_LINK)),
        latest_prod_link: lcNormalizeText_(safeGetByName(row, headerMap, COL.LATEST_PROD_LINK)),
        rhac_page: lcNormalizeText_(safeGetByName(row, headerMap, COL.RHAC_PAGE)),
        demo_description: lcNormalizeText_(safeGetByName(row, headerMap, COL.DEMO_DESCRIPTION)),
        generated_description: lcNormalizeText_(safeGetByName(row, headerMap, 'Demo Description (Gemni generated)')),
        seo_words: lcNormalizeText_(safeGetByName(row, headerMap, COL.SEO_WORDS)),
        seo_description: lcNormalizeText_(safeGetByName(row, headerMap, 'SEODescription')),
        cta_link: lcNormalizeText_(safeGetByName(row, headerMap, COL.CTA_LINK)),
        context_description: lcNormalizeText_(safeGetByName(row, headerMap, COL.CONTEXT_DESC)),
        primary_audience: lcNormalizeText_(safeGetByName(row, headerMap, COL.PRIMARY_AUDIENCE)),
        personas: lcNormalizeText_(safeGetByName(row, headerMap, COL.PERSONAS)),
        pain_points: lcNormalizeText_(safeGetByName(row, headerMap, COL.PAIN_POINTS)),
        relevant_links_ctas: lcNormalizeText_(safeGetByName(row, headerMap, COL.REQUEST_LINKS)),
        verticals: lcNormalizeText_(safeGetByName(row, headerMap, COL.VERTICALS)),
        event: lcNormalizeText_(safeGetByName(row, headerMap, COL.EVENT)),
        creator_name: lcNormalizeText_(safeGetByName(row, headerMap, COL.CREATOR_NAME)),
        creator_team: lcNormalizeText_(safeGetByName(row, headerMap, COL.CREATOR_TEAM)),
        language: lcNormalizeText_(safeGetByName(row, headerMap, COL.LANGUAGE)),
        duration: lcNormalizeText_(safeGetByName(row, headerMap, 'Duration')),
        metadata_raw: lcNormalizeText_(safeGetByName(row, headerMap, COL.METADATA))
      };

      profile.source_row_hash = lcComputeRowHash_(profile);
      profile.input_hash = lcComputeInputHash_(profile);
      profiles.push(profile);
    } catch (e) {
      errors.push('Row ' + rowNum + ': ' + e.message);
    }
  }

  return { profiles: profiles, errors: errors };
}

function buildLifecycleProfileLookup_() {
  var result = buildLifecycleContentProfiles_();
  var byId = {};
  var byRow = {};
  for (var i = 0; i < result.profiles.length; i++) {
    var p = result.profiles[i];
    byId[p.content_id] = p;
    byRow[String(p.source_row_number)] = p;
  }
  return { byId: byId, byRow: byRow, errors: result.errors, count: result.profiles.length };
}

/* =========================
   RELATIVE QUALITY RANKING
========================= */

function recomputeLifecycleQualityRanks_(rows) {
  var scored = rows.filter(function(r) {
    return r.quality_score_abs !== '' && r.quality_score_abs !== undefined &&
           r.quality_score_abs !== null && !isNaN(Number(r.quality_score_abs));
  });

  if (scored.length === 0) return;

  var allScores = scored.map(function(r) { return Number(r.quality_score_abs); });
  allScores.sort(function(a, b) { return b - a; });

  for (var i = 0; i < scored.length; i++) {
    var score = Number(scored[i].quality_score_abs);
    scored[i].quality_portfolio_rank = allScores.indexOf(score) + 1;
    var below = allScores.filter(function(s) { return s < score; }).length;
    scored[i].quality_portfolio_percentile =
      allScores.length > 1 ? Math.round((below / (allScores.length - 1)) * 100) : 100;
  }

  var tdpGroups = {};
  for (var j = 0; j < scored.length; j++) {
    var tdp = scored[j].tdp || 'Unassigned';
    if (!tdpGroups[tdp]) tdpGroups[tdp] = [];
    tdpGroups[tdp].push(j);
  }

  var tdpKeys = Object.keys(tdpGroups);
  for (var t = 0; t < tdpKeys.length; t++) {
    var indices = tdpGroups[tdpKeys[t]];
    var tdpScores = indices.map(function(idx) { return Number(scored[idx].quality_score_abs); });
    tdpScores.sort(function(a, b) { return b - a; });

    for (var k = 0; k < indices.length; k++) {
      var idx = indices[k];
      var s = Number(scored[idx].quality_score_abs);
      scored[idx].quality_tdp_rank = tdpScores.indexOf(s) + 1;
      var belowTdp = tdpScores.filter(function(v) { return v < s; }).length;
      scored[idx].quality_tdp_percentile =
        tdpScores.length > 1 ? Math.round((belowTdp / (tdpScores.length - 1)) * 100) : 100;
    }
  }
}

/* =========================
   SHEET HELPERS
========================= */

function getOrCreateLifecycleScoresSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LIFECYCLE_SCORING_CONFIG.SCORES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LIFECYCLE_SCORING_CONFIG.SCORES_SHEET);
    sheet.getRange(1, 1, 1, LIFECYCLE_SCORE_HEADERS.length)
      .setValues([LIFECYCLE_SCORE_HEADERS])
      .setFontWeight('bold')
      .setBackground('#e8eaed');
    sheet.setFrozenRows(1);
    Logger.log('Created "' + LIFECYCLE_SCORING_CONFIG.SCORES_SHEET + '" tab.');
  }
  return sheet;
}

function ensureLifecycleScoreHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  var existing = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); })
    : [];

  for (var i = 0; i < LIFECYCLE_SCORE_HEADERS.length; i++) {
    if (existing.indexOf(LIFECYCLE_SCORE_HEADERS[i]) === -1) {
      sheet.getRange(1, existing.length + 1).setValue(LIFECYCLE_SCORE_HEADERS[i]);
      existing.push(LIFECYCLE_SCORE_HEADERS[i]);
    }
  }

  var map = {};
  for (var h = 0; h < existing.length; h++) {
    if (existing[h]) map[existing[h]] = h;
  }
  return map;
}

function buildExistingManualReviewMap_(sheet, headerMap) {
  var manualMap = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return manualMap;

  var cidCol = headerMap['content_id'];
  if (cidCol === undefined) return manualMap;

  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    var cid = String(data[i][cidCol] || '').trim();
    if (!cid) continue;

    var vals = {};
    var hasAny = false;
    for (var m = 0; m < MANUAL_REVIEW_FIELDS.length; m++) {
      var col = headerMap[MANUAL_REVIEW_FIELDS[m]];
      if (col !== undefined) {
        var v = String(data[i][col] || '').trim();
        if (v) { vals[MANUAL_REVIEW_FIELDS[m]] = v; hasAny = true; }
      }
    }
    if (hasAny) manualMap[cid] = vals;
  }
  return manualMap;
}

function readExistingLifecycleScoresMap_(sheet, headerMap) {
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return map;

  var cidCol = headerMap['content_id'];
  if (cidCol === undefined) return map;

  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    var cid = String(data[i][cidCol] || '').trim();
    if (!cid) continue;

    var obj = {};
    for (var h = 0; h < LIFECYCLE_SCORE_HEADERS.length; h++) {
      var header = LIFECYCLE_SCORE_HEADERS[h];
      var col = headerMap[header];
      obj[header] = (col !== undefined && data[i][col] !== undefined) ? data[i][col] : '';
    }
    map[cid] = obj;
  }
  return map;
}

function writeLifecycleScoresToSheet_(mergedResults) {
  var sheet = getOrCreateLifecycleScoresSheet_();
  var headerMap = ensureLifecycleScoreHeaders_(sheet);
  var manualMap = buildExistingManualReviewMap_(sheet, headerMap);
  var existingMap = readExistingLifecycleScoresMap_(sheet, headerMap);

  var manualPreserved = 0;
  for (var i = 0; i < mergedResults.length; i++) {
    var r = mergedResults[i];
    var cid = r.content_id;

    if (manualMap[cid]) {
      var manual = manualMap[cid];
      var mkeys = Object.keys(manual);
      for (var mk = 0; mk < mkeys.length; mk++) {
        r[mkeys[mk]] = manual[mkeys[mk]];
      }
      manualPreserved++;
    }

    existingMap[cid] = r;
  }

  var allRows = [];
  var keys = Object.keys(existingMap);
  for (var k = 0; k < keys.length; k++) {
    allRows.push(existingMap[keys[k]]);
  }

  recomputeLifecycleQualityRanks_(allRows);

  allRows.sort(function(a, b) {
    return (Number(a.source_row_number) || 9999) - (Number(b.source_row_number) || 9999);
  });

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }

  var numCols = LIFECYCLE_SCORE_HEADERS.length;
  var output = [];
  for (var r2 = 0; r2 < allRows.length; r2++) {
    var row = allRows[r2];
    var rowData = [];
    for (var h2 = 0; h2 < numCols; h2++) {
      var val = row[LIFECYCLE_SCORE_HEADERS[h2]];
      rowData.push(val !== undefined && val !== null ? val : '');
    }
    output.push(rowData);
  }

  if (output.length > 0) {
    sheet.getRange(2, 1, output.length, numCols).setValues(output);
  }

  Logger.log('Wrote ' + output.length + ' rows to ' + LIFECYCLE_SCORING_CONFIG.SCORES_SHEET +
    ' (manual preserved: ' + manualPreserved + ')');
  return { rows_written: output.length, manual_preserved: manualPreserved };
}

/* =========================
   CLAUDE EXPORT
========================= */

function exportLifecycleProfilesForClaude() {
  var buildResult = buildLifecycleContentProfiles_();
  var profiles = buildResult.profiles;

  if (profiles.length === 0) {
    Logger.log('No eligible profiles to export.');
    SpreadsheetApp.getUi().alert('No IE Published or IE Reviewed rows found.');
    return;
  }

  var tdpGroups = {};
  for (var i = 0; i < profiles.length; i++) {
    var tdp = profiles[i].tdp || 'Unassigned';
    if (!tdpGroups[tdp]) tdpGroups[tdp] = [];
    tdpGroups[tdp].push(profiles[i]);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = LIFECYCLE_SCORING_CONFIG.INPUT_SHEET;
  var exportSheet = ss.getSheetByName(sheetName);
  if (exportSheet) { exportSheet.clear(); } else { exportSheet = ss.insertSheet(sheetName); }

  var headers = ['export_group', 'tdp', 'part', 'demo_count', 'json_data', 'instructions'];
  exportSheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#e8eaed');
  exportSheet.setFrozenRows(1);

  var tdpKeys = Object.keys(tdpGroups).sort();
  var exportRow = 2;
  var totalDemos = 0;

  for (var g = 0; g < tdpKeys.length; g++) {
    var tdp = tdpKeys[g];
    var group = tdpGroups[tdp];
    totalDemos += group.length;

    var fullJson = JSON.stringify(group, null, 0);
    var instruction = 'Copy the Claude prompt from ' + LIFECYCLE_SCORING_CONFIG.PROMPT_SHEET +
      ' tab, then paste this JSON after it. ' + group.length + ' demos in TDP "' + tdp + '".';

    if (fullJson.length <= LIFECYCLE_SCORING_CONFIG.CELL_LIMIT) {
      exportSheet.getRange(exportRow, 1).setValue(tdp);
      exportSheet.getRange(exportRow, 2).setValue(tdp);
      exportSheet.getRange(exportRow, 3).setValue(1);
      exportSheet.getRange(exportRow, 4).setValue(group.length);
      exportSheet.getRange(exportRow, 5).setValue(fullJson);
      exportSheet.getRange(exportRow, 6).setValue(instruction);
      exportRow++;
    } else {
      var chunkSize = Math.max(1, Math.ceil(group.length /
        Math.ceil(fullJson.length / LIFECYCLE_SCORING_CONFIG.CELL_LIMIT)));
      var part = 1;
      for (var c = 0; c < group.length; c += chunkSize) {
        var chunk = group.slice(c, c + chunkSize);
        exportSheet.getRange(exportRow, 1).setValue(tdp + ' (part ' + part + ')');
        exportSheet.getRange(exportRow, 2).setValue(tdp);
        exportSheet.getRange(exportRow, 3).setValue(part);
        exportSheet.getRange(exportRow, 4).setValue(chunk.length);
        exportSheet.getRange(exportRow, 5).setValue(JSON.stringify(chunk, null, 0));
        exportSheet.getRange(exportRow, 6).setValue(instruction + ' Part ' + part + '.');
        exportRow++;
        part++;
      }
    }
  }

  exportSheet.autoResizeColumn(1);
  exportSheet.autoResizeColumn(2);
  exportSheet.setColumnWidth(5, 400);

  Logger.log('Exported ' + totalDemos + ' profiles in ' + tdpKeys.length + ' TDP groups.');
  SpreadsheetApp.getUi().alert(
    'Exported ' + totalDemos + ' profiles in ' + tdpKeys.length + ' TDP groups to "' +
    sheetName + '" tab.\n\nBuild errors: ' + buildResult.errors.length +
    '\n\nNext: Run "Build Claude lifecycle prompt" then copy/paste into Claude.'
  );
}

/* =========================
   CLAUDE PROMPT BUILDER
========================= */

function buildClaudeLifecyclePrompt() {
  var prompt = [
    'You are analyzing interactive demo/arcade content for Red Hat\'s lifecycle management system.',
    'You will receive a JSON array of demos from a single Technology Decision Point (TDP) group.',
    '',
    'For EACH demo, you must:',
    '1. Score absolute content quality using a fixed 100-point rubric',
    '2. Detect content overlap with other demos in the SAME TDP group',
    '3. Recommend a lifecycle action',
    '',
    'Return ONLY a valid JSON array. No markdown, no explanation, no commentary.',
    'Every input demo must appear exactly once in the output.',
    '',
    '---',
    '',
    '## 1. Quality Scoring Rubric (100 points total)',
    '',
    'Score each demo ABSOLUTELY — not relative to its TDP group.',
    'A demo with a vague title and no description scores poorly regardless of other demos.',
    '',
    'Dimensions and max points:',
    '- title_specificity (15): Does the title name a specific product, workflow, and outcome? Penalize generic/placeholder/very short titles.',
    '- description_clarity (20): Does the description explain what the user will learn and do? Penalize missing, generic, or title-duplicate descriptions.',
    '- workflow_specificity (30): Does the content describe concrete hands-on steps, named features, and verifiable outcomes? Look for bullet highlights, numbered steps, and technical terms. This is the highest-weighted dimension.',
    '- metadata_completeness (15): Are TDP, Product, Primary Product, Content Type, Sales Tactic, Marketing Program, SEO Words, Primary Audience, and Creator populated?',
    '- cta_relevance (10): Does the demo have a CTA link, relevant links, SEO keywords, and SEO description?',
    '- audience_use_case_clarity (10): Are Primary Audience, Personas, Verticals, Pain Points, or Sales Tactic defined?',
    '',
    'Grade interpretation:',
    '- 90-100 = Excellent',
    '- 75-89 = Good',
    '- 60-74 = Needs improvement',
    '- 40-59 = Weak',
    '- 0-39 = Poor',
    '',
    '---',
    '',
    '## 2. Overlap Detection',
    '',
    'Detect overlap between demos in the SAME TDP group ONLY.',
    '',
    'CRITICAL RULES:',
    '- Same product alone is NOT overlap.',
    '- Same TDP alone is NOT overlap.',
    '- Same product + same TDP is NOT overlap.',
    '- Focus on: workflow similarity, use-case similarity, CTA similarity, title similarity, description similarity, SEO similarity, named product feature similarity.',
    '- Business Intro and Technical Walkthrough on the same topic may be COMPLEMENTARY, not duplicate.',
    '- Two demos covering DIFFERENT workflows on the same product are NOT overlapping.',
    '',
    'Overlap types:',
    '- exact_duplicate: Essentially the same content (score 90-100)',
    '- same_workflow_overlap: Same workflow/use case, different presentation (score 80-89)',
    '- same_topic_different_depth: Same topic, different depth, e.g. intro vs deep-dive (score 70-79)',
    '- same_product_different_use_case: Same product, genuinely different use cases (score 50-69)',
    '- complementary_content: Related content serving different purposes (score 50-69)',
    '- not_overlap: No meaningful overlap (score 0-49)',
    '',
    '---',
    '',
    '## 3. Lifecycle Recommendation',
    '',
    'Based on quality and overlap, recommend ONE action:',
    '- Keep: quality >= 75, no strong overlap, no severe metadata issues',
    '- Refresh metadata: quality 60-74, or metadata incomplete, or CTA/SEO weak',
    '- Refresh content: quality < 60, potentially relevant, not a duplicate',
    '- Merge with stronger asset: overlap >= 80, same_workflow_overlap, another asset is stronger',
    '- Retire candidate: exact_duplicate or strong overlap AND quality < 60',
    '- Needs human review: conflicting signals, missing data, or uncertain',
    '',
    'These are REVIEW RECOMMENDATIONS, not final decisions. When uncertain, use "Needs human review".',
    '',
    '---',
    '',
    '## 4. Output JSON Schema',
    '',
    'Return a JSON array. Each item:',
    '[',
    '  {',
    '    "content_id": "string (echo from input)",',
    '    "source_row_number": number,',
    '    "quality_score_abs": number (0-100),',
    '    "quality_grade": "Excellent | Good | Needs improvement | Weak | Poor",',
    '    "quality_score_reason": "1-2 sentences",',
    '    "dimension_scores": {',
    '      "title_specificity": number (0-15),',
    '      "description_clarity": number (0-20),',
    '      "workflow_specificity": number (0-30),',
    '      "metadata_completeness": number (0-15),',
    '      "cta_relevance": number (0-10),',
    '      "audience_use_case_clarity": number (0-10)',
    '    },',
    '    "metadata_issues": ["specific issues"],',
    '    "recommended_metadata_fixes": ["specific fixes"],',
    '    "overlap_score": number (0-100),',
    '    "overlap_type": "exact_duplicate | same_workflow_overlap | same_topic_different_depth | same_product_different_use_case | complementary_content | not_overlap",',
    '    "overlap_scope": "same_tdp",',
    '    "overlap_cluster_id": "CL-N or empty",',
    '    "overlap_with_ids": ["content_id of overlapping demos"],',
    '    "overlap_reason": "1 sentence",',
    '    "primary_candidate_id": "content_id of stronger asset or empty",',
    '    "duplicate_risk_level": "none | low | medium | high | critical",',
    '    "overlap_review_priority": "low | medium | high | critical",',
    '    "lifecycle_recommendation": "Keep | Refresh metadata | Refresh content | Merge with stronger asset | Retire candidate | Needs human review",',
    '    "lifecycle_priority_score": number (0-100),',
    '    "lifecycle_priority": "low | medium | high | critical",',
    '    "lifecycle_confidence": "low | medium | high",',
    '    "lifecycle_reason": "1-2 sentences"',
    '  }',
    ']',
    '',
    '---',
    '',
    '## Input Data',
    '',
    'The following TDP group data is a JSON array. Analyze ALL demos below:'
  ].join('\n');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = LIFECYCLE_SCORING_CONFIG.PROMPT_SHEET;
  var promptSheet = ss.getSheetByName(sheetName);
  if (promptSheet) { promptSheet.clear(); } else { promptSheet = ss.insertSheet(sheetName); }

  promptSheet.getRange(1, 1).setValue('Section').setFontWeight('bold');
  promptSheet.getRange(1, 2).setValue('Content').setFontWeight('bold');

  promptSheet.getRange(2, 1).setValue('Usage');
  promptSheet.getRange(2, 2).setValue(
    'Workflow:\n' +
    '1. Run "Export lifecycle profiles for Claude" to create the ' +
    LIFECYCLE_SCORING_CONFIG.INPUT_SHEET + ' tab.\n' +
    '2. Copy the PROMPT text from row 3 below.\n' +
    '3. Open Claude. Paste the prompt.\n' +
    '4. Copy one TDP group\'s json_data from ' +
    LIFECYCLE_SCORING_CONFIG.INPUT_SHEET + ' and paste it after the prompt.\n' +
    '5. Claude returns a JSON array.\n' +
    '6. Run "Import Claude lifecycle results" from the menu.\n' +
    '7. Paste Claude\'s JSON output in the dialog.\n' +
    '8. Repeat steps 3-7 for each TDP group.\n' +
    '9. Results accumulate in the ' + LIFECYCLE_SCORING_CONFIG.SCORES_SHEET + ' tab.'
  );

  promptSheet.getRange(3, 1).setValue('Prompt');
  promptSheet.getRange(3, 2).setValue(prompt);

  promptSheet.setColumnWidth(1, 100);
  promptSheet.setColumnWidth(2, 800);
  promptSheet.getRange('B2:B3').setWrap(true);

  Logger.log('Claude lifecycle prompt written to "' + sheetName + '" tab.');
  SpreadsheetApp.getUi().alert(
    'Prompt written to "' + sheetName + '" tab.\n\n' +
    'Copy the prompt from cell B3, then paste TDP group data after it in Claude.'
  );
}

/* =========================
   CLAUDE RESULTS IMPORT
========================= */

function stripJsonCodeFence_(text) {
  var s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*\n?/i, '');
  s = s.replace(/\n?\s*```\s*$/i, '');
  return s.trim();
}

function normalizeClaudeLifecycleResults_(raw) {
  var stripped = stripJsonCodeFence_(raw);
  var parsed = JSON.parse(stripped);

  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;

  throw new Error('Expected a JSON array, {"results": [...]}, or {"data": [...]}');
}

function generateScoringRunId_() {
  var now = new Date();
  return 'LS-' + now.getFullYear() +
    ('0' + (now.getMonth() + 1)).slice(-2) +
    ('0' + now.getDate()).slice(-2) + '-' +
    ('0' + now.getHours()).slice(-2) +
    ('0' + now.getMinutes()).slice(-2) +
    ('0' + now.getSeconds()).slice(-2);
}

function importClaudeLifecycleResults(resultsJson) {
  var results = normalizeClaudeLifecycleResults_(resultsJson);
  if (results.length === 0) {
    throw new Error('JSON array is empty — no results to import.');
  }

  var lookup = buildLifecycleProfileLookup_();
  var runId = generateScoringRunId_();
  var scoredAt = new Date().toISOString();
  var snapshotDate = scoredAt.split('T')[0];

  var mergedResults = [];
  var matched = 0;
  var fallbackMatched = 0;
  var unmatched = 0;
  var skipped = 0;
  var duplicateIds = {};
  var parseErrors = [];

  for (var i = 0; i < results.length; i++) {
    var cr = results[i];
    if (!cr || typeof cr !== 'object') {
      parseErrors.push('Item ' + i + ' is not an object');
      skipped++;
      continue;
    }

    var profile = null;
    var matchType = 'none';

    if (cr.content_id && lookup.byId[cr.content_id]) {
      profile = lookup.byId[cr.content_id];
      matched++;
      matchType = 'content_id';
    } else if (cr.source_row_number && lookup.byRow[String(cr.source_row_number)]) {
      profile = lookup.byRow[String(cr.source_row_number)];
      fallbackMatched++;
      matchType = 'source_row_number';
    } else {
      unmatched++;
    }

    var cid = profile ? profile.content_id : (cr.content_id || 'UNKNOWN-' + i);
    if (duplicateIds[cid]) {
      cid = cid + '-DUP' + i;
    }
    duplicateIds[cid] = true;

    var dims = cr.dimension_scores || {};
    var metaIssues = Array.isArray(cr.metadata_issues) ? cr.metadata_issues.join('; ') : (cr.metadata_issues || '');
    var metaFixes = Array.isArray(cr.recommended_metadata_fixes) ? cr.recommended_metadata_fixes.join('; ') : (cr.recommended_metadata_fixes || '');
    var overlapWith = Array.isArray(cr.overlap_with_ids) ? cr.overlap_with_ids.join(', ') : (cr.overlap_with_ids || '');

    var merged = {
      content_id: cid,
      source_row_number: profile ? profile.source_row_number : (cr.source_row_number || ''),
      repo_number: profile ? profile.repo_number : '',
      join_key: profile ? profile.join_key : '',
      status: profile ? profile.status : '',
      title: profile ? profile.title : '',
      tdp: profile ? profile.tdp : '',
      product: profile ? profile.product : '',
      primary_product: profile ? profile.primary_product : '',
      content_type: profile ? profile.content_type : '',
      sales_tactic: profile ? profile.sales_tactic : '',
      marketing_program: profile ? profile.marketing_program : '',
      creation_link: profile ? profile.creation_link : '',
      production_link: profile ? profile.production_link : '',
      public_site_link: profile ? profile.public_site_link : '',
      latest_prod_link: profile ? profile.latest_prod_link : '',
      rhac_page: profile ? profile.rhac_page : '',

      quality_score_abs: cr.quality_score_abs !== undefined ? cr.quality_score_abs : '',
      quality_grade: cr.quality_grade || '',
      quality_title_score: dims.title_specificity !== undefined ? dims.title_specificity : '',
      quality_description_score: dims.description_clarity !== undefined ? dims.description_clarity : '',
      quality_workflow_specificity_score: dims.workflow_specificity !== undefined ? dims.workflow_specificity : '',
      quality_metadata_completeness_score: dims.metadata_completeness !== undefined ? dims.metadata_completeness : '',
      quality_cta_relevance_score: dims.cta_relevance !== undefined ? dims.cta_relevance : '',
      quality_audience_clarity_score: dims.audience_use_case_clarity !== undefined ? dims.audience_use_case_clarity : '',
      quality_score_reason: cr.quality_score_reason || '',
      metadata_issues: metaIssues,
      recommended_metadata_fixes: metaFixes,
      quality_rubric_version: LIFECYCLE_SCORING_CONFIG.RUBRIC_VERSION,
      quality_scored_at: scoredAt,
      quality_input_hash: profile ? profile.input_hash : '',

      quality_tdp_rank: '',
      quality_tdp_percentile: '',
      quality_portfolio_rank: '',
      quality_portfolio_percentile: '',

      overlap_score: cr.overlap_score !== undefined ? cr.overlap_score : '',
      overlap_type: cr.overlap_type || '',
      overlap_scope: cr.overlap_scope || 'same_tdp',
      overlap_cluster_id: cr.overlap_cluster_id || '',
      overlap_with_ids: overlapWith,
      overlap_reason: cr.overlap_reason || '',
      primary_candidate_id: cr.primary_candidate_id || '',
      duplicate_risk_level: cr.duplicate_risk_level || '',
      overlap_review_priority: cr.overlap_review_priority || '',

      lifecycle_recommendation: cr.lifecycle_recommendation || '',
      lifecycle_priority_score: cr.lifecycle_priority_score !== undefined ? cr.lifecycle_priority_score : '',
      lifecycle_priority: cr.lifecycle_priority || '',
      lifecycle_confidence: cr.lifecycle_confidence || '',
      lifecycle_reason: cr.lifecycle_reason || '',
      recommended_owner: cr.recommended_owner || '',
      review_due_quarter: cr.review_due_quarter || '',

      scoring_model: 'claude',
      scoring_provider: 'claude-code',
      scoring_prompt_version: LIFECYCLE_SCORING_CONFIG.PROMPT_VERSION,
      scoring_run_id: runId,
      scored_at: scoredAt,
      input_hash: profile ? profile.input_hash : '',
      source_snapshot_date: snapshotDate,
      source_row_hash: profile ? profile.source_row_hash : ''
    };

    mergedResults.push(merged);
  }

  var writeResult = writeLifecycleScoresToSheet_(mergedResults);

  var summary = {
    scoring_run_id: runId,
    timestamp: scoredAt,
    rows_parsed: results.length,
    rows_imported: mergedResults.length,
    rows_skipped: skipped,
    rows_written: writeResult.rows_written,
    matched: matched,
    fallback_matched: fallbackMatched,
    unmatched: unmatched,
    duplicate_content_ids: Object.keys(duplicateIds).length < mergedResults.length
      ? mergedResults.length - Object.keys(duplicateIds).length : 0,
    manual_preserved: writeResult.manual_preserved,
    parse_errors: parseErrors,
    profiles_available: lookup.count,
    build_errors: lookup.errors
  };

  try {
    CacheService.getScriptCache().put('LIFECYCLE_IMPORT_SUMMARY', JSON.stringify(summary), 3600);
  } catch (e) {}

  Logger.log('Import complete: ' + JSON.stringify(summary, null, 2));
  return summary;
}

/* =========================
   IMPORT DIALOG
========================= */

function openClaudeLifecycleImportDialog() {
  var html = HtmlService.createHtmlOutputFromFile('LifecycleClaudeImportDialog')
    .setWidth(720)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import Claude Lifecycle Results');
}

/* =========================
   VALIDATION & SUMMARY
========================= */

function getLifecycleImportSummary() {
  try {
    var cached = CacheService.getScriptCache().get('LIFECYCLE_IMPORT_SUMMARY');
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  return { message: 'No recent import found. Run an import first.' };
}

function openLifecycleImportSummary_() {
  var summary = getLifecycleImportSummary();
  var html = HtmlService.createHtmlOutput(
    '<pre style="font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap;">' +
    JSON.stringify(summary, null, 2).replace(/</g, '&lt;') +
    '</pre>'
  ).setWidth(700).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'Lifecycle Import Summary');
}

/* =========================
   UTILITIES
========================= */

function clearGeneratedLifecycleScoresOnly() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LIFECYCLE_SCORING_CONFIG.SCORES_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Lifecycle_Scores tab not found.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    SpreadsheetApp.getUi().alert('No data rows to clear.');
    return;
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });

  var dataRows = lastRow - 1;
  var cleared = 0;
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] && MANUAL_REVIEW_FIELDS.indexOf(headers[i]) === -1) {
      sheet.getRange(2, i + 1, dataRows, 1).clearContent();
      cleared++;
    }
  }

  Logger.log('Cleared ' + cleared + ' generated columns. Manual review fields preserved.');
  SpreadsheetApp.getUi().alert('Cleared generated scores. Manual review fields preserved.');
}

function openLatestLifecycleScores() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LIFECYCLE_SCORING_CONFIG.SCORES_SHEET);
  if (sheet) {
    ss.setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert(
      'Lifecycle_Scores tab not found. Run an import first.');
  }
}
