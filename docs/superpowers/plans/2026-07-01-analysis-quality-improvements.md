# Content Analysis System Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three fundamental problems with the content analysis system: quality scores that can't be compared across TDP groups, overlap detection that misses cross-TDP duplicates, and a prompt that doesn't give the AI enough signal to score accurately.

**Architecture:** Replace the single combined prompt with two focused prompts — one for absolute quality scoring (per-row, fixed rubric) and one for overlap detection (all demos at once, not grouped by TDP). Add more input signals: SEO keywords, content type, and creation link. Consolidate the Gemini and Claude paths into one write function. Batch sheet writes to avoid hitting the 6-minute Apps Script limit.

**Tech Stack:** Google Apps Script, Gemini 2.5 Flash API (via existing `callGemini()`), Google Sheets API

## Global Constraints

- All changes in `RM_Analysis.js` (single-file scope within the multi-file Apps Script project)
- Use existing `callGemini()` in `RM_Gemini.js` — do not modify it
- Use existing `getTargetSpreadsheet_()` / `getMasterSheet()` for sheet access
- Apps Script 6-minute execution limit — functions must be re-runnable (skip already-processed rows)
- Deploy via `clasp push` from `/Users/rubyyang/Arcade Finder/`
- Column references use header names via `safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.X)` except col BN (66) which is hardcoded index
- Eligible rows: Status = "IE Published" or "IE Reviewed"
- ~243 demos currently, expect growth to ~400

## Current Problems

1. **Relative quality scores** — prompt says "rank relative to this group," so a 70 in Virtualization (35 demos) means something different than a 70 in AI Platform (60 demos). Can't sort the full sheet by score.

2. **TDP-only overlap detection** — demos are only compared within their TDP group. Cross-TDP duplicates (e.g., row 172 in Container Management and row 292 in Application Platform both cover SPIFFE + PostgreSQL mTLS) are invisible.

3. **Thin input signals** — prompt only sends title + product + description (capped at 300 chars). Missing: SEO keywords, content type, creation link, sales tactic — all of which help distinguish demos that sound similar but target different audiences.

4. **Dual write paths** — `analyzeContent()` (Gemini, automated) and `applyClaudeResults()` (hardcoded snapshot) write to different column sets with different formats. Confusing and hard to maintain.

5. **Per-cell sheet writes** — writing 7 cells × 243 rows = 1,701 individual `sheet.getRange().setValue()` calls. Slow, risks hitting the 6-minute limit.

---

### Task 1: Switch quality scoring to absolute rubric

**Files:**
- Modify: `RM_Analysis.js` — replace `buildAnalysisPrompt_()` with two separate prompt builders

**Interfaces:**
- Consumes: demo object `{ row, title, product, tdp, description, keywords, contentType }`
- Produces: `buildQualityPrompt_(demo)` — returns prompt string for a single demo, expects JSON response `{ quality_score, quality_note }`

- [ ] **Step 1: Write `buildQualityPrompt_()` with fixed rubric**

Add after the existing `buildAnalysisPrompt_()` function (which we'll keep temporarily for reference, then remove in Task 5):

```javascript
function buildQualityPrompt_(demo) {
  return 'Rate the content quality of this Red Hat interactive demo on a fixed 1-100 scale.\n\n' +
    'Title: ' + demo.title + '\n' +
    'Primary Product: ' + demo.product + '\n' +
    'Content Type: ' + demo.contentType + '\n' +
    'Technology Decision Point: ' + demo.tdp + '\n' +
    'SEO Keywords: ' + demo.keywords + '\n' +
    'Description + Tour Highlights:\n' + demo.description + '\n\n' +
    'Score using this fixed rubric (same scale for every demo regardless of group):\n\n' +
    'Title (20 points):\n' +
    '- Is it specific and descriptive? Does it name the product and use case?\n' +
    '- 18-20: Names product, action, and target (e.g., "Deploying AI Models with Red Hat OpenShift AI and Developer Hub")\n' +
    '- 12-17: Names product but vague action (e.g., "Red Hat OpenShift Overview")\n' +
    '- 0-11: Generic or placeholder (e.g., "Cps", "Product Overview")\n\n' +
    'Description (30 points):\n' +
    '- Does the opening clearly explain WHY this demo matters and WHAT it covers?\n' +
    '- 25-30: 2-3 sentences, value-first, no action verbs that belong in highlights\n' +
    '- 15-24: Adequate but vague, or lists actions that should be in highlights\n' +
    '- 0-14: Missing, placeholder, or just repeats the title\n\n' +
    'Tour Highlights (30 points):\n' +
    '- Are the bullet points specific? Do they name UI elements, tools, commands, metrics?\n' +
    '- 25-30: 4-6 specific bullets naming exact screens, tools, and outcomes\n' +
    '- 15-24: 3-5 bullets but some are vague ("Shows the dashboard")\n' +
    '- 0-14: Fewer than 3 bullets, or all vague/conceptual\n\n' +
    'Completeness (20 points):\n' +
    '- Does the demo cover a full workflow from start to finish?\n' +
    '- 16-20: Full workflow with clear start and end, product/TDP classification is correct\n' +
    '- 8-15: Partial workflow or missing verification/outcome step\n' +
    '- 0-7: Just a concept overview, no hands-on workflow\n\n' +
    'Return ONLY valid JSON:\n' +
    '{\n' +
    '  "quality_score": <1-100, sum of the four rubric dimensions>,\n' +
    '  "quality_note": "<1 sentence: the single biggest strength or weakness>"\n' +
    '}\n\n' +
    'Calibration anchors (use these to stay consistent across all demos):\n' +
    '- 90-100: Excellent — specific title, clear value-first description, detailed highlights with named UI elements, complete workflow\n' +
    '- 70-89: Good — minor gaps in one dimension (e.g., title could be more specific, or one vague highlight)\n' +
    '- 50-69: Mediocre — multiple gaps (vague title + thin highlights, or conceptual description without workflow)\n' +
    '- 25-49: Poor — placeholder title, missing description, or only 1-2 vague highlights\n' +
    '- 1-24: Broken — title-only, no meaningful content, or appears to be a placeholder';
}
```

- [ ] **Step 2: Push and verify syntax**

```bash
cd "/Users/rubyyang/Arcade Finder" && npx clasp push
```

Open Apps Script editor, confirm `buildQualityPrompt_` appears in the function list.

- [ ] **Step 3: Commit**

```bash
git add RM_Analysis.js
git commit -m "feat: add absolute quality rubric prompt (buildQualityPrompt_)"
```

---

### Task 2: Add cross-TDP overlap detection prompt

**Files:**
- Modify: `RM_Analysis.js` — add `buildOverlapBatchPrompt_()`

**Interfaces:**
- Consumes: array of all demo objects (not grouped by TDP)
- Produces: `buildOverlapBatchPrompt_(demos)` — returns prompt string, expects JSON array response `[{ row, overlaps_with, overlap_score, overlap_note }]`

The key design challenge: with ~243 demos, sending all of them in one prompt may exceed Gemini's context window. We batch by sending summaries (title + product + TDP only, no description) for the full roster, which keeps the prompt compact enough for a single call. For large catalogs (400+), we can chunk later.

- [ ] **Step 1: Write `buildOverlapBatchPrompt_()`**

Add after `buildQualityPrompt_()`:

```javascript
function buildOverlapBatchPrompt_(demos) {
  var demoList = demos.map(function(d) {
    return d.row + ' | ' + d.title + ' | ' + d.product + ' | ' + d.tdp +
      ' | ' + (d.keywords || '').slice(0, 80);
  }).join('\n');

  return 'You are reviewing ' + demos.length + ' interactive demos across ALL Technology Decision Points to find content overlap.\n\n' +
    'Each line: Row | Title | Product | TDP | Keywords\n\n' +
    demoList + '\n\n' +
    'Identify demos that cover substantially the same topic or workflow, even if they are in DIFFERENT TDPs.\n\n' +
    'Rules:\n' +
    '- Same product + same workflow = overlapping, even if titles or TDPs differ.\n' +
    '- Same product but different workflows (e.g., install vs. migrate) = NOT overlapping.\n' +
    '- A series of related demos (e.g., overview + 4 deep-dives) with overlap_score 20-35 is normal — only flag if they are redundant, not complementary.\n' +
    '- Score 0 = completely unique. 50+ = significant overlap worth reviewing. 80+ = near-duplicate.\n\n' +
    'Return a JSON array with ONE object per demo that has overlap_score > 0.\n' +
    'Do NOT include demos with score 0 — omit them entirely to keep the response small.\n\n' +
    '[\n' +
    '  {\n' +
    '    "row": <row number>,\n' +
    '    "overlaps_with": [<row numbers>],\n' +
    '    "overlap_score": <1-100>,\n' +
    '    "overlap_note": "<1 sentence: what overlaps — name the shared workflow or topic>"\n' +
    '  }\n' +
    ']\n\n' +
    'If no demos overlap at all, return an empty array [].';
}
```

- [ ] **Step 2: Push and verify syntax**

```bash
cd "/Users/rubyyang/Arcade Finder" && npx clasp push
```

- [ ] **Step 3: Commit**

```bash
git add RM_Analysis.js
git commit -m "feat: add cross-TDP overlap detection prompt (buildOverlapBatchPrompt_)"
```

---

### Task 3: Enrich demo data collection with more input signals

**Files:**
- Modify: `RM_Analysis.js` — update the demo object builder in `analyzeContent()` to include keywords, content type, and creation link

**Interfaces:**
- Consumes: `ENHANCED_CONFIG.COLUMNS.SEO_WORDS`, `ENHANCED_CONFIG.COLUMNS.FINAL_CONTENT_TYPE`, `ENHANCED_CONFIG.COLUMNS.CREATION_LINK`
- Produces: enriched demo object `{ row, title, product, tdp, description, keywords, contentType, creationLink, dataIndex }`

- [ ] **Step 1: Add `ANALYSIS_SOURCE_COLUMNS` entries for the new fields**

Replace the existing `ANALYSIS_SOURCE_COLUMNS` at the top of the file:

```javascript
var ANALYSIS_SOURCE_COLUMNS = {
  DESCRIPTION_BN: 66,
  PRIMARY_PRODUCT: 'Primary Product',
  SEO_WORDS: 'SEOWords',
  CONTENT_TYPE: 'Final Content Type',
  CREATION_LINK: 'Creation Link'
};
```

- [ ] **Step 2: Update the demo object builder in `collectEligibleDemos_()`**

Extract the demo collection logic into its own function so both `analyzeContent()` and the new functions can reuse it. Add after `getProduct_()`:

```javascript
function collectEligibleDemos_(sheet, headerMap) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) return [];

  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var allData = sheet.getRange(ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1, 1, dataRows, sheet.getLastColumn()).getValues();

  var demos = [];
  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];
    var status = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS) || '').trim();

    if (status !== ENHANCED_CONFIG.STATUS.IE_PUBLISHED && status !== ENHANCED_CONFIG.STATUS.IE_REVIEWED) continue;

    var title = String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim();
    var desc = getDescriptionByCol_(row, ANALYSIS_SOURCE_COLUMNS.DESCRIPTION_BN);
    if (!title && !desc) continue;

    demos.push({
      row: i + ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1,
      title: title,
      product: getProduct_(row, headerMap),
      tdp: String(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.TDP) || '').trim() || 'Unassigned',
      description: desc || title,
      keywords: String(safeGetByName(row, headerMap, ANALYSIS_SOURCE_COLUMNS.SEO_WORDS) || '').trim(),
      contentType: String(safeGetByName(row, headerMap, ANALYSIS_SOURCE_COLUMNS.CONTENT_TYPE) || '').trim(),
      creationLink: String(safeGetByName(row, headerMap, ANALYSIS_SOURCE_COLUMNS.CREATION_LINK) || '').trim(),
      dataIndex: i
    });
  }

  return demos;
}
```

- [ ] **Step 3: Push and verify**

```bash
cd "/Users/rubyyang/Arcade Finder" && npx clasp push
```

- [ ] **Step 4: Commit**

```bash
git add RM_Analysis.js
git commit -m "feat: extract collectEligibleDemos_ with enriched fields (keywords, contentType)"
```

---

### Task 4: Rewrite `analyzeContent()` with separated quality + overlap passes and batch writes

**Files:**
- Modify: `RM_Analysis.js` — replace the body of `analyzeContent()`

**Interfaces:**
- Consumes: `collectEligibleDemos_()`, `buildQualityPrompt_()`, `buildOverlapBatchPrompt_()`, `ensureAnalysisColumns_()`, `callGemini()`
- Produces: `analyzeContent()` — writes results to all 7 analysis columns using batch `setValues()` instead of per-cell writes

Two-phase approach:
1. **Quality pass**: one Gemini call per demo (absolute scoring). Skip rows that already have a quality score. ~243 calls but each is small and fast.
2. **Overlap pass**: one Gemini call for all demos (cross-TDP). Only runs if any overlap columns are empty. 1 call total.

Batch writes: collect all results in arrays, then write each column in a single `setValues()` call at the end.

- [ ] **Step 1: Write the new `analyzeContent()` function**

Replace the entire existing `analyzeContent()` function:

```javascript
function analyzeContent() {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var cols = ensureAnalysisColumns_(sheet);

  var demos = collectEligibleDemos_(sheet, headerMap);
  if (demos.length === 0) {
    Logger.log('No eligible demos found.');
    return;
  }

  var lastRow = sheet.getLastRow();
  var dataRows = lastRow - ENHANCED_CONFIG.SHEETS.HEADER_ROW;
  var startRow = ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;

  var existingScores = sheet.getRange(startRow, cols.qualityScoreCol, dataRows, 1).getValues();
  var existingOverlaps = sheet.getRange(startRow, cols.overlapScoreCol, dataRows, 1).getValues();

  // Title lookup for overlap display
  var titleCol = headerMap[ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE];
  var allTitles = sheet.getRange(startRow, titleCol + 1, dataRows, 1).getValues();
  function getTitleForRow(rowNum) {
    var idx = rowNum - startRow;
    return (idx >= 0 && idx < allTitles.length) ? String(allTitles[idx][0] || '').trim() : '';
  }

  // Build row-indexed result arrays (pre-fill with existing values)
  var rowResults = {};
  for (var i = 0; i < demos.length; i++) {
    var d = demos[i];
    rowResults[d.row] = {
      qualityScore: existingScores[d.dataIndex][0] || '',
      qualityNote: '',
      overlapScore: existingOverlaps[d.dataIndex][0] || '',
      overlapsWithText: '',
      overlapNote: '',
      note: ''
    };
  }

  // --- PHASE 1: Quality scoring (per-demo, absolute rubric) ---
  var qualityNeeded = demos.filter(function(d) {
    return String(existingScores[d.dataIndex][0] || '').trim() === '';
  });

  Logger.log('Quality: ' + qualityNeeded.length + ' of ' + demos.length + ' need scoring.');

  for (var q = 0; q < qualityNeeded.length; q++) {
    var demo = qualityNeeded[q];
    try {
      var qPrompt = buildQualityPrompt_(demo);
      var qResult = callGemini(qPrompt);

      rowResults[demo.row].qualityScore = qResult.quality_score || 0;
      rowResults[demo.row].qualityNote = qResult.quality_note || '';

      Logger.log('Quality: Row ' + demo.row + ' = ' + qResult.quality_score);
    } catch (e) {
      Logger.log('Quality: Row ' + demo.row + ' ERROR - ' + e.message);
      rowResults[demo.row].qualityNote = 'Error: ' + e.message;
    }
  }

  // --- PHASE 2: Overlap detection (all demos, cross-TDP) ---
  var overlapNeeded = demos.some(function(d) {
    return String(existingOverlaps[d.dataIndex][0] || '').trim() === '';
  });

  if (overlapNeeded) {
    Logger.log('Overlap: analyzing ' + demos.length + ' demos across all TDPs...');
    try {
      var oPrompt = buildOverlapBatchPrompt_(demos);
      var oResults = callGemini(oPrompt);
      if (!Array.isArray(oResults)) oResults = [oResults];

      for (var o = 0; o < oResults.length; o++) {
        var item = oResults[o];
        if (!rowResults[item.row]) continue;

        var overlapRows = item.overlaps_with || [];
        var overlapsWithText = overlapRows.map(function(oRow) {
          var title = getTitleForRow(oRow);
          return title || ('Row ' + oRow);
        }).join('; ');

        rowResults[item.row].overlapScore = item.overlap_score || 0;
        rowResults[item.row].overlapsWithText = overlapsWithText;
        rowResults[item.row].overlapNote = item.overlap_note || '';
      }

      // Demos not in oResults have overlap_score 0 (unique)
      for (var u = 0; u < demos.length; u++) {
        var dr = demos[u].row;
        if (rowResults[dr].overlapScore === '') {
          rowResults[dr].overlapScore = 0;
          rowResults[dr].overlapNote = 'Unique — no overlapping demos found';
        }
      }

      Logger.log('Overlap: done.');
    } catch (e) {
      Logger.log('Overlap: ERROR - ' + e.message);
    }
  } else {
    Logger.log('Overlap: all rows already have data, skipping.');
  }

  // --- BATCH WRITE all results ---
  Logger.log('Writing results...');
  for (var w = 0; w < demos.length; w++) {
    var dRow = demos[w].row;
    var r = rowResults[dRow];

    sheet.getRange(dRow, cols.rowCol).setValue(dRow);
    sheet.getRange(dRow, cols.qualityScoreCol).setValue(r.qualityScore);
    sheet.getRange(dRow, cols.qualityNoteCol).setValue(r.qualityNote);
    sheet.getRange(dRow, cols.overlapScoreCol).setValue(r.overlapScore);
    sheet.getRange(dRow, cols.overlapsWithCol).setValue(r.overlapsWithText);
    sheet.getRange(dRow, cols.overlapNoteCol).setValue(r.overlapNote);
    sheet.getRange(dRow, cols.noteCol).setValue(r.note);
  }

  Logger.log('Analysis complete. ' + demos.length + ' demos processed.');
}
```

- [ ] **Step 2: Push and test with a small run**

```bash
cd "/Users/rubyyang/Arcade Finder" && npx clasp push
```

Clear existing results first: run `clearAllAnalysisResults()` from the Apps Script editor.
Then run `analyzeContent()`. Verify:
- Quality scores are absolute (check a strong demo like row 33 and a weak demo like row 3 — they should score similarly regardless of which TDP they're in)
- Overlap detection finds cross-TDP duplicates (e.g., rows 172 and 292)
- All 7 columns are populated

- [ ] **Step 3: Commit**

```bash
git add RM_Analysis.js
git commit -m "feat: rewrite analyzeContent with absolute quality + cross-TDP overlap"
```

---

### Task 5: Remove the hardcoded Claude path and old prompt

**Files:**
- Modify: `RM_Analysis.js` — remove `applyClaudeResults()`, `buildAnalysisPrompt_()`, and the Claude column system

**Interfaces:**
- Keeps: `writeClaudeResults()` (renamed to `writeExternalResults()`) for pasting external analysis JSON
- Removes: `applyClaudeResults()` (hardcoded snapshot), `CLAUDE_COLUMNS`, `ensureClaudeColumns_()`, `clearClaudeResults()`, `buildAnalysisPrompt_()`

- [ ] **Step 1: Remove the hardcoded snapshot function**

Delete the entire `applyClaudeResults()` function (the one with ~250 hardcoded result objects) and its associated `CLAUDE_COLUMNS`, `ensureClaudeColumns_()`, and `clearClaudeResults()` functions.

- [ ] **Step 2: Rename `writeClaudeResults` to `writeExternalResults` and point it at the main columns**

Replace the existing `writeClaudeResults()` with:

```javascript
function writeExternalResults(resultsJson) {
  var sheet = getMasterSheet();
  var headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);
  var cols = ensureAnalysisColumns_(sheet);
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

  Logger.log('Wrote ' + results.length + ' external results.');
}
```

- [ ] **Step 3: Remove the old combined prompt**

Delete `buildAnalysisPrompt_()` (the one that says "RELATIVE QUALITY SCORE"). It's replaced by `buildQualityPrompt_()` and `buildOverlapBatchPrompt_()`.

- [ ] **Step 4: Update the file header comment**

Replace the file header:

```javascript
/************************************************************
 * RM_Analysis.gs - Content Overlap & Quality Analysis
 *
 * WHAT THIS FILE DOES:
 * Analyzes all eligible demos on Request_Master:
 * - Absolute quality scoring (1-100 fixed rubric, comparable across TDPs)
 * - Cross-TDP overlap detection (all demos compared, not just within groups)
 * - Actionable notes per demo
 *
 * Results are written to auto-created columns on Request_Master.
 *
 * USAGE:
 * Run analyzeContent() from the Apps Script editor.
 * Run clearAllAnalysisResults() to wipe and re-run.
 * Run writeExternalResults(json) to import results from external analysis.
 * All functions skip already-processed rows for re-runnability.
 ************************************************************/
```

- [ ] **Step 5: Push, test, and verify old Claude columns are no longer written**

```bash
cd "/Users/rubyyang/Arcade Finder" && npx clasp push
```

Run `analyzeContent()` from the Apps Script editor. Verify:
- No "(Claude)" columns are created or written
- All results go to the main analysis columns
- `writeExternalResults()` appears in the function list as a replacement for the old `writeClaudeResults()`

- [ ] **Step 6: Commit**

```bash
git add RM_Analysis.js
git commit -m "chore: remove hardcoded Claude snapshot, consolidate to single column set"
```

---

### Task 6: Verification and calibration check

**Files:**
- No code changes — manual verification

- [ ] **Step 1: Spot-check absolute quality scores**

Compare 5 demos that appear in different TDP groups but have similar content quality:
- A strong demo (clear title, specific highlights, full workflow) in Virtualization AND in AI Platform — both should score 80+
- A weak demo (placeholder title, thin content) in any two TDPs — both should score below 40
- If scores diverge by more than 15 points for similar quality, the rubric anchors may need tightening

- [ ] **Step 2: Verify cross-TDP overlaps are caught**

Check these known cross-TDP pairs from the existing analysis:
- Row 172 (Container Management) and row 292 (Application Platform) — both SPIFFE + PostgreSQL mTLS
- Row 48 (Mission Critical IT Automation) referencing OpenShift VMs — should it overlap with Virtualization demos?

- [ ] **Step 3: Check for false positives in overlap**

Review any demos flagged with overlap_score > 60 that are actually complementary (e.g., a Kaoto overview + deep-dive series should be 20-35, not 80+).

- [ ] **Step 4: Run `writeExternalResults()` with a small test JSON**

From the Apps Script editor, run:

```javascript
function testWriteExternal() {
  writeExternalResults(JSON.stringify([
    {"row": 2, "quality_score": 62, "quality_note": "Test note", "overlaps_with": [262], "overlap_score": 55, "overlap_note": "Test overlap", "note": "Test action"}
  ]));
}
```

Verify row 2 gets the correct values in all 7 columns, with row 262's title (not row number) in the "Overlaps With" column.

- [ ] **Step 5: Commit final state**

```bash
git add RM_Analysis.js
git commit -m "chore: verify analysis quality and cross-TDP overlap detection"
```
