# Lifecycle Scoring System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable lifecycle scoring pipeline that reads Request_Master data, creates content profiles, scores metadata/content quality, detects same-TDP overlap, checks global duplicates, generates lifecycle recommendations, and writes results to a `Lifecycle_Scores` sheet tab — preserving manual review fields across runs.

**Architecture:** A new Apps Script file `RM_LifecycleScoring.js` contains the entire pipeline: content profiling, deterministic quality scoring via a fixed rubric, same-TDP overlap detection using title/description/CTA/SEO similarity, global duplicate hygiene checks on shared links, rule-based lifecycle recommendations, and upsert writeback to a dedicated `Lifecycle_Scores` tab. The existing `RM_Lifecycle.js` and `RM_Analysis.js` remain untouched. The pipeline writes local JSON debug files to `data/`. The `onOpen()` menu in `RM_Lifecycle.js` is extended with new menu items.

**Tech Stack:** Google Apps Script (V8 runtime), SpreadsheetApp, CacheService, clasp for deployment.

## Global Constraints

- All code must be Apps Script V8-compatible — no Node/npm/import/export.
- Do not modify existing files other than `RM_Lifecycle.js` (menu additions only).
- Do not overwrite manual review fields (`manual_review_status`, `manual_review_notes`, `manual_override`, `final_decision`, `decision_owner`, `decision_date`) if they already contain values.
- Do not implement Gemini scoring — keep model-agnostic; `scoring_model` field captures the provider.
- Public functions: no trailing underscore. Private helpers: trailing underscore.
- `content_id` generation priority: Number → Join Key → extracted Arcade ID → hash.
- Quality rubric is absolute (100-point), not relative to TDP.
- All overlap detection starts within same TDP; global checks are link-only.
- lifecycle_recommendation is a review recommendation, not a final decision.
- Use `getMasterSheet()`, `getHeaderMapFromSheet()`, `safeGetByName()` from `RM_Triggers.js`.
- Use `ENHANCED_CONFIG.COLUMNS.*` constants from `RM_Config.js` for column names.

---

### Task 1: Create RM_LifecycleScoring.js — Schema Constants and Config

**Files:**
- Create: `RM_LifecycleScoring.js`

**Interfaces:**
- Consumes: `ENHANCED_CONFIG.COLUMNS` from `RM_Config.js`, `getMasterSheet()` / `getHeaderMapFromSheet()` / `safeGetByName()` from `RM_Triggers.js`
- Produces: `LIFECYCLE_SCORE_HEADERS` (array of 67 canonical column names in order), `LIFECYCLE_SCORING_CONFIG` (rubric weights, thresholds, version strings), `MANUAL_REVIEW_FIELDS` (array of 6 field names that must not be overwritten)

- [ ] **Step 1: Create file with header comment and schema constants**

Create `RM_LifecycleScoring.js` with:

```javascript
/************************************************************
 * RM_LifecycleScoring.gs - Lifecycle Scoring Pipeline
 *
 * WHAT THIS FILE DOES:
 * Reads Request_Master rows, builds content profiles, scores
 * quality via a fixed rubric, detects same-TDP overlap,
 * runs global duplicate hygiene, generates lifecycle
 * recommendations, and writes results to Lifecycle_Scores tab.
 *
 * USAGE:
 * Use the "Lifecycle Management" menu in the sheet, or run
 * runLifecycleScoringTest() / runLifecycleScoringFull() from
 * the Apps Script editor.
 ************************************************************/

var LIFECYCLE_SCORING_CONFIG = {
  RUBRIC_VERSION: '1.0.0',
  PROMPT_VERSION: 'heuristic-v1',
  SCORING_MODEL: 'heuristic',
  SCORING_PROVIDER: 'apps-script',
  SHEET_NAME: 'Lifecycle_Scores',
  TEST_ROW_LIMIT: 10,
  QUALITY_WEIGHTS: {
    TITLE_SPECIFICITY: 15,
    DESCRIPTION_CLARITY: 20,
    WORKFLOW_SPECIFICITY: 30,
    METADATA_COMPLETENESS: 15,
    CTA_RELEVANCE: 10,
    AUDIENCE_CLARITY: 10
  },
  QUALITY_GRADES: [
    { min: 90, grade: 'Excellent' },
    { min: 75, grade: 'Good' },
    { min: 60, grade: 'Needs improvement' },
    { min: 40, grade: 'Weak' },
    { min: 0, grade: 'Poor' }
  ],
  OVERLAP_THRESHOLDS: {
    POSSIBLE: 70,
    STRONG: 80,
    LIKELY_DUPLICATE: 90
  }
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
```

- [ ] **Step 2: Verify the file parses cleanly**

Open in Apps Script editor (via `clasp push`) or validate syntax:

```bash
node -c RM_LifecycleScoring.js
```

Expected: no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add RM_LifecycleScoring.js
git commit -m "feat: add lifecycle scoring schema constants and config"
```

---

### Task 2: Content Profile Builder

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: `getMasterSheet()`, `getHeaderMapFromSheet()`, `safeGetByName()`, `ENHANCED_CONFIG.COLUMNS.*`
- Produces: `buildContentProfiles_(options)` → returns `{ profiles: ContentProfile[], errors: string[] }`. Each `ContentProfile` has: `content_id`, `source_row_number`, `repo_number`, `join_key`, `status`, `title`, `tdp`, `product`, `primary_product`, `content_type`, `sales_tactic`, `marketing_program`, `creation_link`, `production_link`, `public_site_link`, `latest_prod_link`, `rhac_page`, `demo_description`, `seo_words`, `seo_description`, `cta_link`, `context_description`, `primary_audience`, `personas`, `pain_points`, `relevant_links_ctas`, `verticals`, `event`, `creator_name`, `creator_team`, `language`, `duration`, `metadata_raw`, `source_row_hash`, `input_hash`.

- [ ] **Step 1: Add helper functions for ID generation and normalization**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   CONTENT PROFILE HELPERS
========================= */

function normalizeText_(val) {
  return String(val || '').trim().replace(/\s+/g, ' ');
}

function extractArcadeIdFromUrl_(url) {
  if (!url) return '';
  var str = String(url).trim();
  var match = str.match(/arcade\.software\/share\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  match = str.match(/arcade\.software\/flows\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  match = str.match(/app\.arcade\.software\/share\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  match = str.match(/demo\.arcade\.software\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return '';
}

function simpleHash_(str) {
  var hash = 0;
  var s = String(str || '');
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function generateContentId_(row, headerMap) {
  var number = normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.NUMBER));
  if (number) return 'NUM-' + number;

  var joinKey = normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.JOIN_KEY));
  if (joinKey) return 'JK-' + joinKey;

  var creationLink = normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_LINK));
  var prodLink = normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK));
  var arcadeId = extractArcadeIdFromUrl_(creationLink) || extractArcadeIdFromUrl_(prodLink);
  if (arcadeId) return 'ARC-' + arcadeId;

  var title = normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE));
  return 'HASH-' + simpleHash_(title + '|' + creationLink + '|' + prodLink);
}

function computeRowHash_(profile) {
  var key = [
    profile.title, profile.tdp, profile.product, profile.status,
    profile.demo_description, profile.creation_link, profile.production_link
  ].join('|');
  return simpleHash_(key);
}

function computeInputHash_(profile) {
  var key = [
    profile.title, profile.demo_description, profile.seo_words,
    profile.seo_description, profile.cta_link, profile.primary_audience,
    profile.context_description, profile.relevant_links_ctas
  ].join('|');
  return simpleHash_(key);
}
```

- [ ] **Step 2: Add the main buildContentProfiles_ function**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   CONTENT PROFILE BUILDER
========================= */

function buildContentProfiles_(options) {
  options = options || {};
  var limit = options.limit || 0;

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
  var rowCount = limit > 0 ? Math.min(limit, allData.length) : allData.length;

  for (var i = 0; i < rowCount; i++) {
    var row = allData[i];
    var rowNum = i + ENHANCED_CONFIG.SHEETS.HEADER_ROW + 1;

    try {
      var contentId = generateContentId_(row, headerMap);
      if (seenIds[contentId]) {
        errors.push('Duplicate content_id "' + contentId + '" at rows ' + seenIds[contentId] + ' and ' + rowNum);
        contentId = contentId + '-R' + rowNum;
      }
      seenIds[contentId] = rowNum;

      var profile = {
        content_id: contentId,
        source_row_number: rowNum,
        repo_number: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.NUMBER)),
        join_key: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.JOIN_KEY)),
        status: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS)),
        title: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE))
          || normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE)),
        tdp: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.TDP)),
        product: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PRODUCT)),
        primary_product: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PRIMARY_PRODUCT)),
        content_type: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_CONTENT_TYPE))
          || normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CONTENT_TYPE)),
        sales_tactic: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.SALES_TACTIC)),
        marketing_program: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.MARKETING_PROGRAM)),
        creation_link: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_LINK)),
        production_link: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK)),
        public_site_link: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PUBLIC_SITE_LINK)),
        latest_prod_link: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.LATEST_PROD_LINK)),
        rhac_page: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.RHAC_PAGE)),
        demo_description: normalizeText_(safeGetByName(row, headerMap, 'Demo Description'))
          || normalizeText_(safeGetByName(row, headerMap, 'Demo Description (Gemni generated)')),
        seo_words: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.SEO_WORDS)),
        seo_description: normalizeText_(safeGetByName(row, headerMap, 'SEODescription')),
        cta_link: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CTA_LINK)),
        context_description: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CONTEXT_DESC)),
        primary_audience: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PRIMARY_AUDIENCE)),
        personas: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PERSONAS)),
        pain_points: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.PAIN_POINTS)),
        relevant_links_ctas: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.REQUEST_LINKS)),
        verticals: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.VERTICALS)),
        event: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.EVENT)),
        creator_name: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_NAME)),
        creator_team: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM)),
        language: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.LANGUAGE)),
        duration: normalizeText_(safeGetByName(row, headerMap, 'Duration')),
        metadata_raw: normalizeText_(safeGetByName(row, headerMap, ENHANCED_CONFIG.COLUMNS.METADATA))
      };

      profile.source_row_hash = computeRowHash_(profile);
      profile.input_hash = computeInputHash_(profile);

      profiles.push(profile);
    } catch (e) {
      errors.push('Row ' + rowNum + ': ' + e.message);
    }
  }

  return { profiles: profiles, errors: errors };
}
```

Note: Some column names like `'Demo Description'`, `'Demo Description (Gemni generated)'`, `'SEODescription'`, `'Duration'` are not in `ENHANCED_CONFIG.COLUMNS` — use the raw header strings. The `LATEST_PROD_LINK` constant may also not exist; add a fallback:

```javascript
// At top of buildContentProfiles_, after headerMap:
var COL = ENHANCED_CONFIG.COLUMNS;
// Then use COL.xxx for known columns, raw strings for the rest.
// If COL.LATEST_PROD_LINK is undefined, use 'Latest Prod Link'.
```

- [ ] **Step 3: Verify syntax**

```bash
node -c RM_LifecycleScoring.js
```

Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add RM_LifecycleScoring.js
git commit -m "feat: add content profile builder for lifecycle scoring"
```

---

### Task 3: Quality Scoring Engine

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: `ContentProfile` objects from `buildContentProfiles_()`, `LIFECYCLE_SCORING_CONFIG.QUALITY_WEIGHTS` and `QUALITY_GRADES`
- Produces: `scoreQuality_(profile)` → returns `{ quality_score_abs, quality_grade, quality_title_score, quality_description_score, quality_workflow_specificity_score, quality_metadata_completeness_score, quality_cta_relevance_score, quality_audience_clarity_score, quality_score_reason, metadata_issues, recommended_metadata_fixes }`

- [ ] **Step 1: Add title scoring helper**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   QUALITY SCORING ENGINE
========================= */

function scoreTitleSpecificity_(title) {
  if (!title) return { score: 0, issues: ['Missing title'], fixes: ['Add a descriptive title'] };
  var max = LIFECYCLE_SCORING_CONFIG.QUALITY_WEIGHTS.TITLE_SPECIFICITY;
  var score = max;
  var issues = [];
  var fixes = [];

  if (title.length < 10) {
    score -= 8;
    issues.push('Title too short (' + title.length + ' chars)');
    fixes.push('Expand title to describe the specific workflow or use case');
  }
  if (title.length > 120) {
    score -= 3;
    issues.push('Title too long (' + title.length + ' chars)');
    fixes.push('Shorten title to under 120 characters');
  }

  var genericPatterns = [
    /^(demo|test|untitled|new|copy|draft)/i,
    /^(introduction|overview|getting started)$/i,
    /^[A-Za-z]{1,4}$/
  ];
  for (var i = 0; i < genericPatterns.length; i++) {
    if (genericPatterns[i].test(title)) {
      score -= 7;
      issues.push('Title appears generic or placeholder');
      fixes.push('Replace with a specific title naming the product, workflow, and outcome');
      break;
    }
  }

  var hasProduct = /red hat|openshift|ansible|rhel|rosa|aro|rhacm|acs|aap|kaoto|camel|quarkus|podman|insights|lightspeed|developer hub|instructlab|virtualization|edge manager|service mesh/i.test(title);
  if (!hasProduct) {
    score -= 3;
    issues.push('Title does not mention a specific product');
    fixes.push('Include the primary product name in the title');
  }

  var hasAction = /deploy|install|configur|migrat|automat|monitor|manag|creat|build|integrat|secur|scan|provision|scale|troubleshoot|remediat|custom|optimiz/i.test(title);
  if (!hasAction) {
    score -= 2;
    issues.push('Title lacks an action verb');
    fixes.push('Add a verb describing what the demo does (deploy, configure, migrate, etc.)');
  }

  return { score: Math.max(0, score), issues: issues, fixes: fixes };
}
```

- [ ] **Step 2: Add description, workflow, metadata, CTA, and audience scoring helpers**

Append to `RM_LifecycleScoring.js`:

```javascript
function scoreDescriptionClarity_(profile) {
  var desc = profile.demo_description || profile.context_description || '';
  var max = LIFECYCLE_SCORING_CONFIG.QUALITY_WEIGHTS.DESCRIPTION_CLARITY;
  var score = max;
  var issues = [];
  var fixes = [];

  if (!desc) {
    return { score: 0, issues: ['Missing description'], fixes: ['Add a demo description explaining what the user will learn'] };
  }

  if (desc.length < 30) {
    score -= 10;
    issues.push('Description too short (' + desc.length + ' chars)');
    fixes.push('Expand description to at least 100 characters');
  } else if (desc.length < 80) {
    score -= 5;
    issues.push('Description is brief');
    fixes.push('Add more detail about the workflow covered');
  }

  if (desc === profile.title) {
    score -= 8;
    issues.push('Description is identical to title');
    fixes.push('Write a unique description that expands on the title');
  }

  var hasSpecifics = /step|click|navigate|select|configure|create|review|verify|deploy|install|enter|choose|set up|monitor|launch/i.test(desc);
  if (!hasSpecifics) {
    score -= 5;
    issues.push('Description lacks specific action steps');
    fixes.push('Include specific steps the user will take');
  }

  return { score: Math.max(0, score), issues: issues, fixes: fixes };
}

function scoreWorkflowSpecificity_(profile) {
  var desc = profile.demo_description || profile.context_description || '';
  var max = LIFECYCLE_SCORING_CONFIG.QUALITY_WEIGHTS.WORKFLOW_SPECIFICITY;
  var score = 0;
  var issues = [];
  var fixes = [];

  if (!desc) {
    return { score: 0, issues: ['No content to evaluate workflow'], fixes: ['Add demo description with workflow details'] };
  }

  var bulletCount = (desc.match(/[•\-\*►▸✓✅🔹]\s/g) || []).length;
  var numberedSteps = (desc.match(/\d+[\.\)]\s/g) || []).length;
  var highlightCount = bulletCount + numberedSteps;

  if (highlightCount >= 7) score += 15;
  else if (highlightCount >= 5) score += 12;
  else if (highlightCount >= 3) score += 8;
  else if (highlightCount >= 1) score += 4;
  else {
    issues.push('No structured highlights or steps found');
    fixes.push('Add bullet-point highlights describing each step of the workflow');
  }

  var namedFeatures = (desc.match(/(?:using|with|via|through|in)\s+[A-Z][A-Za-z\s]+/g) || []).length;
  var technicalTerms = (desc.match(/(?:API|CLI|YAML|JSON|helm|operator|pipeline|namespace|pod|container|cluster|node|deployment|service|route|ingress|policy|template|playbook|workflow|rulebook|dashboard|console)/gi) || []).length;
  var featureScore = Math.min(10, namedFeatures * 2 + technicalTerms);
  score += featureScore;

  if (featureScore < 3) {
    issues.push('Description lacks named product features or technical terms');
    fixes.push('Reference specific features, tools, or technical components by name');
  }

  var hasOutcome = /result|verif|confirm|success|complet|demonstrat|show|display|access|running|active|ready/i.test(desc);
  if (hasOutcome) score += 5;
  else {
    issues.push('No clear outcome or verification step');
    fixes.push('Describe what the user sees when the workflow succeeds');
  }

  return { score: Math.min(max, Math.max(0, score)), issues: issues, fixes: fixes };
}

function scoreMetadataCompleteness_(profile) {
  var max = LIFECYCLE_SCORING_CONFIG.QUALITY_WEIGHTS.METADATA_COMPLETENESS;
  var score = max;
  var issues = [];
  var fixes = [];

  var requiredFields = [
    { field: 'tdp', label: 'TDP' },
    { field: 'product', label: 'Product' },
    { field: 'primary_product', label: 'Primary Product' },
    { field: 'content_type', label: 'Content Type' },
    { field: 'status', label: 'Status' }
  ];

  var valuableFields = [
    { field: 'sales_tactic', label: 'Sales Tactic' },
    { field: 'marketing_program', label: 'Marketing Program' },
    { field: 'seo_words', label: 'SEO Words' },
    { field: 'primary_audience', label: 'Primary Audience' },
    { field: 'production_link', label: 'Production Link' },
    { field: 'creator_name', label: 'Creator Name' }
  ];

  var missingRequired = 0;
  for (var i = 0; i < requiredFields.length; i++) {
    if (!profile[requiredFields[i].field]) {
      missingRequired++;
      issues.push('Missing ' + requiredFields[i].label);
      fixes.push('Add ' + requiredFields[i].label);
    }
  }
  score -= missingRequired * 2;

  var missingValuable = 0;
  for (var j = 0; j < valuableFields.length; j++) {
    if (!profile[valuableFields[j].field]) {
      missingValuable++;
    }
  }
  if (missingValuable > 3) {
    score -= 3;
    issues.push(missingValuable + ' of ' + valuableFields.length + ' recommended fields empty');
    fixes.push('Complete Sales Tactic, Marketing Program, SEO Words, Primary Audience fields');
  } else if (missingValuable > 1) {
    score -= 1;
  }

  return { score: Math.max(0, score), issues: issues, fixes: fixes };
}

function scoreCtaRelevance_(profile) {
  var max = LIFECYCLE_SCORING_CONFIG.QUALITY_WEIGHTS.CTA_RELEVANCE;
  var score = max;
  var issues = [];
  var fixes = [];

  var hasCta = profile.cta_link || profile.relevant_links_ctas;
  if (!hasCta) {
    score -= 6;
    issues.push('No CTA link or relevant links');
    fixes.push('Add a CTA link directing users to next steps');
  }

  var hasSeo = profile.seo_words;
  if (!hasSeo) {
    score -= 2;
    issues.push('Missing SEO keywords');
    fixes.push('Add SEO keywords relevant to the demo topic');
  }

  var hasSeoDesc = profile.seo_description;
  if (!hasSeoDesc) {
    score -= 2;
    issues.push('Missing SEO description');
    fixes.push('Add SEO description for search visibility');
  }

  return { score: Math.max(0, score), issues: issues, fixes: fixes };
}

function scoreAudienceClarity_(profile) {
  var max = LIFECYCLE_SCORING_CONFIG.QUALITY_WEIGHTS.AUDIENCE_CLARITY;
  var score = max;
  var issues = [];
  var fixes = [];

  if (!profile.primary_audience) {
    score -= 4;
    issues.push('No primary audience specified');
    fixes.push('Define the target audience (e.g., Platform Engineer, Developer, IT Manager)');
  }

  if (!profile.personas) {
    score -= 2;
    issues.push('No personas defined');
    fixes.push('Add target personas');
  }

  if (!profile.verticals && !profile.pain_points) {
    score -= 2;
    issues.push('No verticals or pain points');
    fixes.push('Add target verticals or pain points this demo addresses');
  }

  var hasUseCaseSignal = profile.sales_tactic || profile.marketing_program || profile.context_description;
  if (!hasUseCaseSignal) {
    score -= 2;
    issues.push('No sales tactic, marketing program, or context description');
    fixes.push('Add context about the business use case');
  }

  return { score: Math.max(0, score), issues: issues, fixes: fixes };
}
```

- [ ] **Step 3: Add the composite scoreQuality_ function**

Append to `RM_LifecycleScoring.js`:

```javascript
function getQualityGrade_(score) {
  var grades = LIFECYCLE_SCORING_CONFIG.QUALITY_GRADES;
  for (var i = 0; i < grades.length; i++) {
    if (score >= grades[i].min) return grades[i].grade;
  }
  return 'Poor';
}

function scoreQuality_(profile) {
  var titleResult = scoreTitleSpecificity_(profile.title);
  var descResult = scoreDescriptionClarity_(profile);
  var workflowResult = scoreWorkflowSpecificity_(profile);
  var metadataResult = scoreMetadataCompleteness_(profile);
  var ctaResult = scoreCtaRelevance_(profile);
  var audienceResult = scoreAudienceClarity_(profile);

  var totalScore = titleResult.score + descResult.score + workflowResult.score +
    metadataResult.score + ctaResult.score + audienceResult.score;

  var allIssues = [].concat(
    titleResult.issues, descResult.issues, workflowResult.issues,
    metadataResult.issues, ctaResult.issues, audienceResult.issues
  );
  var allFixes = [].concat(
    titleResult.fixes, descResult.fixes, workflowResult.fixes,
    metadataResult.fixes, ctaResult.fixes, audienceResult.fixes
  );

  var reasons = [];
  if (titleResult.score < 10) reasons.push('weak title');
  if (descResult.score < 12) reasons.push('weak description');
  if (workflowResult.score < 15) reasons.push('low workflow detail');
  if (metadataResult.score < 10) reasons.push('incomplete metadata');
  if (ctaResult.score < 5) reasons.push('missing CTA/SEO');
  if (audienceResult.score < 5) reasons.push('unclear audience');

  var reasonStr = reasons.length > 0
    ? getQualityGrade_(totalScore) + ': ' + reasons.join(', ')
    : getQualityGrade_(totalScore) + ': solid across all dimensions';

  return {
    quality_score_abs: totalScore,
    quality_grade: getQualityGrade_(totalScore),
    quality_title_score: titleResult.score,
    quality_description_score: descResult.score,
    quality_workflow_specificity_score: workflowResult.score,
    quality_metadata_completeness_score: metadataResult.score,
    quality_cta_relevance_score: ctaResult.score,
    quality_audience_clarity_score: audienceResult.score,
    quality_score_reason: reasonStr,
    metadata_issues: allIssues.join('; '),
    recommended_metadata_fixes: allFixes.join('; ')
  };
}
```

- [ ] **Step 4: Verify syntax**

```bash
node -c RM_LifecycleScoring.js
```

Expected: no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add RM_LifecycleScoring.js
git commit -m "feat: add deterministic quality scoring engine with fixed 100-point rubric"
```

---

### Task 4: Relative Quality Ranking (TDP and Portfolio)

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: Array of scored profiles (each with `quality_score_abs` and `tdp`)
- Produces: `computeRelativeRanks_(scoredProfiles)` → mutates profiles in-place, adding `quality_tdp_rank`, `quality_tdp_percentile`, `quality_portfolio_rank`, `quality_portfolio_percentile`

- [ ] **Step 1: Add relative ranking function**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   RELATIVE QUALITY RANKING
========================= */

function computeRelativeRanks_(scoredProfiles) {
  var allScores = scoredProfiles.map(function(p) { return p.quality_score_abs; });
  allScores.sort(function(a, b) { return b - a; });

  for (var i = 0; i < scoredProfiles.length; i++) {
    var score = scoredProfiles[i].quality_score_abs;
    scoredProfiles[i].quality_portfolio_rank = allScores.indexOf(score) + 1;
    var below = allScores.filter(function(s) { return s < score; }).length;
    scoredProfiles[i].quality_portfolio_percentile =
      allScores.length > 1 ? Math.round((below / (allScores.length - 1)) * 100) : 100;
  }

  var tdpGroups = {};
  for (var j = 0; j < scoredProfiles.length; j++) {
    var tdp = scoredProfiles[j].tdp || 'Unassigned';
    if (!tdpGroups[tdp]) tdpGroups[tdp] = [];
    tdpGroups[tdp].push(j);
  }

  var tdpKeys = Object.keys(tdpGroups);
  for (var t = 0; t < tdpKeys.length; t++) {
    var indices = tdpGroups[tdpKeys[t]];
    var tdpScores = indices.map(function(idx) { return scoredProfiles[idx].quality_score_abs; });
    tdpScores.sort(function(a, b) { return b - a; });

    for (var k = 0; k < indices.length; k++) {
      var idx = indices[k];
      var s = scoredProfiles[idx].quality_score_abs;
      scoredProfiles[idx].quality_tdp_rank = tdpScores.indexOf(s) + 1;
      var belowInTdp = tdpScores.filter(function(v) { return v < s; }).length;
      scoredProfiles[idx].quality_tdp_percentile =
        tdpScores.length > 1 ? Math.round((belowInTdp / (tdpScores.length - 1)) * 100) : 100;
    }
  }
}
```

- [ ] **Step 2: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add TDP and portfolio relative quality ranking"
```

---

### Task 5: Same-TDP Overlap Detection

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: Array of content profiles (with `title`, `demo_description`, `cta_link`, `seo_words`, `tdp`, `content_id`, `content_type`, `product`)
- Produces: `detectSameTdpOverlap_(profiles)` → mutates profiles in-place, adding `overlap_score`, `overlap_type`, `overlap_scope`, `overlap_cluster_id`, `overlap_with_ids`, `overlap_reason`, `primary_candidate_id`, `duplicate_risk_level`, `overlap_review_priority`

- [ ] **Step 1: Add text similarity helpers**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   OVERLAP DETECTION
========================= */

function tokenize_(text) {
  if (!text) return [];
  return String(text).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) { return w.length > 2; });
}

function jaccardSimilarity_(tokens1, tokens2) {
  if (tokens1.length === 0 && tokens2.length === 0) return 0;
  var set1 = {};
  var set2 = {};
  tokens1.forEach(function(t) { set1[t] = true; });
  tokens2.forEach(function(t) { set2[t] = true; });

  var intersection = 0;
  var keys1 = Object.keys(set1);
  for (var i = 0; i < keys1.length; i++) {
    if (set2[keys1[i]]) intersection++;
  }

  var union = Object.keys(set1).length + Object.keys(set2).length - intersection;
  return union > 0 ? intersection / union : 0;
}

function computePairOverlap_(a, b) {
  var titleSim = jaccardSimilarity_(tokenize_(a.title), tokenize_(b.title));
  var descSim = jaccardSimilarity_(
    tokenize_((a.demo_description || '') + ' ' + (a.context_description || '')),
    tokenize_((b.demo_description || '') + ' ' + (b.context_description || ''))
  );
  var seoSim = jaccardSimilarity_(tokenize_(a.seo_words), tokenize_(b.seo_words));
  var ctaSim = (a.cta_link && b.cta_link && a.cta_link === b.cta_link) ? 1.0 : 0;

  var score = Math.round(
    titleSim * 30 +
    descSim * 40 +
    seoSim * 15 +
    ctaSim * 15
  );

  return Math.min(100, score);
}

function classifyOverlapType_(score, a, b) {
  if (score >= 90) return 'exact_duplicate';
  if (score >= 80) return 'same_workflow_overlap';

  var sameProduct = a.product && b.product && a.product.toLowerCase() === b.product.toLowerCase();
  var typeDiffers = a.content_type && b.content_type && a.content_type !== b.content_type;

  if (score >= 70 && typeDiffers) return 'same_topic_different_depth';
  if (score >= 70 && sameProduct) return 'same_workflow_overlap';
  if (score >= 50 && sameProduct && typeDiffers) return 'complementary_content';
  if (score >= 50) return 'same_product_different_use_case';

  return 'not_overlap';
}

function classifyDuplicateRisk_(overlapScore, overlapType) {
  if (overlapType === 'exact_duplicate') return 'critical';
  if (overlapScore >= 80) return 'high';
  if (overlapScore >= 70) return 'medium';
  if (overlapScore >= 50) return 'low';
  return 'none';
}
```

- [ ] **Step 2: Add main same-TDP overlap detection function**

Append to `RM_LifecycleScoring.js`:

```javascript
function detectSameTdpOverlap_(profiles) {
  var tdpGroups = {};
  for (var i = 0; i < profiles.length; i++) {
    var tdp = profiles[i].tdp || 'Unassigned';
    if (!tdpGroups[tdp]) tdpGroups[tdp] = [];
    tdpGroups[tdp].push(i);
  }

  for (var j = 0; j < profiles.length; j++) {
    profiles[j].overlap_score = 0;
    profiles[j].overlap_type = 'not_overlap';
    profiles[j].overlap_scope = 'same_tdp';
    profiles[j].overlap_cluster_id = '';
    profiles[j].overlap_with_ids = '';
    profiles[j].overlap_reason = '';
    profiles[j].primary_candidate_id = '';
    profiles[j].duplicate_risk_level = 'none';
    profiles[j].overlap_review_priority = '';
  }

  var clusterCounter = 0;
  var tdpKeys = Object.keys(tdpGroups);

  for (var t = 0; t < tdpKeys.length; t++) {
    var indices = tdpGroups[tdpKeys[t]];
    if (indices.length < 2) continue;

    var pairScores = [];
    for (var a = 0; a < indices.length; a++) {
      for (var b = a + 1; b < indices.length; b++) {
        var idxA = indices[a];
        var idxB = indices[b];
        var pairScore = computePairOverlap_(profiles[idxA], profiles[idxB]);
        if (pairScore >= 50) {
          pairScores.push({ a: idxA, b: idxB, score: pairScore });
        }
      }
    }

    var visited = {};
    for (var p = 0; p < pairScores.length; p++) {
      var pair = pairScores[p];
      if (pair.score < 50) continue;

      var overlapType = classifyOverlapType_(pair.score, profiles[pair.a], profiles[pair.b]);
      if (overlapType === 'not_overlap') continue;

      var clusterId = '';
      if (pair.score >= 70) {
        if (!visited[pair.a] && !visited[pair.b]) {
          clusterCounter++;
          clusterId = 'CL-' + clusterCounter;
          visited[pair.a] = clusterId;
          visited[pair.b] = clusterId;
        } else {
          clusterId = visited[pair.a] || visited[pair.b] || '';
          visited[pair.a] = clusterId;
          visited[pair.b] = clusterId;
        }
      }

      var updateOverlap = function(idx, otherIdx, score, type, cluster) {
        if (score > profiles[idx].overlap_score) {
          profiles[idx].overlap_score = score;
          profiles[idx].overlap_type = type;
          profiles[idx].duplicate_risk_level = classifyDuplicateRisk_(score, type);
        }
        if (cluster) profiles[idx].overlap_cluster_id = cluster;

        var existingIds = profiles[idx].overlap_with_ids ? profiles[idx].overlap_with_ids.split(', ') : [];
        var otherId = profiles[otherIdx].content_id;
        if (existingIds.indexOf(otherId) === -1) {
          existingIds.push(otherId);
          profiles[idx].overlap_with_ids = existingIds.filter(Boolean).join(', ');
        }

        profiles[idx].overlap_reason = type.replace(/_/g, ' ') + ' (score: ' + score + '/100)';
      };

      updateOverlap(pair.a, pair.b, pair.score, overlapType, clusterId);
      updateOverlap(pair.b, pair.a, pair.score, overlapType, clusterId);

      if (pair.score >= 70) {
        var strongerIdx = profiles[pair.a].quality_score_abs >= profiles[pair.b].quality_score_abs ? pair.a : pair.b;
        var weakerIdx = strongerIdx === pair.a ? pair.b : pair.a;
        profiles[weakerIdx].primary_candidate_id = profiles[strongerIdx].content_id;
      }
    }

    for (var r = 0; r < indices.length; r++) {
      var idx = indices[r];
      if (profiles[idx].overlap_score >= 80) {
        profiles[idx].overlap_review_priority = 'high';
      } else if (profiles[idx].overlap_score >= 70) {
        profiles[idx].overlap_review_priority = 'medium';
      } else if (profiles[idx].overlap_score >= 50) {
        profiles[idx].overlap_review_priority = 'low';
      }
    }
  }
}
```

- [ ] **Step 3: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add same-TDP overlap detection with Jaccard similarity"
```

---

### Task 6: Global Duplicate Hygiene Check

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: Array of content profiles (with link fields and `title`)
- Produces: `runGlobalDuplicateCheck_(profiles)` → mutates profiles in-place, upgrading `overlap_score`, `overlap_type`, `duplicate_risk_level`, `overlap_reason`, `overlap_with_ids` when obvious duplicate links or near-identical titles are found

- [ ] **Step 1: Add global duplicate check function**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   GLOBAL DUPLICATE HYGIENE
========================= */

function normalizeUrlForComparison_(url) {
  if (!url) return '';
  return String(url).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/\?.*$/, '');
}

function normalizeTitle_(title) {
  if (!title) return '';
  return String(title).toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function runGlobalDuplicateCheck_(profiles) {
  var linkFields = [
    'creation_link', 'production_link', 'latest_prod_link',
    'rhac_page', 'public_site_link'
  ];

  var linkMaps = {};
  for (var f = 0; f < linkFields.length; f++) {
    linkMaps[linkFields[f]] = {};
  }
  var arcadeIdMap = {};
  var titleMap = {};

  for (var i = 0; i < profiles.length; i++) {
    var p = profiles[i];

    for (var lf = 0; lf < linkFields.length; lf++) {
      var field = linkFields[lf];
      var normalized = normalizeUrlForComparison_(p[field]);
      if (normalized) {
        if (!linkMaps[field][normalized]) linkMaps[field][normalized] = [];
        linkMaps[field][normalized].push(i);
      }
    }

    var arcadeId = extractArcadeIdFromUrl_(p.creation_link) || extractArcadeIdFromUrl_(p.production_link);
    if (arcadeId) {
      var normArcadeId = arcadeId.toLowerCase();
      if (!arcadeIdMap[normArcadeId]) arcadeIdMap[normArcadeId] = [];
      arcadeIdMap[normArcadeId].push(i);
    }

    var normTitle = normalizeTitle_(p.title);
    if (normTitle && normTitle.length > 5) {
      if (!titleMap[normTitle]) titleMap[normTitle] = [];
      titleMap[normTitle].push(i);
    }
  }

  function flagDuplicates(map, reasonPrefix) {
    var keys = Object.keys(map);
    for (var k = 0; k < keys.length; k++) {
      var group = map[keys[k]];
      if (group.length < 2) continue;

      for (var g = 0; g < group.length; g++) {
        var idx = group[g];
        var otherIds = group
          .filter(function(oi) { return oi !== idx; })
          .map(function(oi) { return profiles[oi].content_id; });

        if (profiles[idx].duplicate_risk_level !== 'critical') {
          profiles[idx].duplicate_risk_level = 'high';
        }

        if (profiles[idx].overlap_score < 90) {
          profiles[idx].overlap_score = 90;
          profiles[idx].overlap_type = 'exact_duplicate';
        }

        var existingIds = profiles[idx].overlap_with_ids ? profiles[idx].overlap_with_ids.split(', ') : [];
        for (var o = 0; o < otherIds.length; o++) {
          if (existingIds.indexOf(otherIds[o]) === -1) {
            existingIds.push(otherIds[o]);
          }
        }
        profiles[idx].overlap_with_ids = existingIds.filter(Boolean).join(', ');

        var existingReason = profiles[idx].overlap_reason || '';
        var newReason = reasonPrefix + ' match (' + keys[k].substring(0, 60) + ')';
        profiles[idx].overlap_reason = existingReason
          ? existingReason + '; ' + newReason
          : newReason;

        profiles[idx].overlap_scope = 'global';
        if (!profiles[idx].overlap_review_priority || profiles[idx].overlap_review_priority !== 'high') {
          profiles[idx].overlap_review_priority = 'high';
        }
      }
    }
  }

  for (var fl = 0; fl < linkFields.length; fl++) {
    flagDuplicates(linkMaps[linkFields[fl]], linkFields[fl].replace(/_/g, ' '));
  }
  flagDuplicates(arcadeIdMap, 'Arcade ID');
  flagDuplicates(titleMap, 'Identical title');
}
```

- [ ] **Step 2: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add global duplicate hygiene check on shared links and titles"
```

---

### Task 7: Lifecycle Recommendation Engine

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: Scored profiles with `quality_score_abs`, `quality_grade`, `overlap_score`, `overlap_type`, `duplicate_risk_level`, `metadata_issues`, `status`
- Produces: `generateLifecycleRecommendation_(profile)` → returns `{ lifecycle_recommendation, lifecycle_priority_score, lifecycle_priority, lifecycle_confidence, lifecycle_reason, recommended_owner, review_due_quarter }`

- [ ] **Step 1: Add lifecycle recommendation function**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   LIFECYCLE RECOMMENDATION
========================= */

function getCurrentQuarter_() {
  var now = new Date();
  var q = Math.ceil((now.getMonth() + 1) / 3);
  return 'Q' + q + ' ' + now.getFullYear();
}

function getNextQuarter_() {
  var now = new Date();
  var q = Math.ceil((now.getMonth() + 1) / 3);
  var year = now.getFullYear();
  if (q === 4) { q = 1; year++; }
  else { q++; }
  return 'Q' + q + ' ' + year;
}

function generateLifecycleRecommendation_(profile) {
  var q = profile.quality_score_abs;
  var overlapScore = profile.overlap_score || 0;
  var overlapType = profile.overlap_type || 'not_overlap';
  var risk = profile.duplicate_risk_level || 'none';
  var issues = profile.metadata_issues || '';
  var status = profile.status || '';

  var recommendation = '';
  var reasons = [];
  var confidence = 'medium';
  var priorityScore = 50;

  var isPublished = /published/i.test(status);
  var isReviewed = /reviewed/i.test(status);
  var isActive = isPublished || isReviewed;

  var isExactDuplicate = overlapType === 'exact_duplicate' || risk === 'critical';
  var isStrongOverlap = overlapScore >= 80 && overlapType === 'same_workflow_overlap';
  var hasSevereMetadataIssues = (issues.match(/Missing/g) || []).length >= 3;

  if (isExactDuplicate && q < 60 && isActive) {
    recommendation = 'Retire candidate';
    reasons.push('exact duplicate with quality ' + q + '/100');
    confidence = 'high';
    priorityScore = 95;
  } else if (isStrongOverlap && q < 60 && isActive) {
    recommendation = 'Retire candidate';
    reasons.push('strong workflow overlap (' + overlapScore + '/100) with low quality (' + q + '/100)');
    confidence = 'high';
    priorityScore = 90;
  } else if (overlapScore >= 80 && isActive) {
    recommendation = 'Merge with stronger asset';
    reasons.push('strong overlap (' + overlapScore + '/100) — merge with ' + (profile.primary_candidate_id || 'higher-quality asset'));
    confidence = 'medium';
    priorityScore = 80;
  } else if (q >= 75 && overlapScore < 70 && !hasSevereMetadataIssues) {
    recommendation = 'Keep';
    reasons.push('quality ' + q + '/100, no strong overlap, metadata adequate');
    confidence = 'high';
    priorityScore = 20;
  } else if ((q >= 60 && q < 75) || hasSevereMetadataIssues) {
    recommendation = 'Refresh metadata';
    if (q < 75) reasons.push('quality ' + q + '/100 below Keep threshold');
    if (hasSevereMetadataIssues) reasons.push('multiple missing metadata fields');
    confidence = 'medium';
    priorityScore = 60;
  } else if (q < 60 && overlapScore < 70 && isActive) {
    recommendation = 'Refresh content';
    reasons.push('low quality (' + q + '/100) but no strong overlap — content may be strategically relevant');
    confidence = 'medium';
    priorityScore = 70;
  } else if (!isActive) {
    recommendation = 'Needs human review';
    reasons.push('status is "' + status + '" — not actively published');
    confidence = 'low';
    priorityScore = 40;
  } else {
    recommendation = 'Needs human review';
    reasons.push('mixed signals — quality ' + q + '/100, overlap ' + overlapScore + '/100');
    confidence = 'low';
    priorityScore = 55;
  }

  if (q >= 75 && risk === 'high') {
    recommendation = 'Needs human review';
    reasons.push('high quality but duplicate risk — human review needed');
    confidence = 'low';
    priorityScore = 75;
  }

  if (overlapScore >= 70 && profile.tdp !== (profile.overlap_scope === 'global' ? 'cross-TDP' : '')) {
    if (recommendation !== 'Needs human review' && profile.overlap_scope === 'global') {
      recommendation = 'Needs human review';
      reasons.push('overlap detected across different TDPs');
      confidence = 'low';
    }
  }

  var priority = 'low';
  if (priorityScore >= 80) priority = 'critical';
  else if (priorityScore >= 60) priority = 'high';
  else if (priorityScore >= 40) priority = 'medium';

  return {
    lifecycle_recommendation: recommendation,
    lifecycle_priority_score: priorityScore,
    lifecycle_priority: priority,
    lifecycle_confidence: confidence,
    lifecycle_reason: reasons.join('; '),
    recommended_owner: '',
    review_due_quarter: priority === 'critical' ? getCurrentQuarter_() : getNextQuarter_()
  };
}
```

- [ ] **Step 2: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add rule-based lifecycle recommendation engine"
```

---

### Task 8: Lifecycle_Scores Sheet Writeback

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: Array of fully scored profiles, `LIFECYCLE_SCORE_HEADERS`, `MANUAL_REVIEW_FIELDS`
- Produces: `writeToLifecycleScoresSheet_(scoredProfiles, options)` → creates/updates `Lifecycle_Scores` tab with upsert by `content_id`, preserving manual review fields. `options.dryRun` logs without writing.

- [ ] **Step 1: Add sheet writeback function**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   SHEET WRITEBACK
========================= */

function getOrCreateLifecycleSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = LIFECYCLE_SCORING_CONFIG.SHEET_NAME;
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, LIFECYCLE_SCORE_HEADERS.length)
      .setValues([LIFECYCLE_SCORE_HEADERS]);
    sheet.getRange(1, 1, 1, LIFECYCLE_SCORE_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#e8eaed');
    sheet.setFrozenRows(1);
    Logger.log('Created "' + sheetName + '" tab with ' + LIFECYCLE_SCORE_HEADERS.length + ' columns.');
  }

  return sheet;
}

function ensureLifecycleHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  var existingHeaders = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); })
    : [];

  var missingHeaders = [];
  for (var i = 0; i < LIFECYCLE_SCORE_HEADERS.length; i++) {
    if (existingHeaders.indexOf(LIFECYCLE_SCORE_HEADERS[i]) === -1) {
      missingHeaders.push(LIFECYCLE_SCORE_HEADERS[i]);
    }
  }

  if (missingHeaders.length > 0) {
    for (var m = 0; m < missingHeaders.length; m++) {
      sheet.getRange(1, existingHeaders.length + 1 + m).setValue(missingHeaders[m]);
    }
    Logger.log('Added ' + missingHeaders.length + ' missing headers to Lifecycle_Scores.');
  }

  var updatedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });
  var headerMap = {};
  for (var h = 0; h < updatedHeaders.length; h++) {
    headerMap[updatedHeaders[h]] = h;
  }
  return headerMap;
}

function buildExistingManualReviewMap_(sheet, headerMap) {
  var manualMap = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return manualMap;

  var contentIdCol = headerMap['content_id'];
  if (contentIdCol === undefined) return manualMap;

  var dataRows = lastRow - 1;
  var allData = sheet.getRange(2, 1, dataRows, sheet.getLastColumn()).getValues();

  for (var i = 0; i < allData.length; i++) {
    var contentId = String(allData[i][contentIdCol] || '').trim();
    if (!contentId) continue;

    var manualValues = {};
    var hasManual = false;
    for (var m = 0; m < MANUAL_REVIEW_FIELDS.length; m++) {
      var field = MANUAL_REVIEW_FIELDS[m];
      var col = headerMap[field];
      if (col !== undefined) {
        var val = String(allData[i][col] || '').trim();
        if (val) {
          manualValues[field] = val;
          hasManual = true;
        }
      }
    }
    if (hasManual) {
      manualMap[contentId] = manualValues;
    }
  }

  return manualMap;
}

function writeToLifecycleScoresSheet_(scoredProfiles, options) {
  options = options || {};
  var dryRun = options.dryRun || false;
  var runId = options.runId || '';
  var scoredAt = new Date().toISOString();
  var snapshotDate = new Date().toISOString().split('T')[0];

  if (dryRun) {
    Logger.log('[DRY RUN] Would write ' + scoredProfiles.length + ' rows to Lifecycle_Scores.');
    for (var d = 0; d < Math.min(5, scoredProfiles.length); d++) {
      Logger.log('[DRY RUN] Row ' + (d + 1) + ': ' + scoredProfiles[d].content_id + ' | ' +
        scoredProfiles[d].title + ' | Quality: ' + scoredProfiles[d].quality_score_abs +
        ' | Recommendation: ' + scoredProfiles[d].lifecycle_recommendation);
    }
    return { written: 0, dryRun: true };
  }

  var sheet = getOrCreateLifecycleSheet_();
  var headerMap = ensureLifecycleHeaders_(sheet);
  var manualMap = buildExistingManualReviewMap_(sheet, headerMap);

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }

  var numCols = sheet.getLastColumn();
  var outputRows = [];

  for (var i = 0; i < scoredProfiles.length; i++) {
    var p = scoredProfiles[i];
    var rowData = new Array(numCols).fill('');

    var fieldMap = {
      content_id: p.content_id,
      source_row_number: p.source_row_number,
      repo_number: p.repo_number,
      join_key: p.join_key,
      status: p.status,
      title: p.title,
      tdp: p.tdp,
      product: p.product,
      primary_product: p.primary_product,
      content_type: p.content_type,
      sales_tactic: p.sales_tactic,
      marketing_program: p.marketing_program,
      creation_link: p.creation_link,
      production_link: p.production_link,
      public_site_link: p.public_site_link,
      latest_prod_link: p.latest_prod_link,
      rhac_page: p.rhac_page,
      quality_score_abs: p.quality_score_abs,
      quality_grade: p.quality_grade,
      quality_title_score: p.quality_title_score,
      quality_description_score: p.quality_description_score,
      quality_workflow_specificity_score: p.quality_workflow_specificity_score,
      quality_metadata_completeness_score: p.quality_metadata_completeness_score,
      quality_cta_relevance_score: p.quality_cta_relevance_score,
      quality_audience_clarity_score: p.quality_audience_clarity_score,
      quality_score_reason: p.quality_score_reason,
      metadata_issues: p.metadata_issues,
      recommended_metadata_fixes: p.recommended_metadata_fixes,
      quality_rubric_version: LIFECYCLE_SCORING_CONFIG.RUBRIC_VERSION,
      quality_scored_at: scoredAt,
      quality_input_hash: p.input_hash,
      quality_tdp_rank: p.quality_tdp_rank,
      quality_tdp_percentile: p.quality_tdp_percentile,
      quality_portfolio_rank: p.quality_portfolio_rank,
      quality_portfolio_percentile: p.quality_portfolio_percentile,
      overlap_score: p.overlap_score,
      overlap_type: p.overlap_type,
      overlap_scope: p.overlap_scope,
      overlap_cluster_id: p.overlap_cluster_id,
      overlap_with_ids: p.overlap_with_ids,
      overlap_reason: p.overlap_reason,
      primary_candidate_id: p.primary_candidate_id,
      duplicate_risk_level: p.duplicate_risk_level,
      overlap_review_priority: p.overlap_review_priority,
      lifecycle_recommendation: p.lifecycle_recommendation,
      lifecycle_priority_score: p.lifecycle_priority_score,
      lifecycle_priority: p.lifecycle_priority,
      lifecycle_confidence: p.lifecycle_confidence,
      lifecycle_reason: p.lifecycle_reason,
      recommended_owner: p.recommended_owner || '',
      review_due_quarter: p.review_due_quarter,
      scoring_model: LIFECYCLE_SCORING_CONFIG.SCORING_MODEL,
      scoring_provider: LIFECYCLE_SCORING_CONFIG.SCORING_PROVIDER,
      scoring_prompt_version: LIFECYCLE_SCORING_CONFIG.PROMPT_VERSION,
      scoring_run_id: runId,
      scored_at: scoredAt,
      input_hash: p.input_hash,
      source_snapshot_date: snapshotDate,
      source_row_hash: p.source_row_hash
    };

    var fieldKeys = Object.keys(fieldMap);
    for (var f = 0; f < fieldKeys.length; f++) {
      var col = headerMap[fieldKeys[f]];
      if (col !== undefined) {
        rowData[col] = fieldMap[fieldKeys[f]];
      }
    }

    var existingManual = manualMap[p.content_id];
    if (existingManual) {
      var manualKeys = Object.keys(existingManual);
      for (var mk = 0; mk < manualKeys.length; mk++) {
        var manualCol = headerMap[manualKeys[mk]];
        if (manualCol !== undefined) {
          rowData[manualCol] = existingManual[manualKeys[mk]];
        }
      }
    }

    outputRows.push(rowData);
  }

  if (outputRows.length > 0) {
    sheet.getRange(2, 1, outputRows.length, numCols).setValues(outputRows);
  }

  Logger.log('Wrote ' + outputRows.length + ' rows to Lifecycle_Scores.');
  return { written: outputRows.length, dryRun: false };
}
```

- [ ] **Step 2: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add Lifecycle_Scores sheet writeback with manual review preservation"
```

---

### Task 9: Validation and Run Summary

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: Build result from `buildContentProfiles_()`, scored profiles array, write result
- Produces: `buildRunSummary_(buildResult, scoredProfiles, writeResult, errors, runId)` → returns summary object with all validation counts

- [ ] **Step 1: Add validation and summary function**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   VALIDATION & SUMMARY
========================= */

function buildRunSummary_(buildResult, scoredProfiles, writeResult, runErrors, runId) {
  var profiles = buildResult.profiles;
  var missingTitle = profiles.filter(function(p) { return !p.title; }).length;
  var missingTdp = profiles.filter(function(p) { return !p.tdp; }).length;
  var missingProduct = profiles.filter(function(p) { return !p.product && !p.primary_product; }).length;
  var missingContentId = profiles.filter(function(p) { return !p.content_id; }).length;

  var contentIds = profiles.map(function(p) { return p.content_id; });
  var idCounts = {};
  var duplicateContentIds = 0;
  for (var i = 0; i < contentIds.length; i++) {
    idCounts[contentIds[i]] = (idCounts[contentIds[i]] || 0) + 1;
  }
  var idKeys = Object.keys(idCounts);
  for (var k = 0; k < idKeys.length; k++) {
    if (idCounts[idKeys[k]] > 1) duplicateContentIds++;
  }

  var recommendationCounts = {};
  var gradeCounts = {};
  var riskCounts = {};

  for (var j = 0; j < scoredProfiles.length; j++) {
    var rec = scoredProfiles[j].lifecycle_recommendation || 'Unknown';
    recommendationCounts[rec] = (recommendationCounts[rec] || 0) + 1;

    var grade = scoredProfiles[j].quality_grade || 'Unknown';
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;

    var risk = scoredProfiles[j].duplicate_risk_level || 'none';
    riskCounts[risk] = (riskCounts[risk] || 0) + 1;
  }

  var avgQuality = scoredProfiles.length > 0
    ? Math.round(scoredProfiles.reduce(function(sum, p) { return sum + (p.quality_score_abs || 0); }, 0) / scoredProfiles.length)
    : 0;

  return {
    run_id: runId,
    timestamp: new Date().toISOString(),
    source_rows_read: profiles.length,
    content_profiles_generated: profiles.length,
    scores_generated: scoredProfiles.length,
    rows_written: writeResult ? writeResult.written : 0,
    dry_run: writeResult ? writeResult.dryRun : false,
    missing_content_id: missingContentId,
    duplicate_content_id: duplicateContentIds,
    missing_title: missingTitle,
    missing_tdp: missingTdp,
    missing_product: missingProduct,
    build_errors: buildResult.errors.length,
    run_errors: runErrors.length,
    errors: buildResult.errors.concat(runErrors),
    average_quality_score: avgQuality,
    recommendation_distribution: recommendationCounts,
    grade_distribution: gradeCounts,
    risk_distribution: riskCounts,
    scoring_model: LIFECYCLE_SCORING_CONFIG.SCORING_MODEL,
    rubric_version: LIFECYCLE_SCORING_CONFIG.RUBRIC_VERSION
  };
}
```

- [ ] **Step 2: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add validation summary builder for lifecycle scoring runs"
```

---

### Task 10: Main Pipeline Orchestrator and Public Entry Points

**Files:**
- Modify: `RM_LifecycleScoring.js` (append)

**Interfaces:**
- Consumes: All previously built functions
- Produces: `runLifecycleScoringPipeline_(options)` (private orchestrator), `runLifecycleScoringTest()` (public, 10 rows), `runLifecycleScoringFull()` (public, all rows), `refreshLifecycleScoresTab()` (public, alias), `clearGeneratedScoresOnly()` (public, clears generated fields only), `getLifecycleScoringRunSummary()` (public, returns last run summary)

- [ ] **Step 1: Add pipeline orchestrator**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   PIPELINE ORCHESTRATOR
========================= */

function generateRunId_() {
  var now = new Date();
  var ts = now.getFullYear().toString() +
    ('0' + (now.getMonth() + 1)).slice(-2) +
    ('0' + now.getDate()).slice(-2) + '-' +
    ('0' + now.getHours()).slice(-2) +
    ('0' + now.getMinutes()).slice(-2) +
    ('0' + now.getSeconds()).slice(-2);
  return 'LS-' + ts;
}

function runLifecycleScoringPipeline_(options) {
  options = options || {};
  var limit = options.limit || 0;
  var dryRun = options.dryRun || false;
  var runId = generateRunId_();
  var runErrors = [];

  Logger.log('=== Lifecycle Scoring Pipeline ===');
  Logger.log('Run ID: ' + runId);
  Logger.log('Mode: ' + (limit > 0 ? 'test (' + limit + ' rows)' : 'full'));
  Logger.log('Dry run: ' + dryRun);

  Logger.log('Phase 1: Building content profiles...');
  var buildResult = buildContentProfiles_({ limit: limit });
  Logger.log('  Profiles: ' + buildResult.profiles.length + ', Errors: ' + buildResult.errors.length);

  if (buildResult.profiles.length === 0) {
    Logger.log('No profiles to score. Aborting.');
    return buildRunSummary_(buildResult, [], null, runErrors, runId);
  }

  Logger.log('Phase 2: Scoring quality...');
  var scoredProfiles = [];
  for (var i = 0; i < buildResult.profiles.length; i++) {
    var profile = buildResult.profiles[i];
    try {
      var qualityResult = scoreQuality_(profile);
      var keys = Object.keys(qualityResult);
      for (var k = 0; k < keys.length; k++) {
        profile[keys[k]] = qualityResult[keys[k]];
      }
      scoredProfiles.push(profile);
    } catch (e) {
      runErrors.push('Quality scoring failed for ' + profile.content_id + ': ' + e.message);
      profile.quality_score_abs = 0;
      profile.quality_grade = 'Error';
      scoredProfiles.push(profile);
    }
  }
  Logger.log('  Scored: ' + scoredProfiles.length);

  Logger.log('Phase 3: Computing relative ranks...');
  computeRelativeRanks_(scoredProfiles);

  Logger.log('Phase 4: Detecting same-TDP overlap...');
  detectSameTdpOverlap_(scoredProfiles);

  Logger.log('Phase 5: Running global duplicate check...');
  runGlobalDuplicateCheck_(scoredProfiles);

  Logger.log('Phase 6: Generating lifecycle recommendations...');
  for (var j = 0; j < scoredProfiles.length; j++) {
    try {
      var lifecycleResult = generateLifecycleRecommendation_(scoredProfiles[j]);
      var lKeys = Object.keys(lifecycleResult);
      for (var lk = 0; lk < lKeys.length; lk++) {
        scoredProfiles[j][lKeys[lk]] = lifecycleResult[lKeys[lk]];
      }
    } catch (e) {
      runErrors.push('Lifecycle recommendation failed for ' + scoredProfiles[j].content_id + ': ' + e.message);
      scoredProfiles[j].lifecycle_recommendation = 'Needs human review';
      scoredProfiles[j].lifecycle_reason = 'Error: ' + e.message;
    }
  }

  Logger.log('Phase 7: Writing to Lifecycle_Scores...');
  var writeResult = writeToLifecycleScoresSheet_(scoredProfiles, {
    dryRun: dryRun,
    runId: runId
  });
  Logger.log('  Written: ' + writeResult.written + ' (dryRun: ' + writeResult.dryRun + ')');

  var summary = buildRunSummary_(buildResult, scoredProfiles, writeResult, runErrors, runId);
  Logger.log('=== Pipeline Complete ===');
  Logger.log('Summary: ' + JSON.stringify(summary, null, 2));

  try {
    var cache = CacheService.getScriptCache();
    cache.put('LIFECYCLE_LAST_SUMMARY', JSON.stringify(summary), 3600);
  } catch (e) {
    Logger.log('Could not cache summary: ' + e.message);
  }

  return summary;
}
```

- [ ] **Step 2: Add public entry points**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   PUBLIC ENTRY POINTS
========================= */

function runLifecycleScoringTest() {
  return runLifecycleScoringPipeline_({
    limit: LIFECYCLE_SCORING_CONFIG.TEST_ROW_LIMIT,
    dryRun: false
  });
}

function runLifecycleScoringFull() {
  return runLifecycleScoringPipeline_({
    limit: 0,
    dryRun: false
  });
}

function runLifecycleScoringDryRun() {
  return runLifecycleScoringPipeline_({
    limit: 0,
    dryRun: true
  });
}

function refreshLifecycleScoresTab() {
  return runLifecycleScoringFull();
}

function getLifecycleScoringRunSummary() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('LIFECYCLE_LAST_SUMMARY');
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  return { message: 'No recent scoring run found. Run scoring first.' };
}

function clearGeneratedScoresOnly() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LIFECYCLE_SCORING_CONFIG.SHEET_NAME);
  if (!sheet) {
    Logger.log('Lifecycle_Scores tab not found.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('No data rows to clear.');
    return;
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });

  var dataRows = lastRow - 1;

  for (var i = 0; i < headers.length; i++) {
    if (MANUAL_REVIEW_FIELDS.indexOf(headers[i]) === -1 && headers[i]) {
      sheet.getRange(2, i + 1, dataRows, 1).clearContent();
    }
  }

  Logger.log('Cleared generated scores from Lifecycle_Scores. Manual review fields preserved.');
}
```

- [ ] **Step 3: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add lifecycle scoring pipeline orchestrator and public entry points"
```

---

### Task 11: Extend onOpen Menu

**Files:**
- Modify: `RM_Lifecycle.js:271-287` (the `onOpen()` function)

**Interfaces:**
- Consumes: Public functions from `RM_LifecycleScoring.js`: `runLifecycleScoringTest()`, `runLifecycleScoringFull()`, `refreshLifecycleScoresTab()`, `clearGeneratedScoresOnly()`
- Produces: Updated `onOpen()` with `Lifecycle Management` submenu added to existing `Lifecycle` menu

- [ ] **Step 1: Add Lifecycle Management submenu to onOpen**

In `RM_Lifecycle.js`, replace the `onOpen()` function (lines 271-287) with:

```javascript
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Lifecycle')
    .addItem('Pull Metrics from Databricks', 'pullMetricsFromDatabricks')
    .addItem('Run Lifecycle Scoring', 'runLifecycleScoring')
    .addSeparator()
    .addItem('Apply Claude Results', 'applyClaudeResults')
    .addItem('Export for Claude Analysis', 'exportForClaudeAnalysis')
    .addSeparator()
    .addSubMenu(ui.createMenu('Lifecycle Management')
      .addItem('Run lifecycle scoring test (10 rows)', 'runLifecycleScoringTest')
      .addItem('Run lifecycle scoring full', 'runLifecycleScoringFull')
      .addItem('Refresh Lifecycle_Scores tab', 'refreshLifecycleScoresTab')
      .addItem('Open scoring summary', 'openLifecycleScoringRunSummary_')
      .addItem('Clear generated scores only', 'clearGeneratedScoresOnly'))
    .addSeparator()
    .addItem('Open Dashboard', 'openLifecycleDashboard_')
    .addSeparator()
    .addSubMenu(ui.createMenu('Clear Data')
      .addItem('Clear Metrics', 'clearMetricsData')
      .addItem('Clear Lifecycle Scores', 'clearLifecycleData')
      .addItem('Clear Claude Results', 'clearClaudeResults'))
    .addToUi();
}
```

- [ ] **Step 2: Add the summary dialog opener to RM_LifecycleScoring.js**

Append to `RM_LifecycleScoring.js`:

```javascript
function openLifecycleScoringRunSummary_() {
  var summary = getLifecycleScoringRunSummary();
  var html = HtmlService.createHtmlOutput(
    '<pre style="font-family:monospace;font-size:13px;padding:16px;">' +
    JSON.stringify(summary, null, 2).replace(/</g, '&lt;') +
    '</pre>'
  ).setWidth(700).setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'Lifecycle Scoring Summary');
}
```

- [ ] **Step 3: Verify syntax on both files and commit**

```bash
node -c RM_Lifecycle.js
node -c RM_LifecycleScoring.js
git add RM_Lifecycle.js RM_LifecycleScoring.js
git commit -m "feat: add Lifecycle Management submenu to sheet menu"
```

---

### Task 12: Local JSON Debug Output

**Files:**
- Modify: `RM_LifecycleScoring.js` (modify `runLifecycleScoringPipeline_` to save JSON outputs)

Note: Google Apps Script has no local filesystem — `data/*.json` files are for local development with `clasp pull`. This task adds a function that writes debug data to a `Lifecycle_Debug` sheet tab as a workaround, and provides local export instructions.

**Interfaces:**
- Consumes: Content profiles, scored profiles, run summary, errors
- Produces: `exportLifecycleDebugData_()` writes to a `Lifecycle_Debug` sheet tab. Documentation for local JSON export.

- [ ] **Step 1: Add debug export function**

Append to `RM_LifecycleScoring.js`:

```javascript
/* =========================
   DEBUG / EXPORT
========================= */

function exportLifecycleDebugData() {
  var summary = getLifecycleScoringRunSummary();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var debugSheet = ss.getSheetByName('Lifecycle_Debug');

  if (debugSheet) {
    debugSheet.clear();
  } else {
    debugSheet = ss.insertSheet('Lifecycle_Debug');
  }

  debugSheet.getRange(1, 1).setValue('Section');
  debugSheet.getRange(1, 2).setValue('JSON Data');
  debugSheet.getRange(1, 1, 1, 2).setFontWeight('bold');

  debugSheet.getRange(2, 1).setValue('scoring_run_summary');
  debugSheet.getRange(2, 2).setValue(JSON.stringify(summary));

  var scoresSheet = ss.getSheetByName(LIFECYCLE_SCORING_CONFIG.SHEET_NAME);
  if (scoresSheet && scoresSheet.getLastRow() > 1) {
    var headers = scoresSheet.getRange(1, 1, 1, scoresSheet.getLastColumn()).getValues()[0];
    var data = scoresSheet.getRange(2, 1, scoresSheet.getLastRow() - 1, scoresSheet.getLastColumn()).getValues();
    var records = data.map(function(row) {
      var obj = {};
      for (var i = 0; i < headers.length; i++) {
        if (headers[i]) obj[String(headers[i]).trim()] = row[i];
      }
      return obj;
    });

    var CHUNK_SIZE = 50;
    for (var c = 0; c < records.length; c += CHUNK_SIZE) {
      var chunk = records.slice(c, c + CHUNK_SIZE);
      var rowNum = 3 + Math.floor(c / CHUNK_SIZE);
      debugSheet.getRange(rowNum, 1).setValue('lifecycle_scores_' + (c + 1) + '_to_' + Math.min(c + CHUNK_SIZE, records.length));
      debugSheet.getRange(rowNum, 2).setValue(JSON.stringify(chunk));
    }
  }

  Logger.log('Debug data exported to Lifecycle_Debug tab.');
}
```

- [ ] **Step 2: Verify syntax and commit**

```bash
node -c RM_LifecycleScoring.js
git add RM_LifecycleScoring.js
git commit -m "feat: add lifecycle debug data export to Lifecycle_Debug tab"
```

---

### Task 13: Clasp Push and Deployment Verification

**Files:**
- No new files — deployment of existing changes

**Interfaces:**
- Consumes: All files created/modified in Tasks 1-12
- Produces: Files pushed to Apps Script via clasp

- [ ] **Step 1: Verify clasp status**

```bash
clasp status
```

Expected: Shows tracked files including `RM_LifecycleScoring.js`.

- [ ] **Step 2: Review changed files**

```bash
git diff --stat HEAD~12
```

Expected: Shows `RM_LifecycleScoring.js` (new) and `RM_Lifecycle.js` (modified).

- [ ] **Step 3: Validate syntax of all changed files**

```bash
node -c RM_LifecycleScoring.js
node -c RM_Lifecycle.js
```

Expected: No syntax errors.

- [ ] **Step 4: Show user the change summary and push**

Show the user: files changed, new functions added, what the menu will look like.

```bash
clasp push
```

If auth fails, tell the user to run:
```bash
clasp login
```

- [ ] **Step 5: Test from Apps Script editor**

After `clasp push`, open the Apps Script editor:
```bash
clasp open
```

Run `runLifecycleScoringTest()` from the editor. Verify:
1. `Lifecycle_Scores` tab is created with 67 column headers
2. 10 rows of data are written
3. No script errors in the execution log

- [ ] **Step 6: Test full run from sheet menu**

1. Open the Google Sheet
2. Reload to trigger `onOpen()`
3. Go to Lifecycle → Lifecycle Management → Run lifecycle scoring test (10 rows)
4. Verify the `Lifecycle_Scores` tab shows results
5. Go to Lifecycle → Lifecycle Management → Open scoring summary
6. Verify the summary modal displays

---

## Deliverables Summary

### Files Changed
| File | Action | Purpose |
|------|--------|---------|
| `RM_LifecycleScoring.js` | **Created** | Complete lifecycle scoring pipeline (content profiles, quality scoring, overlap detection, duplicate hygiene, lifecycle recommendations, sheet writeback, validation, debug export) |
| `RM_Lifecycle.js` | **Modified** | `onOpen()` updated to add Lifecycle Management submenu |

### New Functions
| Function | Public/Private | Purpose |
|----------|---------------|---------|
| `runLifecycleScoringTest()` | Public | Run pipeline on first 10 rows |
| `runLifecycleScoringFull()` | Public | Run pipeline on all rows |
| `runLifecycleScoringDryRun()` | Public | Run pipeline without writing |
| `refreshLifecycleScoresTab()` | Public | Alias for full run |
| `getLifecycleScoringRunSummary()` | Public | Returns cached last-run summary |
| `clearGeneratedScoresOnly()` | Public | Clears generated fields, preserves manual review |
| `exportLifecycleDebugData()` | Public | Exports debug data to Lifecycle_Debug tab |
| `openLifecycleScoringRunSummary_()` | Private | Opens summary in modal dialog |
| `buildContentProfiles_(options)` | Private | Builds content profiles from Request_Master |
| `scoreQuality_(profile)` | Private | 100-point rubric quality scoring |
| `computeRelativeRanks_(profiles)` | Private | TDP and portfolio ranking |
| `detectSameTdpOverlap_(profiles)` | Private | Same-TDP Jaccard overlap detection |
| `runGlobalDuplicateCheck_(profiles)` | Private | Global link/title duplicate check |
| `generateLifecycleRecommendation_(profile)` | Private | Rule-based lifecycle recommendation |
| `writeToLifecycleScoresSheet_(profiles, options)` | Private | Upsert to Lifecycle_Scores tab |
| `buildRunSummary_(...)` | Private | Validation summary builder |
| Plus ~15 private helpers | Private | ID generation, hashing, text similarity, scoring sub-functions |

### How to Run
- **Test mode:** Lifecycle menu → Lifecycle Management → Run lifecycle scoring test (10 rows)
- **Full mode:** Lifecycle menu → Lifecycle Management → Run lifecycle scoring full
- **From editor:** Run `runLifecycleScoringTest()` or `runLifecycleScoringFull()`
- **Dry run:** Run `runLifecycleScoringDryRun()` from editor
- **Push with clasp:** `clasp push` (run `clasp login` if auth fails)

### Assumptions
1. `ENHANCED_CONFIG.COLUMNS` includes `LATEST_PROD_LINK`; if not, the code falls back to the raw header string `'Latest Prod Link'`.
2. Column headers `'Demo Description'`, `'Demo Description (Gemni generated)'`, `'SEODescription'`, `'Duration'` exist as raw headers in Request_Master.
3. The `onOpen()` function in `RM_Lifecycle.js` is the authoritative menu creator (it was confirmed by reading the file).
4. Quality scoring is deterministic (heuristic-based), not AI-powered, for this MVP.
5. Future scoring models (Claude, Gemini, RCARS) can be swapped by changing `LIFECYCLE_SCORING_CONFIG.SCORING_MODEL` and providing an alternative to `scoreQuality_()`.
