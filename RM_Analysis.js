/************************************************************
 * RM_Analysis.gs - Content Overlap & Quality Analysis
 *
 * WHAT THIS FILE DOES:
 * Groups demos by TDP and sends each group to Gemini for:
 * - Relative quality scoring (1-100 within the group)
 * - Content overlap detection between demos
 * - Actionable notes per demo
 *
 * Results are written to auto-created columns on Request_Master.
 *
 * USAGE:
 * Run analyzeContent() from the Apps Script editor.
 * Run clearAnalysisResults() to wipe and re-run.
 * Both skip already-processed rows for re-runnability.
 ************************************************************/

var ANALYSIS_COLUMNS = {
  ROW: 'Row',
  QUALITY_SCORE: 'Quality Score',
  QUALITY_NOTE: 'Quality Note',
  OVERLAP_SCORE: 'Overlap Score',
  OVERLAPS_WITH: 'Overlaps With',
  OVERLAP_NOTE: 'Overlap Note',
  NOTE: 'Note'
};

var ANALYSIS_SOURCE_COLUMNS = {
  DESCRIPTION_BN: 66,
  PRIMARY_PRODUCT: 'Primary Product'
};

function getDescriptionByCol_(row, colIndex, headerRow) {
  return String(row[colIndex - 1] || '').trim();
}

function getProduct_(row, headerMap) {
  var primary = String(safeGetByName(row, headerMap, ANALYSIS_SOURCE_COLUMNS.PRIMARY_PRODUCT) || '').trim();
  if (primary) return primary;
  return String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PRODUCT) || '').trim();
}

function ensureAnalysisColumns_(sheet) {
  var needed = [
    ANALYSIS_COLUMNS.ROW,
    ANALYSIS_COLUMNS.QUALITY_SCORE,
    ANALYSIS_COLUMNS.QUALITY_NOTE,
    ANALYSIS_COLUMNS.OVERLAP_SCORE,
    ANALYSIS_COLUMNS.OVERLAPS_WITH,
    ANALYSIS_COLUMNS.OVERLAP_NOTE,
    ANALYSIS_COLUMNS.NOTE
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
    rowCol: headers.indexOf(ANALYSIS_COLUMNS.ROW) + 1,
    qualityScoreCol: headers.indexOf(ANALYSIS_COLUMNS.QUALITY_SCORE) + 1,
    qualityNoteCol: headers.indexOf(ANALYSIS_COLUMNS.QUALITY_NOTE) + 1,
    overlapScoreCol: headers.indexOf(ANALYSIS_COLUMNS.OVERLAP_SCORE) + 1,
    overlapsWithCol: headers.indexOf(ANALYSIS_COLUMNS.OVERLAPS_WITH) + 1,
    overlapNoteCol: headers.indexOf(ANALYSIS_COLUMNS.OVERLAP_NOTE) + 1,
    noteCol: headers.indexOf(ANALYSIS_COLUMNS.NOTE) + 1
  };
}

/* =========================
   COMBINED ANALYSIS PROMPT
========================= */

function buildAnalysisPrompt_(demos, tdp) {
  var demoList = demos.map(function(d) {
    return 'Row ' + d.row + ' | Title: ' + d.title +
      ' | Product: ' + d.product +
      ' | Description: ' + d.description;
  }).join('\n\n');

  return 'You are reviewing ' + demos.length + ' interactive demos in the "' + tdp + '" Technology Decision Point.\n\n' +
    'Do TWO things for each demo:\n\n' +
    '1. RELATIVE QUALITY SCORE (1-100):\n' +
    'Rank all demos in this group relative to each other. The best demo gets the highest score, the weakest gets the lowest.\n' +
    'Spread scores across the full range — do not cluster everything at 70-80.\n' +
    'Criteria: title specificity, description clarity, highlight detail, completeness of workflow coverage.\n\n' +
    '2. OVERLAP DETECTION:\n' +
    'Identify demos that cover substantially the same topic or workflow.\n' +
    'Same product but different workflows = NOT overlapping.\n' +
    'Same workflow on same product = overlapping even if titles differ.\n\n' +
    'Return a JSON array with one object per demo:\n' +
    '[\n' +
    '  {\n' +
    '    "row": <row number>,\n' +
    '    "quality_score": <1-100, relative to this group>,\n' +
    '    "quality_note": "<1 sentence: what makes this demo strong or weak relative to others in the group>",\n' +
    '    "overlaps_with": [<row numbers of overlapping demos, empty if unique>],\n' +
    '    "overlap_score": <0-100, 0=unique, 50+=significant, 80+=near-duplicate>,\n' +
    '    "overlap_note": "<1 sentence: what overlaps, or why this is unique>",\n' +
    '    "note": "<1-2 sentences: actionable recommendation — what to improve, consolidate, or keep as-is>"\n' +
    '  }\n' +
    ']\n\n' +
    'Rules:\n' +
    '- Every demo must appear exactly once in the output.\n' +
    '- Quality scores must use the full range relative to this group.\n' +
    '- Notes must be specific — name the product, workflow, or gap. No generic praise.\n' +
    '- If only 1 demo in the group, give it quality_score 75, overlap_score 0.\n\n' +
    'Demos:\n\n' + demoList;
}

/* =========================
   MAIN ANALYSIS FUNCTION
========================= */

function analyzeContent() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var cols = ensureAnalysisColumns_(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
    Logger.log('No data rows.');
    return;
  }

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var allData = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, 1, dataRows, sheet.getLastColumn()).getValues();
  var existingOverlaps = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, cols.overlapScoreCol, dataRows, 1).getValues();
  var existingScores = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, cols.qualityScoreCol, dataRows, 1).getValues();

  var tdpGroups = {};

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var status = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS) || '').trim();

    if (status !== ENHANCED_CONFIG.STATUS.IE_PUBLISHED && status !== ENHANCED_CONFIG.STATUS.IE_REVIEWED) continue;

    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();
    var desc = getDescriptionByCol_(row, ANALYSIS_SOURCE_COLUMNS.DESCRIPTION_BN);
    if (!title && !desc) continue;

    var tdp = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.TDP) || '').trim() || 'Unassigned';
    var product = getProduct_(row, headerMap);
    var rowIndex = i + ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;

    var demo = {
      row: rowIndex,
      title: title,
      product: product,
      tdp: tdp,
      description: desc || title,
      dataIndex: i
    };

    if (!tdpGroups[tdp]) tdpGroups[tdp] = [];
    tdpGroups[tdp].push(demo);
  }

  var tdpKeys = Object.keys(tdpGroups);
  Logger.log('Found ' + tdpKeys.length + ' TDP groups.');

  for (var g = 0; g < tdpKeys.length; g++) {
    var tdp = tdpKeys[g];
    var group = tdpGroups[tdp];

    var allDone = group.every(function(d) {
      return String(existingOverlaps[d.dataIndex][0] || '').trim() !== '' &&
             String(existingScores[d.dataIndex][0] || '').trim() !== '';
    });
    if (allDone) {
      Logger.log('TDP "' + tdp + '": all rows done, skipping.');
      continue;
    }

    Logger.log('TDP "' + tdp + '": analyzing ' + group.length + ' demos...');

    try {
      var prompt = buildAnalysisPrompt_(group, tdp);
      var results = callGemini(prompt);
      if (!Array.isArray(results)) results = [results];

      for (var r = 0; r < results.length; r++) {
        var item = results[r];
        var targetRow = item.row;

        var overlapsWithText = '';
        var overlapRows = item.overlaps_with || [];
        if (overlapRows.length > 0) {
          overlapsWithText = overlapRows.map(function(oRow) {
            var match = group.filter(function(d) { return d.row === oRow; })[0];
            return match ? match.title : ('Row ' + oRow);
          }).join('; ');
        }

        sheet.getRange(targetRow, cols.rowCol).setValue(targetRow);
        sheet.getRange(targetRow, cols.qualityScoreCol).setValue(item.quality_score || 0);
        sheet.getRange(targetRow, cols.qualityNoteCol).setValue(item.quality_note || '');
        sheet.getRange(targetRow, cols.overlapScoreCol).setValue(item.overlap_score || 0);
        sheet.getRange(targetRow, cols.overlapsWithCol).setValue(overlapsWithText);
        sheet.getRange(targetRow, cols.overlapNoteCol).setValue(item.overlap_note || '');
        sheet.getRange(targetRow, cols.noteCol).setValue(item.note || '');
      }

      Logger.log('TDP "' + tdp + '": done (' + group.length + ' demos).');
    } catch (e) {
      logError('analyzeContent', e, { tdp: tdp });
      Logger.log('TDP "' + tdp + '": ERROR - ' + e.message);
    }
  }

  Logger.log('Analysis complete.');
}

/* =========================
   UTILITIES
========================= */

function clearAnalysisResults_(phase) {
  var sheet = getMasterSheet();
  var cols = ensureAnalysisColumns_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return;

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;

  if (!phase || phase === 'overlap') {
    sheet.getRange(startRow, cols.overlapScoreCol, dataRows, 1).clearContent();
    sheet.getRange(startRow, cols.overlapsWithCol, dataRows, 1).clearContent();
    sheet.getRange(startRow, cols.overlapNoteCol, dataRows, 1).clearContent();
    Logger.log('Cleared overlap columns.');
  }
  if (!phase || phase === 'quality') {
    sheet.getRange(startRow, cols.qualityScoreCol, dataRows, 1).clearContent();
    sheet.getRange(startRow, cols.qualityNoteCol, dataRows, 1).clearContent();
    Logger.log('Cleared quality columns.');
  }
  if (!phase || phase === 'row') {
    sheet.getRange(startRow, cols.rowCol, dataRows, 1).clearContent();
    Logger.log('Cleared row column.');
  }
  if (!phase || phase === 'note') {
    sheet.getRange(startRow, cols.noteCol, dataRows, 1).clearContent();
    Logger.log('Cleared note column.');
  }
}

function clearOverlapResults() { clearAnalysisResults_('overlap'); }
function clearQualityResults() { clearAnalysisResults_('quality'); }
function clearAllAnalysisResults() { clearAnalysisResults_(); }

/* =========================
   DATA EXPORT FOR CLAUDE CODE
========================= */

function exportForClaudeAnalysis() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
    Logger.log('No data rows.');
    return;
  }

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var allData = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, 1, dataRows, sheet.getLastColumn()).getValues();

  var tdpGroups = {};

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var status = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS) || '').trim();

    if (status !== ENHANCED_CONFIG.STATUS.IE_PUBLISHED && status !== ENHANCED_CONFIG.STATUS.IE_REVIEWED) continue;

    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();
    var desc = getDescriptionByCol_(row, ANALYSIS_SOURCE_COLUMNS.DESCRIPTION_BN);
    if (!title && !desc) continue;

    var tdp = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.TDP) || '').trim() || 'Unassigned';
    var product = getProduct_(row, headerMap);
    var rowIndex = i + ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;

    if (!tdpGroups[tdp]) tdpGroups[tdp] = [];
    tdpGroups[tdp].push({
      row: rowIndex,
      title: title,
      product: product,
      description: desc || title
    });
  }

  var exportSheet = sheet.getParent().getSheetByName('Claude Export');
  if (exportSheet) {
    exportSheet.clear();
  } else {
    exportSheet = sheet.getParent().insertSheet('Claude Export');
  }

  exportSheet.getRange(1, 1).setValue('TDP');
  exportSheet.getRange(1, 2).setValue('Demo Count');
  exportSheet.getRange(1, 3).setValue('JSON Data');

  var CELL_LIMIT = 45000;
  var tdpKeys = Object.keys(tdpGroups);
  var totalDemos = 0;
  var exportRow = 2;

  for (var g = 0; g < tdpKeys.length; g++) {
    var tdp = tdpKeys[g];
    var group = tdpGroups[tdp];
    totalDemos += group.length;

    var fullJson = JSON.stringify(group);
    if (fullJson.length <= CELL_LIMIT) {
      exportSheet.getRange(exportRow, 1).setValue(tdp);
      exportSheet.getRange(exportRow, 2).setValue(group.length);
      exportSheet.getRange(exportRow, 3).setValue(fullJson);
      exportRow++;
    } else {
      var chunkSize = Math.ceil(group.length / Math.ceil(fullJson.length / CELL_LIMIT));
      var part = 1;
      for (var c = 0; c < group.length; c += chunkSize) {
        var chunk = group.slice(c, c + chunkSize);
        exportSheet.getRange(exportRow, 1).setValue(tdp + ' (part ' + part + ')');
        exportSheet.getRange(exportRow, 2).setValue(chunk.length);
        exportSheet.getRange(exportRow, 3).setValue(JSON.stringify(chunk));
        exportRow++;
        part++;
      }
    }
  }

  Logger.log('Exported ' + totalDemos + ' demos in ' + tdpKeys.length + ' TDP groups to "Claude Export" tab (' + (exportRow - 2) + ' rows).');
  return tdpGroups;
}

var CLAUDE_COLUMNS = {
  ROW: 'Row (Claude)',
  QUALITY_SCORE: 'Quality Score (Claude)',
  QUALITY_NOTE: 'Quality Note (Claude)',
  OVERLAP_SCORE: 'Overlap Score (Claude)',
  OVERLAPS_WITH: 'Overlaps With (Claude)',
  OVERLAP_NOTE: 'Overlap Note (Claude)',
  NOTE: 'Note (Claude)'
};

function ensureClaudeColumns_(sheet) {
  var needed = [
    CLAUDE_COLUMNS.ROW,
    CLAUDE_COLUMNS.QUALITY_SCORE,
    CLAUDE_COLUMNS.QUALITY_NOTE,
    CLAUDE_COLUMNS.OVERLAP_SCORE,
    CLAUDE_COLUMNS.OVERLAPS_WITH,
    CLAUDE_COLUMNS.OVERLAP_NOTE,
    CLAUDE_COLUMNS.NOTE
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
    rowCol: headers.indexOf(CLAUDE_COLUMNS.ROW) + 1,
    qualityScoreCol: headers.indexOf(CLAUDE_COLUMNS.QUALITY_SCORE) + 1,
    qualityNoteCol: headers.indexOf(CLAUDE_COLUMNS.QUALITY_NOTE) + 1,
    overlapScoreCol: headers.indexOf(CLAUDE_COLUMNS.OVERLAP_SCORE) + 1,
    overlapsWithCol: headers.indexOf(CLAUDE_COLUMNS.OVERLAPS_WITH) + 1,
    overlapNoteCol: headers.indexOf(CLAUDE_COLUMNS.OVERLAP_NOTE) + 1,
    noteCol: headers.indexOf(CLAUDE_COLUMNS.NOTE) + 1
  };
}

function writeClaudeResults(resultsJson) {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var cols = ensureClaudeColumns_(sheet);
  var results = JSON.parse(resultsJson);

  var lastRow = sheet.getLastRow();
  var titleCol = headerMap[ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE];
  var allTitles = lastRow > ENHANCED_CONFIG.SHEETS.HEADER_ROW
    ? sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, titleCol + 1, lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW, 1).getValues()
    : [];

  function getTitleForRow(rowNum) {
    var idx = rowNum - ENHANCED_CONFIG.SHEETS.HEADER_ROW - 1;
    return (idx >= 0 && idx < allTitles.length) ? String(allTitles[idx][0] || '').trim() : '';
  }

  for (var i = 0; i < results.length; i++) {
    var item = results[i];

    var overlapsWithText = '';
    if (item.overlaps_with && item.overlaps_with.length > 0) {
      overlapsWithText = item.overlaps_with.map(function(oRow) {
        var title = getTitleForRow(oRow);
        return title || ('Row ' + oRow);
      }).join('; ');
    }

    sheet.getRange(item.row, cols.rowCol).setValue(item.row);
    sheet.getRange(item.row, cols.qualityScoreCol).setValue(item.quality_score || 0);
    sheet.getRange(item.row, cols.qualityNoteCol).setValue(item.quality_note || '');
    sheet.getRange(item.row, cols.overlapScoreCol).setValue(item.overlap_score || 0);
    sheet.getRange(item.row, cols.overlapsWithCol).setValue(overlapsWithText);
    sheet.getRange(item.row, cols.overlapNoteCol).setValue(item.overlap_note || '');
    sheet.getRange(item.row, cols.noteCol).setValue(item.note || '');
  }

  Logger.log('Wrote ' + results.length + ' results.');
}

function applyClaudeResults() {
  var results = [
    {"row":2,"quality_score":62,"quality_note":"Comprehensive overview but lacks a specific hands-on workflow — mostly conceptual benefits and ecosystem highlights","overlaps_with":[262,271],"overlap_score":55,"overlap_note":"All three (rows 2, 262, 271) are high-level OpenShift Virtualization overviews covering benefits and use cases","note":"Consider consolidating with rows 262 and 271 into a single definitive overview demo, or differentiate by making this one hands-on."},
    {"row":7,"quality_score":68,"quality_note":"Clear backup/restore workflow with specific steps, but product field lists 'Ansible Automation Platform' instead of OpenShift Virtualization","overlaps_with":[72],"overlap_score":65,"overlap_note":"Both rows 7 and 72 demonstrate Trilio backup and restore for OpenShift Virtualization VMs","note":"Consolidate with row 72 or differentiate — row 7 is on ROSA, row 72 is general. Fix the product classification to OpenShift Virtualization."},
    {"row":8,"quality_score":12,"quality_note":"Title 'Cps' is uninformative and appears to be a placeholder; description is adequate but the title severely undermines discoverability","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique GitOps-based VM creation workflow","note":"Rename title immediately — 'Cps' tells users nothing. Suggest: 'GitOps-Based VM Deployment on OpenShift with ArgoCD'."},
    {"row":33,"quality_score":92,"quality_note":"Excellent specificity — names exact products (RHACM, ODF), describes complete DR workflow from policy review to data verification on failover","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique regional disaster recovery workflow for VMs","note":"Keep as-is — strongest demo in this TDP group. Clear workflow, specific product names, and verifiable outcome."},
    {"row":49,"quality_score":78,"quality_note":"Specific zero-downtime migration use case with Service Interconnect; highlights cover the full failover workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Service Interconnect migration demo — no other demo covers mTLS traffic failover between environments","note":"Keep as-is. Product field appears truncated — fix to 'OpenShift Virtualization'."},
    {"row":68,"quality_score":84,"quality_note":"Strong workflow covering end-to-end automated migration with Ansible, specific about network/storage mapping and verification","overlaps_with":[104],"overlap_score":75,"overlap_note":"Both rows 68 and 104 automate VMware-to-OpenShift migration at scale using Ansible Automation Platform","note":"Near-duplicate of row 104 — consolidate into one demo. Row 68 has more descriptive title; row 104 has more verification detail."},
    {"row":69,"quality_score":80,"quality_note":"Specific ACM-based VM management with Grafana dashboards; covers inspection, lifecycle ops, and monitoring","overlaps_with":[102],"overlap_score":60,"overlap_note":"Both rows 69 and 102 cover managing and monitoring VMs on OpenShift — row 69 uses ACM, row 102 is standalone","note":"Differentiate clearly: rename row 69 to emphasize multi-cluster ACM management vs row 102 single-cluster focus, or consolidate."},
    {"row":71,"quality_score":72,"quality_note":"Clear and focused cloning workflow, but simple — only 5 highlights covering a straightforward operation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique VM cloning workflow","note":"Consider expanding highlights to show use cases like cloning for dev/test environments or scaling."},
    {"row":72,"quality_score":70,"quality_note":"Good Trilio data protection workflow but highlights are somewhat generic ('Monitoring the status', 'Reviewing the process')","overlaps_with":[7],"overlap_score":65,"overlap_note":"Both rows 7 and 72 demonstrate Trilio backup and restore for OpenShift Virtualization VMs","note":"Consolidate with row 7 or clearly differentiate — both cover the same Trilio capability with similar steps."},
    {"row":73,"quality_score":74,"quality_note":"Covers basic VMware-to-OpenShift migration but has identical title to row 74, creating confusion","overlaps_with":[74,86],"overlap_score":85,"overlap_note":"Rows 73 and 74 have the same title and nearly identical workflows; row 86 is the warm migration variant","note":"Remove one of rows 73/74 — they are near-duplicates. Keep whichever has better visual content, or merge the best highlights."},
    {"row":74,"quality_score":79,"quality_note":"More detailed than row 73 with 7 highlights including pipeline monitoring and verification; covers ROSA-specific path","overlaps_with":[73,86],"overlap_score":85,"overlap_note":"Near-duplicate of row 73 with same title; row 86 covers warm migration variant","note":"Consolidate with row 73. Row 74 is the stronger version — more highlights and includes verification step."},
    {"row":86,"quality_score":82,"quality_note":"Differentiates itself with warm migration methodology — specific about data transfer and cutover phases","overlaps_with":[73,74],"overlap_score":55,"overlap_note":"Covers VMware-to-OpenShift migration like rows 73/74 but focuses specifically on warm migration with incremental data transfer","note":"Keep as-is — warm migration angle is a valid differentiator. Ensure title clearly signals warm vs cold migration."},
    {"row":92,"quality_score":76,"quality_note":"Niche but well-described disconnected environment workflow; specific about Sneakernet and air-gap steps","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique disconnected/air-gapped HCP deployment demo","note":"Keep as-is — addresses a specific deployment scenario not covered elsewhere. Consider shortening the title."},
    {"row":102,"quality_score":67,"quality_note":"Generic title 'Manage and monitor VMs' lacks product and scope; content is solid but indistinguishable from row 69","overlaps_with":[69],"overlap_score":60,"overlap_note":"Both rows 69 and 102 cover VM management and monitoring on OpenShift with Grafana dashboards","note":"Rename to differentiate from row 69 — e.g. 'Single-Cluster VM Management and Grafana Monitoring on OpenShift Virtualization'."},
    {"row":103,"quality_score":28,"quality_note":"Very thin content — only 4 vague highlights, mostly conceptual, no hands-on workflow","overlaps_with":[105],"overlap_score":70,"overlap_note":"Both rows 103 and 105 are titled 'Uplift and Shift with ROSA' covering the same migration concept","note":"Remove or substantially rework — row 105 is the hands-on version. This demo reads more like a slide deck than an interactive walkthrough."},
    {"row":104,"quality_score":81,"quality_note":"Strong automated migration workflow with specific Ansible job template execution and OpenShift verification","overlaps_with":[68],"overlap_score":75,"overlap_note":"Near-duplicate of row 68 — both automate VMware-to-OpenShift migration using Ansible Automation Platform","note":"Consolidate with row 68. Both cover the same workflow; pick the one with better visuals and merge unique highlights."},
    {"row":105,"quality_score":73,"quality_note":"More detailed than row 103 with 7 highlights covering networking, security, and service mesh — but title is identical","overlaps_with":[103],"overlap_score":70,"overlap_note":"Same topic as row 103 (Uplift and Shift with ROSA) but with significantly more hands-on content","note":"If keeping only one, keep row 105. Consider renaming to something more specific like 'VM Networking and Security on ROSA'."},
    {"row":129,"quality_score":69,"quality_note":"Detailed Google Cloud deployment steps but very long title and niche scope (OSD on GCP with bare metal)","overlaps_with":[261],"overlap_score":60,"overlap_note":"Both rows 129 and 261 cover deploying OpenShift Virtualization on Google Cloud (OpenShift Dedicated)","note":"Consolidate with row 261, which covers a broader lifecycle vs row 129 setup-only focus."},
    {"row":132,"quality_score":83,"quality_note":"Unique cost management topic with specific workflow — CSV export, cluster views, custom cost models with markups","overlaps_with":[],"overlap_score":0,"overlap_note":"Only demo covering cost management and financial operations for OpenShift Virtualization","note":"Keep as-is — fills a unique FinOps gap. Strong, specific workflow."},
    {"row":135,"quality_score":77,"quality_note":"Specific migration feature (pre/post hooks) with clear workflow from ESXi to OpenShift including verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique demo covering migration hooks for VM reconfiguration during migration","note":"Keep as-is — addresses a specific advanced migration capability not covered elsewhere."},
    {"row":146,"quality_score":42,"quality_note":"Very thin content — only 4 brief highlights, no description of what Lightspeed actually reveals or how it helps","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AI-powered VM insights demo, but too thin to be useful","note":"Expand significantly — add highlights showing what insights Lightspeed provides and what actions it recommends."},
    {"row":148,"quality_score":75,"quality_note":"Good partner demo showing live migration with Portworx storage, includes Grafana monitoring and CLI operations","overlaps_with":[155],"overlap_score":30,"overlap_note":"Both are Portworx partner demos but different workflows: row 148 covers live migration, row 155 covers async DR","note":"Keep both — different enough in scope. Both serve distinct use cases."},
    {"row":155,"quality_score":77,"quality_note":"Specific async DR workflow with clear failover/failback steps and route modifications","overlaps_with":[148],"overlap_score":30,"overlap_note":"Both are Portworx partner demos but different workflows: live migration vs async DR","note":"Keep as-is — complements row 148 with disaster recovery focus."},
    {"row":160,"quality_score":75,"quality_note":"Clear OpenStack maintenance workflow using Watcher audit templates with specific strategy selection","overlaps_with":[178],"overlap_score":55,"overlap_note":"Both rows 160 and 178 use Watcher audits on OpenStack — different goals (maintenance vs consolidation)","note":"Keep both but clearly differentiate titles — row 160 is maintenance-driven, row 178 is resource optimization."},
    {"row":178,"quality_score":73,"quality_note":"Similar Watcher workflow to row 160 but for node consolidation; highlights follow the same pattern","overlaps_with":[160],"overlap_score":55,"overlap_note":"Both use Watcher audit templates on OpenStack but for different optimization goals","note":"Consider combining with row 160 into a Watcher for OpenStack series, or ensure titles clearly signal different use cases."},
    {"row":199,"quality_score":60,"quality_note":"Setup-only demo — covers operator installation and basic VM creation but lacks depth or advanced workflows","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique ROSA-specific virtualization setup demo","note":"Expand beyond initial setup — add highlights showing day-2 operations or integration with ROSA-specific features."},
    {"row":210,"quality_score":55,"quality_note":"Title has typo ('HatOpenShift'), and some highlights are vague ('Quick create', 'Top Consumers tab')","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique ARO-specific VM deployment demo","note":"Fix title typo ('HatOpenShift' to 'Hat OpenShift'). Add more specific highlights beyond basic deployment."},
    {"row":216,"quality_score":52,"quality_note":"UI navigation tour rather than a goal-oriented workflow — covers many features at surface level without depth","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique virtualization menu exploration demo","note":"Consider repositioning as a Getting Started demo, or focus on 2-3 specific features with deeper coverage."},
    {"row":231,"quality_score":68,"quality_note":"Clear focused workflow but very simple — only 5 highlights for a single operation (migrate VM between nodes)","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique focused live migration demo","note":"Consider expanding to cover migration policies, monitoring during migration, or multiple VM scenarios."},
    {"row":236,"quality_score":58,"quality_note":"RHEL Web Console VM creation — simple workflow, but belongs more in Server/Cloud OS than Virtualization TDP","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHEL Web Console VM management — different platform from the OpenShift focus of this TDP","note":"Consider moving to Server/Cloud Operating System TDP — this is RHEL-native virtualization, not OpenShift Virtualization."},
    {"row":249,"quality_score":80,"quality_note":"Specific migration assessment tool with clear workflow — OVA agent deployment, report review, architecture planning","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique migration planning/assessment demo","note":"Keep as-is — fills the pre-migration planning gap. Strong companion to the actual migration demos."},
    {"row":252,"quality_score":78,"quality_note":"Clear self-service provisioning workflow through Developer Hub with topology view — good developer experience focus","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique developer self-service VM provisioning demo in Virtualization TDP","note":"Keep as-is — good complement to platform-admin focused demos. Shows the developer perspective."},
    {"row":261,"quality_score":82,"quality_note":"Comprehensive lifecycle demo covering provisioning, operator install, storage, VM deployment, migration, and cloning on Google Cloud","overlaps_with":[129],"overlap_score":60,"overlap_note":"Both cover OCP Virt on Google Cloud but row 261 covers full lifecycle while row 129 is setup-only","note":"Keep row 261 as the primary Google Cloud demo — more comprehensive. Consolidate row 129 unique details into this one."},
    {"row":262,"quality_score":35,"quality_note":"Conceptual partner overview with no hands-on workflow — highlights are all discussion points, not interactive steps","overlaps_with":[2,271],"overlap_score":50,"overlap_note":"High-level OCP Virt overview like rows 2 and 271, focused on partner ecosystem","note":"Convert to a hands-on demo showing an actual partner integration, or retire if row 2 already covers the overview."},
    {"row":271,"quality_score":64,"quality_note":"Mix of conceptual and hands-on — includes cost analysis and console walkthrough but starts with marketing-style content","overlaps_with":[2,262],"overlap_score":50,"overlap_note":"Another high-level OCP Virt overview with some hands-on elements, focused on migration business case","note":"Strengthen by removing overview sections and focusing entirely on the hands-on cost comparison and console operations."},
    {"row":3,"quality_score":18,"quality_note":"Extremely thin — only 2 highlights (welcome screen and thank you message), no actual workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"Too thin to overlap with anything — essentially a placeholder demo","note":"Complete rewrite needed — this has no meaningful content. Replace with a real OpenShift overview covering key capabilities."},
    {"row":10,"quality_score":82,"quality_note":"Excellent specificity — names exact Kafka topics, shows full event streaming pipeline from simulation to recommendations","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique event streaming and real-time data processing demo","note":"Keep as-is — strong workflow demonstrating a realistic event streaming use case with AMQ Streams."},
    {"row":12,"quality_score":65,"quality_note":"Decent NetApp storage integration demo but narrow scope — mostly VM creation with specific storage class","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique NetApp ONTAP storage integration demo for ROSA","note":"Consider expanding to show storage operations beyond initial VM creation — snapshots, cloning, or data protection."},
    {"row":17,"quality_score":72,"quality_note":"Clear Developer Hub deployment workflow on Sandbox, but some steps are generic Helm chart operations","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Developer Hub deployment/setup demo","note":"Keep as a getting-started demo. Consider adding post-deployment configuration to show initial template creation."},
    {"row":27,"quality_score":70,"quality_note":"Good intro to Developer Hub self-service but stops at showing available templates — does not complete a provisioning workflow","overlaps_with":[28,29,30,31,35,80,89,90],"overlap_score":45,"overlap_note":"Part of a large cluster of Developer Hub self-service demos, each covering a different resource type","note":"This is the intro to the series — ensure it clearly links to the specific provisioning demos (rows 28-31, 35, 80, 89, 90)."},
    {"row":28,"quality_score":73,"quality_note":"Complete provisioning workflow for OpenShift projects with Developer Hub, includes ACS network graph review","overlaps_with":[29],"overlap_score":90,"overlap_note":"Rows 28 and 29 have identical title and cover the same OpenShift project provisioning workflow","note":"Near-duplicate of row 29 — remove one. Row 28 has slightly more detail (deployment summary, Argo CD status)."},
    {"row":29,"quality_score":68,"quality_note":"Same topic as row 28 but shorter with fewer highlights","overlaps_with":[28],"overlap_score":90,"overlap_note":"Near-duplicate of row 28 — identical title and workflow","note":"Remove in favor of row 28, which is more complete. Merge the ACS network graph detail from row 29 into row 28."},
    {"row":30,"quality_score":75,"quality_note":"Clear VM provisioning workflow via Developer Hub with VNC console access — good developer experience demo","overlaps_with":[89],"overlap_score":80,"overlap_note":"Both rows 30 and 89 cover self-service VM provisioning with Developer Hub using the same RHEL9 template","note":"Near-duplicate of row 89 — consolidate. Row 30 has VNC console access; row 89 has topology view."},
    {"row":31,"quality_score":76,"quality_note":"Good coverage of application capabilities (Jaeger, MongoDB Atlas) with specific template-based provisioning","overlaps_with":[80],"overlap_score":40,"overlap_note":"Both cover self-service app capabilities via Developer Hub but different targets (tracing/databases vs AI/ML workbench)","note":"Keep both — different enough in capabilities demonstrated. Clearly differentiate titles."},
    {"row":32,"quality_score":83,"quality_note":"Excellent developer journey through Connectivity Link — covers routing, auth, rate limiting with specific policy configs","overlaps_with":[34],"overlap_score":45,"overlap_note":"Both cover Connectivity Link but from different perspectives — developer (32) vs platform engineer (34)","note":"Keep both — good persona-based differentiation. Link them as companion demos."},
    {"row":34,"quality_score":85,"quality_note":"Strong platform engineering workflow — TLS, auth, rate limiting, DNS with specific AWS Route 53 integration","overlaps_with":[32],"overlap_score":45,"overlap_note":"Platform engineering perspective on Connectivity Link, complementing row 32 developer perspective","note":"Keep as-is — excellent platform engineering demo. Pair with row 32 for full picture."},
    {"row":35,"quality_score":79,"quality_note":"Complete ephemeral environment provisioning with ACM and HCP — includes cost optimization context","overlaps_with":[90],"overlap_score":75,"overlap_note":"Both rows 35 and 90 cover ephemeral environment provisioning via Developer Hub and ACM","note":"Near-duplicate of row 90 — consolidate. Row 35 has more detail about HCP and cost reduction."},
    {"row":47,"quality_score":71,"quality_note":"Clear Insights compliance workflow but somewhat passive — mostly viewing reports rather than taking action","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Red Hat Insights compliance reporting demo","note":"Expand to show the full remediation cycle — not just viewing reports but executing fixes and verifying results."},
    {"row":50,"quality_score":88,"quality_note":"Excellent Kaoto overview with comprehensive coverage — route creation, data mapping, deployment, and LLM tool integration","overlaps_with":[51,52,53,54,55],"overlap_score":35,"overlap_note":"Overview demo in the Kaoto series — each subsequent demo deep-dives one aspect","note":"Keep as the series overview. Ensure it clearly positions itself as Quick Overview and links to deep-dive demos."},
    {"row":51,"quality_score":64,"quality_note":"Simple extension installation demo — functional but minimal value as a standalone interactive demo","overlaps_with":[50],"overlap_score":25,"overlap_note":"Subset of the Kaoto overview — covers only the VS Code extension installation step","note":"Consider embedding this content into the overview demo rather than maintaining as a separate demo."},
    {"row":52,"quality_score":81,"quality_note":"Strong hands-on route creation with live testing — covers Timer, HTTP, Set Header, and response verification","overlaps_with":[50],"overlap_score":25,"overlap_note":"Deep-dive from the Kaoto series, focused on route creation","note":"Keep as-is — good standalone deep-dive. Clear progression from basic to HTTP-based route."},
    {"row":53,"quality_score":80,"quality_note":"Specific data mapper workflow with XML schema configuration and API testing — addresses real integration need","overlaps_with":[50],"overlap_score":25,"overlap_note":"Deep-dive from the Kaoto series, focused on data mapping","note":"Keep as-is — data mapping is a key differentiator for Camel integrations."},
    {"row":54,"quality_score":79,"quality_note":"Complete deployment workflow from prototype to Maven project on OpenShift — practical developer experience","overlaps_with":[50],"overlap_score":25,"overlap_note":"Deep-dive from the Kaoto series, focused on OpenShift deployment","note":"Keep as-is — covers the critical deployment step that makes Kaoto production-ready."},
    {"row":55,"quality_score":84,"quality_note":"Compelling AI integration use case — shows LLM hallucination problem and how Camel tools provide real-time data","overlaps_with":[50],"overlap_score":25,"overlap_note":"Deep-dive from the Kaoto series, focused on LLM tool integration","note":"Keep as-is — timely AI integration angle makes this one of the most compelling in the series."},
    {"row":70,"quality_score":74,"quality_note":"Detailed WIF and VPC setup but very infrastructure-focused — many steps are CLI/config rather than platform features","overlaps_with":[126,259],"overlap_score":50,"overlap_note":"All three (rows 70, 126, 259) cover deploying OpenShift Dedicated on Google Cloud","note":"Consolidate with rows 126 and 259 — three demos for the same deployment target is excessive."},
    {"row":76,"quality_score":78,"quality_note":"Good vulnerability management walkthrough with specific CVE examples and risk analysis","overlaps_with":[288],"overlap_score":65,"overlap_note":"Both rows 76 and 288 cover ACS vulnerability management with similar CVE review workflows","note":"Consolidate with row 288, which adds newer features like SBOM generation and deferral workflows."},
    {"row":77,"quality_score":73,"quality_note":"Good code signing workflow but some highlights are vague","overlaps_with":[87,280],"overlap_score":45,"overlap_note":"Part of the trusted pipeline cluster — rows 77, 87, 280 all cover code signing and verification","note":"Differentiate clearly from rows 87 and 280 — focus on the specific Cosign signing workflow as the unique angle."},
    {"row":80,"quality_score":71,"quality_note":"Good AI/ML workbench provisioning but the data scientist angle overlaps with OpenShift AI demos in AI Platform TDP","overlaps_with":[31],"overlap_score":40,"overlap_note":"Both cover self-service app capabilities via Developer Hub but for different personas","note":"Keep as the AI/ML-focused variant of Developer Hub self-service."},
    {"row":87,"quality_score":86,"quality_note":"Comprehensive trusted pipeline demo covering full lifecycle: onboarding, coding, CI/CD, security scanning, and promotion","overlaps_with":[77,280],"overlap_score":50,"overlap_note":"Most complete demo in the trusted pipeline cluster — covers more stages than rows 77 or 280","note":"Keep as the primary Trusted Application Pipeline demo. Commit verification feature is a strong differentiator."},
    {"row":89,"quality_score":72,"quality_note":"Clear VM self-service provisioning but nearly identical to row 30 in the same TDP group","overlaps_with":[30],"overlap_score":80,"overlap_note":"Near-duplicate of row 30 — both provision RHEL9 VMs via Developer Hub","note":"Remove in favor of row 30 or merge unique elements (topology view from row 89 into row 30)."},
    {"row":90,"quality_score":70,"quality_note":"Ephemeral environment provisioning but description appears truncated mid-sentence","overlaps_with":[35],"overlap_score":75,"overlap_note":"Near-duplicate of row 35 — both cover ephemeral environments via Developer Hub and ACM","note":"Remove in favor of row 35, which has more complete content. Row 90 description is truncated."},
    {"row":107,"quality_score":72,"quality_note":"Decent multi-environment application deployment demo covering edge, on-prem, and cloud resilience","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multi-environment application resilience demo spanning edge to cloud","note":"Keep as-is — good cross-environment story."},
    {"row":114,"quality_score":74,"quality_note":"Good compliance management workflow with multiple standards (CIS, HIPAA, NIST, PCI) and scheduled scans","overlaps_with":[247],"overlap_score":60,"overlap_note":"Both rows 114 and 247 cover ACS compliance management with standards review and scan scheduling","note":"Consolidate with row 247, which adds newer features like email delivery and fine-grained reporting."},
    {"row":118,"quality_score":75,"quality_note":"Specific AWS Bedrock + ROSA integration with practical NLP use case (insurance email analysis)","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Amazon Bedrock + ROSA integration demo","note":"Keep as-is — good cloud-specific AI integration demo."},
    {"row":122,"quality_score":22,"quality_note":"Extremely thin — only 3 vague highlights about introducing and presenting concepts, no workflow","overlaps_with":[270],"overlap_score":60,"overlap_note":"Both rows 122 and 270 are thin overviews of software supply chain security on OpenShift","note":"Remove or completely rework — this has no interactive content. Row 87 already covers the topic hands-on."},
    {"row":124,"quality_score":77,"quality_note":"Good ROSA HCP deployment workflow with monitoring and developer perspective; covers full lifecycle","overlaps_with":[205],"overlap_score":75,"overlap_note":"Both rows 124 and 205 cover deploying ROSA with hosted control planes — similar setup and monitoring","note":"Consolidate with row 205 — very similar content. Row 124 has slightly more detail."},
    {"row":125,"quality_score":73,"quality_note":"Clear update workflow covering both CLI and UI paths, with email notifications — addresses operational need","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique ROSA update and maintenance demo","note":"Keep as-is — operational maintenance demos fill an important gap."},
    {"row":126,"quality_score":69,"quality_note":"GCP Marketplace deployment with WIF setup, but overlaps significantly with rows 70 and 259","overlaps_with":[70,259],"overlap_score":55,"overlap_note":"One of three demos covering OpenShift Dedicated deployment on Google Cloud","note":"Consolidate with rows 70 and 259."},
    {"row":133,"quality_score":76,"quality_note":"Good edge AI/ML deployment workflow covering bootable image creation and MicroShift cluster verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique MicroShift edge AI deployment demo","note":"Keep as-is — addresses growing edge AI demand."},
    {"row":137,"quality_score":87,"quality_note":"Comprehensive Lightspeed demo covering chat, YAML management, troubleshooting, BYOK, and cluster interaction","overlaps_with":[],"overlap_score":0,"overlap_note":"Most comprehensive OpenShift Lightspeed demo in the portfolio","note":"Keep as-is — flagship Lightspeed demo."},
    {"row":141,"quality_score":78,"quality_note":"Thorough OCI deployment with Terraform stacks, Discovery ISO, and Hybrid Cloud Console integration","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Oracle Cloud Infrastructure deployment demo","note":"Keep as-is — fills the OCI gap in cloud provider coverage."},
    {"row":149,"quality_score":81,"quality_note":"Specific confidential containers workflow with Trustee operator, peer pods, and kata-remote runtime class","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique confidential containers demo for ARO","note":"Keep as-is — strong security-focused demo addressing confidential computing on Azure."},
    {"row":157,"quality_score":83,"quality_note":"Excellent end-to-end AI model lifecycle demo connecting OpenShift AI, Developer Hub, and Lightspeed","overlaps_with":[123],"overlap_score":50,"overlap_note":"Both rows 157 and 123 cover AI model discovery and application creation via Developer Hub and OpenShift AI","note":"Differentiate: row 157 emphasizes model catalog and Lightspeed chat; row 123 focuses on model registry sync."},
    {"row":166,"quality_score":80,"quality_note":"Strong digital sovereignty demo covering RHACM, RHACS compliance, and Trusted Artifact Signer","overlaps_with":[171],"overlap_score":85,"overlap_note":"Rows 166 and 171 have the same title and nearly identical workflows","note":"Near-duplicate of row 171 — consolidate immediately. Merge row 171 runtime policy enforcement into row 166."},
    {"row":167,"quality_score":77,"quality_note":"Clear Service Mesh 3 installation workflow with specific namespace setup, CRDs, and sample deployment","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique OpenShift Service Mesh 3 getting-started demo","note":"Keep as-is — fills the Service Mesh 3 installation gap."},
    {"row":171,"quality_score":79,"quality_note":"Same digital sovereignty topic as row 166 but adds runtime policy enforcement for unauthorized package managers","overlaps_with":[166],"overlap_score":85,"overlap_note":"Near-duplicate of row 166 — same title, same core workflow","note":"Consolidate with row 166. Merge the runtime policy enforcement step into the combined demo."},
    {"row":177,"quality_score":72,"quality_note":"Good orchestrator plugin demo showing workflow approval process, but limited to a single use case","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Developer Hub Orchestrator plugin demo","note":"Keep as-is — demonstrates a unique plugin capability."},
    {"row":184,"quality_score":74,"quality_note":"Clear device enrollment workflow with specific steps from QR scan to management approval","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Edge Manager device enrollment demo","note":"Keep as part of the Edge Manager demo series."},
    {"row":193,"quality_score":38,"quality_note":"Conceptual overview only — 3 highlights that describe architecture concepts without any hands-on workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"ARO HCP overview — too thin to meaningfully overlap","note":"Convert to a hands-on demo or retire. As-is, it provides no interactive value."},
    {"row":195,"quality_score":76,"quality_note":"Good breadth covering Quarkus deployment, DevSpaces, image security, operators, Service Mesh, and VMs","overlaps_with":[268],"overlap_score":55,"overlap_note":"Both rows 195 and 268 cover secure application building/delivery on OpenShift","note":"Differentiate: row 195 focuses on build-time security; row 268 on delivery-time security."},
    {"row":202,"quality_score":77,"quality_note":"Detailed fleet template creation with firewall rules, workloads, and device selector labels","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Edge Manager fleet template demo","note":"Keep as-is — essential for understanding Edge Manager fleet management."},
    {"row":203,"quality_score":75,"quality_note":"Good observability demo showing dashboard migration from Grafana to integrated Perses-powered console","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multicluster observability dashboard customization demo","note":"Keep as-is — addresses a real migration need from standalone Grafana."},
    {"row":205,"quality_score":74,"quality_note":"Clear ROSA HCP deployment but highly similar to row 124 with slightly less detail","overlaps_with":[124],"overlap_score":75,"overlap_note":"Near-duplicate of row 124 — both deploy ROSA with hosted control planes","note":"Consolidate with row 124. Row 124 has more detail."},
    {"row":206,"quality_score":76,"quality_note":"Clear single container deployment to edge device with status monitoring and verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Edge Manager single container deployment demo","note":"Keep as part of the Edge Manager series."},
    {"row":207,"quality_score":71,"quality_note":"Simple but useful terminal access demo — shows both browser-based and CLI remote access methods","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Edge Manager terminal access demo","note":"Keep as a quick-reference demo."},
    {"row":208,"quality_score":73,"quality_note":"Good self-assessment workflow covering 7 dimensions of digital sovereignty with actionable results","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique digital sovereignty readiness assessment demo","note":"Keep as-is — fills a unique pre-sales assessment gap."},
    {"row":209,"quality_score":40,"quality_note":"Conceptual edge portfolio overview — no hands-on workflow, mostly architecture diagrams and positioning","overlaps_with":[],"overlap_score":0,"overlap_note":"High-level edge overview — too conceptual to overlap with hands-on edge demos","note":"Convert to a hands-on demo or retire. Edge demos (rows 184, 202, 206, 207, 225, 286) already provide hands-on coverage."},
    {"row":223,"quality_score":85,"quality_note":"Comprehensive DevSpaces demo covering operator setup, CDE config, AI coding assistant, security analysis, and devfiles","overlaps_with":[],"overlap_score":0,"overlap_note":"Most complete DevSpaces install and configure demo","note":"Keep as-is — flagship DevSpaces demo."},
    {"row":225,"quality_score":70,"quality_note":"Straightforward Edge Manager installation on RHEL — functional but simple CLI-focused workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Edge Manager installation demo","note":"Keep as the Edge Manager getting-started entry point."},
    {"row":229,"quality_score":76,"quality_note":"Good validated pattern deployment covering GitOps, Vault, AAP integration, and ACM cluster provisioning","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Lab-as-a-Service validated pattern demo","note":"Keep as-is."},
    {"row":230,"quality_score":79,"quality_note":"Clear AI/ML workload scaling demo showing pod cohesion, all-or-nothing restart, and scaling operations","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique LeaderWorkerSet operator demo","note":"Keep as-is — addresses distributed ML inference on OpenShift."},
    {"row":235,"quality_score":78,"quality_note":"Good multi-cloud AI orchestration showing ARO + ROSA with Granite model MaaS and MCP server tools","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multi-cloud AI orchestration demo","note":"Keep as-is — compelling cross-cloud AI deployment story."},
    {"row":245,"quality_score":66,"quality_note":"Simple toggle-based enablement workflow — functional but minimal depth","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique OpenStack observability dashboard enablement demo","note":"Expand to show what the dashboards reveal, not just how to enable them."},
    {"row":246,"quality_score":80,"quality_note":"Comprehensive validated pattern demo covering repo structure, multi-cloud deployment, and post-deploy verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Omnicloud-as-a-Service validated pattern demo","note":"Keep as-is — strong multi-cloud story."},
    {"row":247,"quality_score":78,"quality_note":"Good compliance workflow with scheduled scans, multiple standards, email delivery, and fine-grained filtering","overlaps_with":[114],"overlap_score":60,"overlap_note":"Both rows 114 and 247 cover ACS compliance — row 247 adds scheduling and email delivery","note":"Consolidate with row 114. Row 247 has newer features — use as the primary compliance demo."},
    {"row":254,"quality_score":84,"quality_note":"Excellent breadth covering API management, template-based dev, pipeline security, AI coding, and SBOM analysis","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Advanced Developer Suite overview","note":"Keep as-is — strong portfolio demo showing multiple tool integration."},
    {"row":256,"quality_score":79,"quality_note":"Clear Kueue batch job management with practical resource limit demonstration and adjustment workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Kueue batch job scheduling demo","note":"Keep as-is — fills gap for batch/AI workload scheduling."},
    {"row":258,"quality_score":77,"quality_note":"Comprehensive sovereign AI configuration covering deployment models, GPU options, and compliance frameworks","overlaps_with":[272,273,274],"overlap_score":40,"overlap_note":"Part of the sovereign AI cluster but focuses on configuration/packaging","note":"Keep as the configuration-focused sovereign AI demo."},
    {"row":259,"quality_score":67,"quality_note":"GCP Console discovery and deployment flow — simpler than rows 70 and 126","overlaps_with":[70,126],"overlap_score":55,"overlap_note":"Third demo covering OSD deployment on Google Cloud","note":"Consolidate with rows 70 and 126."},
    {"row":260,"quality_score":76,"quality_note":"Complete ROSA lifecycle from prerequisites to cluster management — good breadth","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique comprehensive ROSA overview","note":"Keep as-is — good all-in-one ROSA reference demo."},
    {"row":266,"quality_score":81,"quality_note":"Practical security workflow comparing vulnerable vs hardened images with specific CVE reduction metrics","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Podman Desktop container scanning and hardening demo","note":"Keep as-is — compelling before/after security story."},
    {"row":267,"quality_score":77,"quality_note":"Specific Azure managed identity integration with OpenShift AI — practical security and AI workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Azure managed identity + OpenShift AI integration demo","note":"Keep as-is — fills the Azure-specific AI security gap."},
    {"row":268,"quality_score":79,"quality_note":"Good delivery workflow covering pipeline security, canary deployments, GitOps, and mixed workloads","overlaps_with":[195],"overlap_score":55,"overlap_note":"Both rows 195 and 268 cover secure app delivery — different focus areas","note":"Keep both — they complement each other. Row 195 build-time; row 268 delivery-time."},
    {"row":269,"quality_score":78,"quality_note":"Strong multi-cluster management demo covering ACM, GitOps, ACS, and cross-cluster search","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multi-cluster application management demo","note":"Keep as-is."},
    {"row":270,"quality_score":20,"quality_note":"Extremely thin — only 2 vague highlights about presenting a question and highlighting an offering","overlaps_with":[122],"overlap_score":60,"overlap_note":"Both rows 122 and 270 are empty overviews of supply chain security","note":"Remove — no interactive content. Row 87 already provides a comprehensive hands-on trusted pipeline demo."},
    {"row":272,"quality_score":71,"quality_note":"Good sovereign AI cloud overview with Netris networking — shows dashboard, topology, and VPC management","overlaps_with":[273],"overlap_score":65,"overlap_note":"Rows 272 and 273 both cover sovereign AI with Netris — row 272 higher-level, row 273 deep dive","note":"Consolidate with row 273 or clearly position as overview vs deep dive companion pieces."},
    {"row":273,"quality_score":75,"quality_note":"Deeper Netris integration details including BGP, NAT rules, and cluster provisioning workflows","overlaps_with":[272],"overlap_score":65,"overlap_note":"Deep dive companion to row 272 overview — both cover sovereign AI with Netris","note":"Keep as the deep-dive version if maintaining two-level approach."},
    {"row":274,"quality_score":78,"quality_note":"Good self-service portal demo covering developer pods, VMs, and OpenShift clusters with Rafay","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique sovereign AI self-service portal demo with Rafay","note":"Keep as-is — different partner and different focus from the Netris demos."},
    {"row":278,"quality_score":68,"quality_note":"Simple Lightspeed troubleshooting demo — only 4 highlights, could be deeper","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique pipeline troubleshooting with Lightspeed demo","note":"Expand to show more of Lightspeed diagnostic reasoning and the actual fix being applied."},
    {"row":279,"quality_score":85,"quality_note":"Excellent provenance verification workflow — full chain from package discovery to SLSA attestation verification with cosign","overlaps_with":[280],"overlap_score":35,"overlap_note":"Both cover trusted software but row 279 focuses on libraries/packages while row 280 covers the full factory","note":"Keep as-is — unique library-level provenance verification."},
    {"row":280,"quality_score":82,"quality_note":"Strong end-to-end trusted software factory demo from Konflux to SLSA Level 3 compliance with SBOM review","overlaps_with":[87,279],"overlap_score":45,"overlap_note":"Part of the trusted pipeline cluster — differentiates with Konflux-based approach","note":"Keep as-is — Konflux approach differentiates from row 87 Developer Hub approach."},
    {"row":282,"quality_score":75,"quality_note":"Good unified platform demo showing VMs, containers, and AI on one cluster — breadth over depth","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique unified workload platform demo","note":"Keep as-is — strong platform consolidation story."},
    {"row":286,"quality_score":72,"quality_note":"Clear fleet membership workflow using device labels — both CLI and UI paths covered","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Edge Manager device-to-fleet assignment demo","note":"Keep as part of the Edge Manager series."},
    {"row":288,"quality_score":80,"quality_note":"Strong vulnerability management with modern features: SBOM generation, deferral workflows, EPSS scores","overlaps_with":[76],"overlap_score":65,"overlap_note":"Both rows 76 and 288 cover ACS vulnerability management — row 288 has more modern features","note":"Keep as the primary vulnerability management demo — consolidate row 76 into this."},
    {"row":292,"quality_score":80,"quality_note":"Specific Zero Trust demo with SPIFFE certificates, mTLS PostgreSQL connections, and clear pass/fail demonstration","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Zero Trust workload identity demo with PostgreSQL","note":"Keep as-is — strong security demo with concrete pass/fail verification."},
    {"row":4,"quality_score":15,"quality_note":"Extremely generic — description mentions 'a Red Hat solution' without specifics, no meaningful workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"Too vague to overlap with anything — essentially a placeholder","note":"Complete rewrite needed — this has no useful content."},
    {"row":14,"quality_score":82,"quality_note":"Clear Insights Image Builder workflow with specific steps from image creation to AWS deployment readiness","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHEL image building demo for cloud deployment","note":"Keep as-is — practical workflow for a common operational need."},
    {"row":48,"quality_score":80,"quality_note":"Good integration of OpenShift VMs with AAP dynamic inventory — specific about credential config and connectivity verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AAP dynamic inventory for OpenShift VMs demo","note":"Keep as-is — bridges virtualization and automation domains."},
    {"row":94,"quality_score":78,"quality_note":"Practical Windows Server update workflow with before/after verification — specific KB number targeting","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Windows Server update management demo","note":"Keep as-is — addresses real cross-platform automation need."},
    {"row":108,"quality_score":73,"quality_note":"OSD deployment on Google Cloud — duplicates content from Application Platform TDP demos","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique within this TDP but overlaps with App Platform demos about OSD on GCP","note":"Consider whether this belongs in Application Platform or Server/Cloud OS TDP."},
    {"row":111,"quality_score":83,"quality_note":"Excellent air-gapped Insights workflow — addresses real constraint with specific remediation steps","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique air-gapped Insights advisor demo for Satellite environments","note":"Keep as-is — addresses a critical use case for disconnected/regulated environments."},
    {"row":115,"quality_score":10,"quality_note":"Title-only content — the description literally repeats the title with no additional information","overlaps_with":[],"overlap_score":0,"overlap_note":"Too empty to overlap with anything","note":"Complete rewrite needed — add actual workflow description and highlights."},
    {"row":183,"quality_score":79,"quality_note":"Clear security update workflow covering identification, installation, and verification with CVE details","overlaps_with":[284],"overlap_score":55,"overlap_note":"Both rows 183 and 284 cover RHEL software updates via web console — security vs general","note":"Consolidate or clearly differentiate: row 183 = security-specific, row 284 = general updates."},
    {"row":197,"quality_score":85,"quality_note":"Excellent AI assistant demo covering system admin, scripting, and troubleshooting with concrete examples","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHEL Command Line Assistant demo","note":"Keep as-is — strong AI-assisted admin demo."},
    {"row":211,"quality_score":81,"quality_note":"Good security integration — Crowdstrike + RHEL Insights with specific Yara signature import and scan process","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique third-party threat intelligence integration demo","note":"Keep as-is — demonstrates valuable partner security integration."},
    {"row":214,"quality_score":80,"quality_note":"Good performance troubleshooting workflow using PCP historical events — specific about event types and drill-down","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique historical system performance analysis demo","note":"Keep as-is — fills the performance troubleshooting gap."},
    {"row":248,"quality_score":68,"quality_note":"Multi-cloud OpenShift overview — covers ROSA, ARO, and on-prem but stays at overview level for each","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multi-cloud OpenShift overview","note":"Consider whether this adds value given the dedicated demos for each cloud provider."},
    {"row":284,"quality_score":75,"quality_note":"Clear general software update workflow with reboot and verification — practical but simple","overlaps_with":[183],"overlap_score":55,"overlap_note":"Both rows 183 and 284 cover RHEL web console updates — general vs security","note":"Consolidate with row 183 or keep both as complementary demos."},
    {"row":285,"quality_score":88,"quality_note":"Excellent image mode demo showing upgrade, verification, and rollback — clear before/after with practical testing","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHEL image mode update and rollback demo","note":"Keep as-is — strongest demo in this TDP. Upgrade + rollback workflow is compelling."},
    {"row":5,"quality_score":62,"quality_note":"Clear trial activation workflow but very basic — most highlights are installation steps rather than AI capability","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Ansible Lightspeed trial activation demo","note":"Expand to show more AI-generated content examples after activation."},
    {"row":6,"quality_score":90,"quality_note":"Exceptional end-to-end workflow from bare metal setup through model training to edge deployment","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique computer vision edge deployment demo covering full pipeline","note":"Keep as-is — flagship edge AI demo."},
    {"row":9,"quality_score":85,"quality_note":"Strong InstructLab workflow showing hallucination problem, knowledge addition, synthetic data generation, and improved responses","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique InstructLab model customization demo","note":"Keep as-is — compelling before/after demonstration."},
    {"row":88,"quality_score":86,"quality_note":"Comprehensive AI app lifecycle from template creation through MLOps pipeline with Kubeflow","overlaps_with":[123],"overlap_score":40,"overlap_note":"Both cover AI app creation but row 88 focuses on MLOps pipeline while row 123 focuses on model registry","note":"Keep both — different pipeline stages."},
    {"row":91,"quality_score":78,"quality_note":"Clear model serving self-service workflow with specific deployment verification and inference endpoints","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique self-service model serving demo via Developer Hub","note":"Keep as-is."},
    {"row":120,"quality_score":80,"quality_note":"Good multimodal demo comparing two vision models with webcam and file inputs — interactive and engaging","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multimodal chatbot demo with vision model comparison","note":"Keep as-is — model comparison and webcam interaction make this highly engaging."},
    {"row":121,"quality_score":79,"quality_note":"Good conceptual-to-practical progression from LLM basics to MCP server management in OpenShift AI","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique MCP server management demo for agentic AI on OpenShift","note":"Keep as-is — timely agentic AI topic."},
    {"row":123,"quality_score":84,"quality_note":"Excellent model lifecycle demo connecting OpenShift AI model catalog, registry, Developer Hub sync, and chatbot deployment","overlaps_with":[157],"overlap_score":50,"overlap_note":"Both rows 123 and 157 connect OpenShift AI and Developer Hub — row 123 emphasizes model registry sync","note":"Keep both — row 123 is stronger on model registration and sync workflow."},
    {"row":127,"quality_score":74,"quality_note":"Good AI-assisted development demo but the DevSpaces context is secondary to the AI code generation focus","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique agentic development environment demo","note":"Keep as-is — novel angle combining DevSpaces with AI agents."},
    {"row":134,"quality_score":76,"quality_note":"Useful model catalog with performance filtering but description is thin","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AI Hub model catalog with performance-based filtering","note":"Expand highlights to show how performance insights lead to actual deployment decisions."},
    {"row":136,"quality_score":77,"quality_note":"Clear compression benchmark showing latency, throughput, and resource savings — good technical depth","overlaps_with":[194],"overlap_score":45,"overlap_note":"Both cover inference benchmarking — row 136 focuses on compression, row 194 on deployment","note":"Keep both — different optimization angles."},
    {"row":138,"quality_score":83,"quality_note":"Strong customization workflow showing generic-to-specific model improvement with RAG and InstructLab fine-tuning","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique model customization demo combining RAG and InstructLab","note":"Keep as-is — excellent progression from generic to customized responses."},
    {"row":142,"quality_score":72,"quality_note":"Good AI-powered observability with GPU monitoring, but features need more depth","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AI observability summarizer demo","note":"Keep as-is — expand Chat with Prometheus interaction to show more complex queries."},
    {"row":143,"quality_score":25,"quality_note":"Extremely thin — only 3 highlights showing static latency statistics, no interactive workflow","overlaps_with":[217],"overlap_score":80,"overlap_note":"Rows 143 and 217 have nearly identical thin content","note":"Remove — this is a placeholder with no interactive content."},
    {"row":150,"quality_score":52,"quality_note":"Overview of AI security/safety concepts — informative but no hands-on workflow","overlaps_with":[153],"overlap_score":85,"overlap_note":"Near-duplicate of row 153 — both cover the same AI security and safety overview","note":"Remove one — rows 150 and 153 are essentially identical."},
    {"row":151,"quality_score":80,"quality_note":"Strong RAG workflow covering LLM inference, vector database, and Kubeflow pipeline for data ingestion","overlaps_with":[196],"overlap_score":55,"overlap_note":"Both demonstrate RAG chatbots — row 151 focuses on pipeline, row 196 on user experience","note":"Keep both — they complement each other."},
    {"row":152,"quality_score":75,"quality_note":"Good edge AI lifecycle demo covering model serving, pipeline setup, and automated retraining with validation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique edge AI lifecycle automation demo","note":"Keep as-is — automated retraining loop is key differentiator."},
    {"row":153,"quality_score":50,"quality_note":"Same AI security/safety overview as row 150 — purely educational with no interactive elements","overlaps_with":[150],"overlap_score":85,"overlap_note":"Near-duplicate of row 150","note":"Consolidate with row 150."},
    {"row":165,"quality_score":35,"quality_note":"Very thin what's-new overview with only 5 vague highlights and no hands-on content","overlaps_with":[],"overlap_score":0,"overlap_note":"Release overview — too thin","note":"Flesh out with hands-on demos of new features or retire — version overviews age quickly."},
    {"row":168,"quality_score":70,"quality_note":"Good Ask Red Hat service demo but more of a user experience walkthrough than a technical demo","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Ask Red Hat AI assistant demo","note":"Keep as-is — architecture overview adds technical depth."},
    {"row":174,"quality_score":78,"quality_note":"Strong Kagenti demo covering agent deployment, MCP tools, and fine-grained Keycloak access control","overlaps_with":[212],"overlap_score":40,"overlap_note":"Both cover AI agent operationalization — row 174 focuses on access control, row 212 on full lifecycle","note":"Keep both — row 174 is access control focused; row 212 covers broader lifecycle."},
    {"row":176,"quality_score":55,"quality_note":"Interesting drone/edge AI concept but the 4 highlights are vague bullets without showing actual steps","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique drone-based edge AI demo concept","note":"Expand with specific interactive steps — current highlights read like an agenda."},
    {"row":185,"quality_score":81,"quality_note":"Good multi-agent AI demo with realistic mortgage lending workflow covering multiple personas","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multi-agent AI workflow demo with financial services use case","note":"Keep as-is — strong enterprise AI use case."},
    {"row":192,"quality_score":76,"quality_note":"Good AI inference scaling demo covering platform setup, model management, autoscaling, and API keys","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AI inference autoscaling demo","note":"Keep as-is."},
    {"row":194,"quality_score":79,"quality_note":"Strong inference benchmarking demo covering deployment, Podman runtime, and performance dashboard comparison","overlaps_with":[136],"overlap_score":45,"overlap_note":"Both cover inference benchmarking — different optimization strategies","note":"Keep both."},
    {"row":196,"quality_score":74,"quality_note":"Good enterprise RAG demo showing data collection switching and system prompt customization","overlaps_with":[151],"overlap_score":55,"overlap_note":"Both demonstrate RAG chatbots — row 196 user-facing, row 151 pipeline-focused","note":"Keep as-is — enterprise flexibility angle."},
    {"row":201,"quality_score":77,"quality_note":"Clear AutoRAG experiment workflow with S3 connection, document selection, and ranked results evaluation","overlaps_with":[265],"overlap_score":35,"overlap_note":"Both cover automated ML experiments — row 201 AutoRAG, row 265 AutoML","note":"Keep both — fundamentally different domains."},
    {"row":212,"quality_score":82,"quality_note":"Comprehensive AgentOps lifecycle covering deployment, registration, monitoring, tracing, content safety, and zero-trust","overlaps_with":[174],"overlap_score":40,"overlap_note":"Both cover AI agent operationalization — row 212 broader lifecycle, row 174 access control","note":"Keep as-is — most comprehensive agent lifecycle demo."},
    {"row":215,"quality_score":58,"quality_note":"Thin demo with only 5 highlights, and the description is unclear about what ITS-Hub does","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique inference-time scaling demo","note":"Expand description to explain value proposition more clearly."},
    {"row":217,"quality_score":22,"quality_note":"Nearly identical to row 143 — just static latency statistics with no interactive workflow","overlaps_with":[143],"overlap_score":80,"overlap_note":"Near-duplicate of row 143 — same thin content","note":"Remove — placeholder with no interactive content."},
    {"row":218,"quality_score":72,"quality_note":"Good GenAI Studio playground demo but limited depth — mostly navigation and configuration setup","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique GenAI Studio playground demo","note":"Expand to show actual model interaction results."},
    {"row":220,"quality_score":80,"quality_note":"Strong GPU-as-a-Service demo covering booking, quota management, and model deployment with MIG partitioning","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique GPU resource booking and allocation demo","note":"Keep as-is — addresses a critical GPU sharing challenge."},
    {"row":221,"quality_score":79,"quality_note":"Good AI security evaluation workflow using EvalHub and Garak vulnerability scanning with MLflow integration","overlaps_with":[264],"overlap_score":40,"overlap_note":"Both cover AI evaluation — row 221 security, row 264 general benchmarking","note":"Keep both — different evaluation dimensions."},
    {"row":222,"quality_score":68,"quality_note":"Decent vLLM operational demo but only 4 highlights covering basic deployment and monitoring","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique hands-on vLLM deployment demo","note":"Expand highlights to show more operational workflows."},
    {"row":226,"quality_score":83,"quality_note":"Comprehensive inference demo covering GPU setup, model download, quantization, evaluation, and llm-d scheduling","overlaps_with":[],"overlap_score":0,"overlap_note":"Most comprehensive Red Hat AI inference demo","note":"Keep as-is — full stack from hardware to intelligent routing is excellent."},
    {"row":227,"quality_score":71,"quality_note":"Clear speculative decoding overview with benchmark comparisons and getting-started commands","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique speculative decoding demo","note":"Keep as-is — niche but valuable optimization technique."},
    {"row":228,"quality_score":60,"quality_note":"Description appears truncated mid-sentence; content about llm-d is interesting but incomplete","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique llm-d distributed inference framework demo","note":"Fix the truncated description. Ensure demo shows full routing and scaling workflow."},
    {"row":237,"quality_score":55,"quality_note":"Thin MCP server demo — only 4 vague highlights without specifics","overlaps_with":[238],"overlap_score":45,"overlap_note":"Both cover MCP servers for Red Hat — row 237 for Lightspeed, row 238 for RHEL","note":"Expand — too thin. Add specific examples of MCP server interactions."},
    {"row":238,"quality_score":20,"quality_note":"Single highlight (Viewing the introductory slide) — essentially a placeholder with no content","overlaps_with":[237],"overlap_score":45,"overlap_note":"Both cover MCP servers — row 238 is a developer preview placeholder","note":"Remove or develop into a real demo — single slide provides no interactive value."},
    {"row":239,"quality_score":78,"quality_note":"Good MLflow observability demo showing trace inspection and AI agent decision-making analysis","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique MLflow agent observability and tracing demo","note":"Keep as-is — agent observability is critical for enterprise AI."},
    {"row":240,"quality_score":76,"quality_note":"Good model ingestion workflow covering pipeline deployment, benchmarking, and custom evaluation with Elyra","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique model ingestion and evaluation pipeline demo","note":"Keep as-is — fills the ModelOps gap."},
    {"row":241,"quality_score":79,"quality_note":"Comprehensive MaaS pattern showing coding assistant, image generation, chatbot, API management, and metrics","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Models-as-a-Service organizational pattern demo","note":"Keep as-is — strong enterprise AI delivery pattern."},
    {"row":243,"quality_score":67,"quality_note":"SDG Hub exploration is informative but only 4 highlights covering Jupyter browsing — no actual data generation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique synthetic data generation hub demo","note":"Expand to show actual synthetic data generation, not just browsing available flows."},
    {"row":250,"quality_score":78,"quality_note":"Compelling real-time PPE safety demo with video analysis, trend summaries, and clear architecture diagram","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique real-time computer vision safety monitoring demo","note":"Keep as-is — strong industry-specific AI use case."},
    {"row":263,"quality_score":79,"quality_note":"Good modernization workflow covering AI-assisted analysis, Cloud Foundry discovery, and OpenShift asset generation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Migration Toolkit for Applications with AI assistance demo","note":"Keep as-is — addresses app modernization with AI-powered tooling."},
    {"row":264,"quality_score":75,"quality_note":"Clear evaluation workflow with adversarial and fairness benchmarks, plus trace-level result inspection","overlaps_with":[221],"overlap_score":40,"overlap_note":"Both cover AI evaluation — different dimensions complement each other","note":"Keep both."},
    {"row":265,"quality_score":77,"quality_note":"Good AutoML workflow with algorithm selection, experiment execution, and performance metrics review","overlaps_with":[201],"overlap_score":35,"overlap_note":"Both cover automated ML experiments but different domains","note":"Keep both — fundamentally different approaches."},
    {"row":277,"quality_score":73,"quality_note":"Good agentic AI customer data transformation with Slack and PDF outputs, but title has typo","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AI agent data transformation demo","note":"Fix title typo ('Cusotmer' to 'Customer')."},
    {"row":289,"quality_score":81,"quality_note":"Excellent guardrails demo showing multiple detection types with Grafana monitoring","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AI guardrails and content moderation demo","note":"Keep as-is — variety of guardrail types and Grafana dashboard are compelling."},
    {"row":290,"quality_score":66,"quality_note":"Decent workbench demo but mostly shows Jupyter browsing rather than hands-on workflows","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique LLM Compressor and GuideLLM workbench demo","note":"Expand to show actual compression and benchmarking execution."},
    {"row":13,"quality_score":78,"quality_note":"Comprehensive Azure managed app deployment covering marketplace, RHCC, network config, and subscription activation","overlaps_with":[181,219],"overlap_score":70,"overlap_note":"Rows 13, 181, and 219 all cover AAP on Azure managed app setup","note":"Consolidate three Azure AAP demos into one. Row 13 is most detailed."},
    {"row":20,"quality_score":80,"quality_note":"Good S/4 HANA deployment workflow showing job execution, log review, and software package verification","overlaps_with":[23],"overlap_score":65,"overlap_note":"Both rows 20 and 23 cover SAP S/4HANA deployment with AAP — execution vs configuration","note":"Keep both as a paired series, or consolidate into one end-to-end demo."},
    {"row":23,"quality_score":78,"quality_note":"Good configuration walkthrough for SAP deployment — covers project, inventory, host groups, and workflow visualizer","overlaps_with":[20],"overlap_score":65,"overlap_note":"Configuration companion to row 20 execution demo","note":"Pair with row 20 or consolidate."},
    {"row":46,"quality_score":82,"quality_note":"Excellent Developer Hub onboarding workflow covering template selection, code editing, CI/CD, and deployment verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Developer Hub onboarding demo","note":"Keep as-is — strong developer productivity story."},
    {"row":57,"quality_score":75,"quality_note":"Good Camel + LLM integration demo showing hallucination correction with real-time data — but product is listed as AAP","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Camel integration for LLM real-time data demo","note":"Fix product classification — this is about Apache Camel, not Ansible Automation Platform."},
    {"row":79,"quality_score":76,"quality_note":"Good network reporting workflow but very similar to row 244","overlaps_with":[244],"overlap_score":85,"overlap_note":"Rows 79 and 244 show the identical network automation report workflow","note":"Near-duplicate of row 244 — remove one."},
    {"row":93,"quality_score":84,"quality_note":"Excellent AIOps workflow connecting Insights, Lightspeed, and AAP for end-to-end vulnerability remediation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Insights + Lightspeed + AAP integrated remediation demo","note":"Keep as-is — strongest Red Hat product integration for security remediation."},
    {"row":95,"quality_score":82,"quality_note":"Comprehensive Windows AD deployment with vault credentials, survey-driven config, and user/group creation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Windows Active Directory deployment automation demo","note":"Keep as-is — strong cross-platform automation demo."},
    {"row":96,"quality_score":83,"quality_note":"Strong EDA demo covering event streams, webhook config, rulebook activation, and rule audit verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Event-Driven Ansible with Event Streams demo","note":"Keep as-is — comprehensive EDA workflow."},
    {"row":97,"quality_score":81,"quality_note":"Good multi-level policy enforcement showing organization, inventory, and template-level policy evaluation","overlaps_with":[242],"overlap_score":60,"overlap_note":"Both cover AAP policy enforcement with OPA — row 97 multi-level, row 242 persona-based","note":"Consolidate or clearly differentiate."},
    {"row":99,"quality_score":45,"quality_note":"Mostly conceptual overview — highlights are about exploring and reviewing rather than hands-on steps","overlaps_with":[257],"overlap_score":80,"overlap_note":"Near-duplicate of row 257 — both conceptual overviews of automating RHEL with AAP","note":"Consolidate with row 257 or convert one to a hands-on demo."},
    {"row":100,"quality_score":42,"quality_note":"Conceptual virtual infrastructure overview — all highlights describe concepts, not interactive steps","overlaps_with":[287],"overlap_score":80,"overlap_note":"Near-duplicate of row 287 — both conceptual overviews of VM automation","note":"Consolidate with row 287. Convert to a hands-on demo."},
    {"row":101,"quality_score":77,"quality_note":"Good EDA + OpenShift integration showing namespace event triggering resource quota and certificate automation","overlaps_with":[213],"overlap_score":75,"overlap_note":"Both cover Event-Driven Ansible with OpenShift — similar triggers and outcomes","note":"Consolidate with row 213. Row 101 has more detail about outcomes."},
    {"row":106,"quality_score":79,"quality_note":"Detailed mesh configuration from RHEL registration through instance group assignment and topology verification","overlaps_with":[140],"overlap_score":90,"overlap_note":"Near-duplicate of row 140 — identical automation mesh configuration workflow","note":"Remove one immediately — rows 106 and 140 are essentially the same demo."},
    {"row":109,"quality_score":77,"quality_note":"Good getting-started workflow from marketplace to first login, covering AWS account linking","overlaps_with":[179],"overlap_score":70,"overlap_note":"Both cover getting started with AAP on AWS — similar marketplace and provisioning","note":"Consolidate with row 179."},
    {"row":113,"quality_score":58,"quality_note":"Conceptual automation maturity overview — informative but no hands-on workflow","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique automation maturity assessment — conceptual","note":"Convert to an interactive assessment with actual AAP examples, or position as educational content."},
    {"row":117,"quality_score":74,"quality_note":"Clear app lifecycle management workflow with survey-driven target and app selection","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHEL application lifecycle management demo","note":"Keep as-is — practical day-2 operations demo."},
    {"row":130,"quality_score":15,"quality_note":"Completely generic — no specifics about AI governance, just placeholder text","overlaps_with":[],"overlap_score":0,"overlap_note":"Too vague to overlap — essentially a placeholder","note":"Complete rewrite needed — add specific AI governance workflows."},
    {"row":140,"quality_score":78,"quality_note":"Same automation mesh configuration as row 106 — detailed but redundant","overlaps_with":[106],"overlap_score":90,"overlap_note":"Near-duplicate of row 106 — identical workflow","note":"Remove in favor of row 106 or vice versa."},
    {"row":154,"quality_score":60,"quality_note":"AIOps workflow overview but abbreviated — 4 highlights that describe concepts rather than interactive steps","overlaps_with":[162,169,188],"overlap_score":70,"overlap_note":"Part of a large AIOps cluster all showing self-healing workflows","note":"Consolidate the AIOps cluster — four demos covering the same pattern is excessive."},
    {"row":162,"quality_score":72,"quality_note":"AWS-specific AIOps with DevOps Guru and Lightspeed — more specific than the generic versions","overlaps_with":[154,169,188],"overlap_score":70,"overlap_note":"AWS-specific variant of the AIOps self-healing workflow","note":"If keeping one AIOps demo per cloud, keep this as AWS version. Otherwise consolidate."},
    {"row":164,"quality_score":80,"quality_note":"Good security automation workflow with complete cycle: scan, report, remediate, re-scan verification","overlaps_with":[255],"overlap_score":70,"overlap_note":"Both cover OpenSCAP security automation with AAP — similar cycle","note":"Consolidate with row 255. The scan-remediate-verify pattern is identical."},
    {"row":169,"quality_score":68,"quality_note":"Generic AIOps overview with multiple AI services listed but no deep dive into any specific workflow","overlaps_with":[154,162,188],"overlap_score":70,"overlap_note":"Generic AIOps self-healing overview — same pattern as cloud-specific versions","note":"Remove in favor of cloud-specific versions."},
    {"row":173,"quality_score":81,"quality_note":"Strong ServiceNow + AAP integration with LEAP workspace, MCP server connection, and incident remediation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique ServiceNow LEAP + AAP MCP server integration demo","note":"Keep as-is — timely MCP server integration with a major ITSM platform."},
    {"row":179,"quality_score":75,"quality_note":"Good AWS onboarding covering marketplace acceptance through first workflow execution","overlaps_with":[109],"overlap_score":70,"overlap_note":"Both cover AAP on AWS getting started","note":"Consolidate with row 109."},
    {"row":180,"quality_score":76,"quality_note":"Detailed dashboard installation covering prerequisites, OAuth config, and Podman activation","overlaps_with":[189],"overlap_score":40,"overlap_note":"Both cover Automation Dashboard — row 180 installation, row 189 usage","note":"Keep both as paired series or combine into one comprehensive demo."},
    {"row":181,"quality_score":65,"quality_note":"Azure managed app activation — less detailed than rows 13 and 219","overlaps_with":[13,219],"overlap_score":70,"overlap_note":"Third demo covering AAP on Azure managed app setup","note":"Remove in favor of row 13 or 219. Merge subscription activation detail into surviving demo."},
    {"row":182,"quality_score":77,"quality_note":"Good Ansible + Terraform integration showing create and destroy workflows with cross-platform verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Ansible + Terraform integration demo","note":"Keep as-is — addresses common hybrid infrastructure pattern."},
    {"row":186,"quality_score":75,"quality_note":"Clear multi-cloud reporting workflow but limited to viewing VM details — no remediation steps","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multi-cloud infrastructure reporting demo","note":"Consider expanding to show actions based on reports."},
    {"row":187,"quality_score":80,"quality_note":"Comprehensive Windows VM day-2 operations: stop/start, resource modification, and snapshot management","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Windows VM operations on OpenShift demo","note":"Keep as-is — addresses the Windows on OpenShift gap."},
    {"row":188,"quality_score":65,"quality_note":"Generic AIOps workflow overview — same pattern as rows 154, 162, 169","overlaps_with":[154,162,169],"overlap_score":70,"overlap_note":"Fourth variant of the AIOps self-healing workflow","note":"Remove — least differentiated of the four AIOps demos."},
    {"row":189,"quality_score":79,"quality_note":"Good dashboard usage demo covering cost calculator, custom reports, PDF export, and CSV data export","overlaps_with":[180],"overlap_score":40,"overlap_note":"Complements row 180 installation with actual dashboard usage","note":"Keep as-is — cost savings calculator is valuable for stakeholders."},
    {"row":190,"quality_score":70,"quality_note":"Simple Lightspeed assistant demo — clear but limited to 4 highlights","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AAP Lightspeed intelligent assistant demo","note":"Expand to show more complex automation tasks beyond documentation lookup."},
    {"row":191,"quality_score":73,"quality_note":"Good orchestrator concept showing vulnerability remediation workflow design with AI and human approval","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Automation Orchestrator workflow design demo","note":"Keep as-is — strong governance story."},
    {"row":200,"quality_score":72,"quality_note":"Clear session recording configuration and playback — simple but addresses a real audit/compliance need","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHEL terminal session recording demo","note":"Keep as-is. Consider whether it belongs in Server/Cloud OS TDP instead."},
    {"row":213,"quality_score":75,"quality_note":"Good EDA + OpenShift demo showing namespace creation triggering snapshot and quota jobs","overlaps_with":[101],"overlap_score":75,"overlap_note":"Both cover the same EDA + OpenShift integration pattern","note":"Consolidate with row 101."},
    {"row":219,"quality_score":76,"quality_note":"AAP on Azure setup — includes EULA acceptance and controller dashboard access","overlaps_with":[13,181],"overlap_score":70,"overlap_note":"Third Azure AAP managed app setup demo","note":"Consolidate with rows 13 and 181 into one comprehensive Azure AAP demo."},
    {"row":224,"quality_score":74,"quality_note":"Clear dev container setup for Ansible in VS Code — specific about Podman config and devcontainer.json","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Ansible Dev Container setup demo","note":"Keep as-is."},
    {"row":233,"quality_score":82,"quality_note":"Strong secrets management workflow showing Vault integration with credential lookup and job template execution","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique HashiCorp Vault secrets management integration demo","note":"Keep as-is — excellent security integration demo."},
    {"row":242,"quality_score":79,"quality_note":"Good multi-layered policy enforcement with specific persona-based demonstrations (appdev, neteng, netadmin)","overlaps_with":[97],"overlap_score":60,"overlap_note":"Both cover OPA policy enforcement — row 242 adds persona-based access","note":"Consolidate with row 97 or differentiate clearly."},
    {"row":244,"quality_score":75,"quality_note":"Same network reporting workflow as row 79","overlaps_with":[79],"overlap_score":85,"overlap_note":"Near-duplicate of row 79 — identical Network-Report job template","note":"Remove in favor of row 79 or vice versa."},
    {"row":251,"quality_score":77,"quality_note":"Good developer sandbox onboarding with credential retrieval and subscription activation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique AAP developer sandbox provisioning demo","note":"Keep as-is. Description appears truncated — fix."},
    {"row":255,"quality_score":78,"quality_note":"Good security automation cycle with OpenSCAP reporting, EDA-triggered enforcement, and verification","overlaps_with":[164],"overlap_score":70,"overlap_note":"Both cover OpenSCAP + AAP security automation","note":"Consolidate with row 164."},
    {"row":257,"quality_score":43,"quality_note":"Conceptual RHEL automation overview — highlights describe benefits without hands-on steps","overlaps_with":[99],"overlap_score":80,"overlap_note":"Near-duplicate of row 99 — both conceptual overviews","note":"Consolidate with row 99. Convert survivor to a hands-on demo."},
    {"row":275,"quality_score":82,"quality_note":"Strong Splunk ITSI + EDA workflow showing anomaly detection, correlation, remediation, and verification","overlaps_with":[276],"overlap_score":45,"overlap_note":"Both cover Splunk + AAP — row 275 AIOps/performance, row 276 threat management","note":"Keep both — different use cases."},
    {"row":276,"quality_score":80,"quality_note":"Good threat management workflow with brute force detection, EDA rulebook, and credential revocation","overlaps_with":[275],"overlap_score":45,"overlap_note":"Both cover Splunk + AAP but different focus areas","note":"Keep as-is — complements row 275 with security focus."},
    {"row":283,"quality_score":85,"quality_note":"Excellent AIOps workflow with Instana showing Smart Alerts, AI remediation with human approval, and MCP chatbot","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique IBM Instana + AAP AIOps integration demo","note":"Keep as-is — strongest AIOps partner integration demo."},
    {"row":287,"quality_score":40,"quality_note":"Conceptual VM automation overview — all highlights describe concepts, not interactive steps","overlaps_with":[100],"overlap_score":80,"overlap_note":"Near-duplicate of row 100 — both conceptual VM automation overviews","note":"Consolidate with row 100. Both need conversion to hands-on demos."},
    {"row":291,"quality_score":83,"quality_note":"Comprehensive zero trust workflow covering LDAP, RBAC, OPA, dynamic Vault credentials, and microsegmentation","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Zero Trust implementation demo for AAP","note":"Keep as-is — excellent security architecture demo."},
    {"row":75,"quality_score":82,"quality_note":"Comprehensive SNO deployment with Assisted Installer covering LVM, Discovery ISO, and iDRAC configuration","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique Single Node OpenShift deployment demo","note":"Keep as-is — strong edge deployment demo."},
    {"row":98,"quality_score":80,"quality_note":"Good Portworx 2-node arbiter demo showing VM deployment, data persistence, and cross-node migration","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique 2-node arbiter cluster with Portworx storage demo","note":"Keep as-is — important HA architecture."},
    {"row":112,"quality_score":75,"quality_note":"Good vulnerability management walkthrough but less detailed than row 145 on the same topic","overlaps_with":[145],"overlap_score":80,"overlap_note":"Both cover ACS vulnerability management with similar CVE review workflows","note":"Consolidate with row 145 — row 145 has more depth."},
    {"row":144,"quality_score":77,"quality_note":"Good compliance and security workflow covering dashboard review, standards compliance, and scan scheduling","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique ACS compliance demo in Container Management TDP","note":"Keep as-is."},
    {"row":145,"quality_score":80,"quality_note":"Detailed ACS vulnerability management with CVE drill-down, CVSS scores, risk indicators, and process discovery","overlaps_with":[112],"overlap_score":80,"overlap_note":"Near-duplicate of row 112 with more detail on risk indicators","note":"Keep row 145 as primary vulnerability management demo — retire row 112."},
    {"row":147,"quality_score":83,"quality_note":"Comprehensive RHACM 2.14 demo covering VM management, observability, RBAC, and right-sizing recommendations","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHACM new features demo","note":"Keep as-is. Note: version-specific content may age."},
    {"row":156,"quality_score":40,"quality_note":"Very thin what's-new overview with only 3 vague highlights — no hands-on content","overlaps_with":[],"overlap_score":0,"overlap_note":"Release overview — too thin","note":"Expand with hands-on feature demonstrations or retire."},
    {"row":161,"quality_score":78,"quality_note":"Good External Secrets Operator demo with Vault integration, ArgoCD sync, and private repo verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique External Secrets Operator GitOps security demo","note":"Keep as-is."},
    {"row":170,"quality_score":79,"quality_note":"Clear right-sizing workflow with cluster and VM-level CPU/memory recommendations and trends","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique RHACM right-sizing and resource optimization demo","note":"Keep as-is — fills FinOps gap."},
    {"row":172,"quality_score":78,"quality_note":"Specific SPIFFE-based PostgreSQL security with certificate inspection and pass/fail tests","overlaps_with":[292],"overlap_score":75,"overlap_note":"Both rows 172 and 292 demonstrate Zero Trust with SPIFFE and PostgreSQL mTLS","note":"Near-duplicate of row 292 in App Platform TDP — consolidate into one demo in one TDP."},
    {"row":198,"quality_score":86,"quality_note":"Excellent confidential containers demo covering Trustee, NVIDIA attestation, sealed secrets, and AI model interaction","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique confidential containers demo for AI workloads with GPU attestation","note":"Keep as-is — strongest security demo in this TDP."},
    {"row":204,"quality_score":77,"quality_note":"Good multi-cloud deployment demo using RHACM with specific cluster types and search verification","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique multi-cloud application deployment demo","note":"Keep as-is."},
    {"row":234,"quality_score":70,"quality_note":"Simple managed identity ARO deployment — clear but only 5 highlights","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique managed identity ARO cluster creation demo","note":"Consider expanding to show what managed identities enable beyond setup."},
    {"row":253,"quality_score":88,"quality_note":"Comprehensive ACS overview covering vulnerabilities, SBOM, compliance, risk, and policy management with ArgoCD","overlaps_with":[],"overlap_score":0,"overlap_note":"Most comprehensive ACS overview in the portfolio","note":"Keep as-is — flagship ACS demo."},
    {"row":281,"quality_score":65,"quality_note":"Interesting 2-node topology but only 4 conceptual highlights — no hands-on deployment","overlaps_with":[],"overlap_score":0,"overlap_note":"Unique 2-node OpenShift with arbiter architecture demo","note":"Expand to show actual deployment steps — currently reads more like a whitepaper."}
  ];

  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var cols = ensureClaudeColumns_(sheet);

  var lastRow = sheet.getLastRow();
  var titleCol = headerMap[ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE];
  var allTitles = lastRow > ENHANCED_CONFIG.SHEETS.HEADER_ROW
    ? sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, titleCol + 1, lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW, 1).getValues()
    : [];

  function getTitleForRow(rowNum) {
    var idx = rowNum - ENHANCED_CONFIG.SHEETS.HEADER_ROW - 1;
    return (idx >= 0 && idx < allTitles.length) ? String(allTitles[idx][0] || '').trim() : '';
  }

  for (var i = 0; i < results.length; i++) {
    var item = results[i];

    var overlapsWithText = '';
    if (item.overlaps_with && item.overlaps_with.length > 0) {
      overlapsWithText = item.overlaps_with.map(function(oRow) {
        var title = getTitleForRow(oRow);
        return title || ('Row ' + oRow);
      }).join('; ');
    }

    sheet.getRange(item.row, cols.rowCol).setValue(item.row);
    sheet.getRange(item.row, cols.qualityScoreCol).setValue(item.quality_score || 0);
    sheet.getRange(item.row, cols.qualityNoteCol).setValue(item.quality_note || '');
    sheet.getRange(item.row, cols.overlapScoreCol).setValue(item.overlap_score || 0);
    sheet.getRange(item.row, cols.overlapsWithCol).setValue(overlapsWithText);
    sheet.getRange(item.row, cols.overlapNoteCol).setValue(item.overlap_note || '');
    sheet.getRange(item.row, cols.noteCol).setValue(item.note || '');
  }

  Logger.log('Applied Claude analysis to ' + results.length + ' demos.');
}

function clearClaudeResults() {
  var sheet = getMasterSheet();
  var cols = ensureClaudeColumns_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return;

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;
  sheet.getRange(startRow, cols.rowCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.qualityScoreCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.qualityNoteCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.overlapScoreCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.overlapsWithCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.overlapNoteCol, dataRows, 1).clearContent();
  sheet.getRange(startRow, cols.noteCol, dataRows, 1).clearContent();
  Logger.log('Cleared Claude analysis columns.');
}
