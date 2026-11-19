# Performance Recommendations: Current Logic and Review Guidelines

Explanatory guide for the Interactive Experience Hub performance recommendation system.

This documents **current implementation**, not formally approved business policy.

---

## Architecture Diagram

![Performance Recommendation Engine Architecture](assets/performance-engine-diagram.svg)

The diagram shows how source data flows through validation, signal computation, first-match recommendation rules, and produces both recommendation outputs (action, priority, assigned) and diagnostic outputs (flags, score, tier).

---

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [What We Evaluate](#what-we-evaluate)
4. [How Recommendations Are Selected](#how-recommendations-are-selected)
5. [Practical Examples](#practical-examples)
6. [Human Review and Actions](#human-review-and-actions)
7. [Operational Details](#operational-details)

---

## Overview

### What the System Does

The performance recommendation system analyzes Interactive Experience usage, engagement, and business impact data to suggest actionable next steps for content lifecycle management.

**Output** (per eligible demo):
- **Performance Signals**: Usage level, completion rate, business value, activity maturity
- **Performance Flags**: High usage, Low completion, High business impact, etc.
- **Recommended action**: Improve completion, Increase visibility, Consider retirement, etc.
- **Action Priority**: High/Medium/Low urgency
- **Performance Score** (0-100), **Performance Tier** (Top/Mid/Low/Inactive), **Performance L90 Trend**

**Source**: [`RM_Performance.js`](../RM_Performance.js) — Run via Admin menu → "Run Performance Labels"

### What It Does NOT Do

- **Does not automatically retire content** — Recommendations flag content for human review
- **Does not approve business decisions** — Thresholds are implementation defaults, not board-approved policy
- **Does not replace human judgment** — Context and nuance require creator and admin input

### Recommendations vs. Lifecycle Changes

| System Recommendation | Human-Approved Lifecycle Action |
|----------------------|----------------------------------|
| **Recommended action**: `Consider retirement` | **Status**: `Retired` (after admin approval) |
| **Action Status**: `Action needed` | **Status**: `Published` → `Retired` (manual or via Status Tracker) |
| Written by `RM_Performance.js` | Written by Status Tracker or admin |

Recommendations do not automatically change **Status**. Admins can manually retire content directly. There is currently **no automatic retirement** triggered by creator non-response. A future grace-period automation is planned but not implemented.

---

## How It Works

### Where Performance Data Comes From

**All-time and L90 metrics** (manual workflow):
1. SQL query runs externally against Databricks
2. Results pasted into `All Time Metrics` sheet
3. Admin runs "Sync All-Time Metrics" from Admin menu
4. [`RH_AllTimeMetricsMap.js`](../RH_AllTimeMetricsMap.js) writes metrics to `Request_Master`

**YTD metrics** (automated workflow):
- [`RM_Metrics.js`](../RM_Metrics.js) retrieves year-to-date data via Databricks API

**Performance recommendations**:
- [`RM_Performance.js`](../RM_Performance.js) analyzes all-time and L90 metrics → writes recommendations

See [Hub Runbook](runbook.md#manual-metrics-refresh) for refresh procedures.

### Processing Flow

**Step 1: Row validation** — Skip ineligible rows (Retired, Closed, blank, Note="Delete row"). Check for required metrics presence.

**Step 2: Parse metrics** — Active Months, Players, ppm (players per month), Completions, CR (completion rate), MT values (All-time MT Opportunity Value and MT Won Value), L90 data (last 90 days), Page URL (Drupal Page URL + RHAC page), Metrics Mapping Status

**Step 3: Compute Performance Signals** — Usage level (HIGH/BASE/BELOW), CR level (HIGH/BASE/BELOW/LOW), MT level (HIGH/BASE/BELOW/NONE), Active Months level (ESTABLISHED/NEW/STALLED/INACTIVE), Page detection, MT mapping validity, Recovery check, L90 Trend, Content Age

**Step 4: Apply first-match recommendation rules** — Recommendation rules evaluate **Performance Signals** (not Flags) using first-match precedence. First matching rule wins, one recommendation per demo.

**Step 5: Calculate diagnostic outputs** — Performance Flags (independent calculation from source metrics), Performance Score → Performance Tier

**Step 6: Calculate Action Priority** — Combines Signals, L90 Trend, and Content Age, with optional Tier-based priority cap

**Step 7: Write results** — Performance Signals, Flags, Recommended action, Recommended action reason, Action Priority, Performance Score, Performance Tier, Performance L90 Trend, Content Age, Assigned, Action Status, Processing Result

### Output Columns

**Request_Master columns** (auto-created if missing):
- Performance Signals, Performance Flags, Recommended action, Recommended action reason
- Action Priority, Performance Score, Performance Tier, Performance L90 Trend, Content Age
- Assigned (Creator/Admin), Action Status (Action needed → Pending review → Complete)
- Processing Result (audit trail: Processed/Skipped/Needs review)

**Action Status workflow**:
- System writes `Action needed` for actionable recommendations
- **Preserves** `Pending review`, `Follow-up needed`, `Complete`, `Resubmit required` during recalculation
- Status Tracker or manual review advances Action Status to terminal states

---

## What We Evaluate

### Usage and Active Months

**Players per month (ppm)**: All-time Players ÷ Active Months

**Usage thresholds**:
- HIGH: ≥25 ppm
- BASE: 15-24 ppm
- BELOW: <15 ppm

**Active Months level** (`activeMonth.level` in signals):
- **ESTABLISHED**: ≥4 active months
- **NEW**: 1-3 active months, first activity within last 3 months
- **STALLED**: 1-3 active months, first activity more than 3 months ago
- **INACTIVE**: 0 active months

NEW content is **excluded** from `Improve completion` action and always receives **Low** priority (even for other actions).

### Completion Rate

**Completion Rate**: All-time Completions ÷ All-time Players

**CR thresholds**:
- HIGH: ≥50%
- BASE: 40-49%
- BELOW: 20-39%
- LOW: <20%

**Minimum sample size for CR-dependent recommendations**:
- **25 Total Players** required for:
  - `Improve completion` paths that check for HIGH CR
  - `Boost sales impact` condition using HIGH CR
  - `Increase visibility` path checking HIGH/BASE CR
- Without 25+ players, CR-based conditions are skipped even if rate meets threshold

**Flag-specific requirements** (diagnostic, not used in recommendation rules):
- **High engagement flag**: ≥50% CR AND ≥25 completions
- **Low completion flag**: ≥25 total players AND CR <40%

### Business Impact (MT)

**All-time MT Opportunity Value** and **All-time MT Won Value**

**MT thresholds**:
- HIGH: ≥$100K opportunity OR ≥$25K won
- BASE: $50K-$99K opportunity OR $10K-$24K won
- BELOW: >$0 but below thresholds
- NONE: $0 opportunity AND $0 won

**Metrics Mapping Status**:
- **"Shared display-key"**: Valid mapping
- **"Missing redhat.com page mapping"**: Valid row, but blocks **Low opportunity value** flag and **Boost sales impact** action (both require `mtMappingValid = true`)
- **"Unlinked request"**: Row marked "Needs review"

### Content Age

**Content Age**: Months since first lifecycle timestamp

**Calculation** (line 234 in RM_Performance.js):
```javascript
var originDate = receivedTs || publishedTs;
```
Status Received Timestamp checked first; if unavailable, Status Published Timestamp.

**Content Age thresholds**:
- NEW: ≤3 months
- RECENT: 4-12 months
- MATURE: >12 months

**Calculation**:
```javascript
var originDate = receivedTs || publishedTs;
```
Status Received Timestamp checked first; if unavailable, Status Published Timestamp.

**Used for**:
- Retirement condition: Content Age >3 months (not NEW) with zero activity and MT = $0 → `Consider retirement`
- Priority bump: MATURE content (>12 months) with actionable recommendation → Medium priority

**Note**: Content Age (lifecycle timestamp) is distinct from Active Months level (activity pattern).

### Performance Trends (L90)

**L90 ppm**: L90 Players ÷ 3 months

**Trend categories**:
- **Growing**: L90 ppm ≥ 120% of all-time ppm AND L90 ppm ≥ 7.5
- **Stable**: L90 ppm ≥ 50% of all-time ppm
- **Declining**: L90 ppm < 50% of all-time ppm (OR no L90 data with known Last Activity Month and positive ppm)
- **Stale**: No L90 data AND last activity >6 months ago
- **Unknown**: (L90 data exists AND all-time ppm = 0) OR (no L90 data AND no Last Activity Month) OR (no L90 data AND Last Activity Month within 6 months AND all-time ppm = 0)

**Recovery signal** (ESTABLISHED content with 0/3 all-time signals):
- L90 ppm ≥15 OR L90 CR ≥40% (≥5 L90 completions) OR L90 MT ≥$12.5K opp OR ≥$2.5K won
- Recovery active → `No action needed` (overrides retirement)

### Page Availability

**Has demo-specific page**: Either **Drupal Page URL** OR **RHAC page** contains a demo-specific redhat.com page (not generic listing, not arcade.redhat.com)

**Page detection** (`hasDemoSpecificPage_()` applied to both columns):
- Demo-specific: `redhat.com/en/interactive-experiences/my-demo` → TRUE
- Demo-specific RHAC: `redhat.com/architect/portfolio/detail/57-...` → TRUE
- Generic listing: `redhat.com/en/interactive-experiences` → FALSE
- Arcade URL: `arcade.redhat.com/...` → FALSE

Page detection checks **both** `Drupal Page URL` and `RHAC page` columns. If either contains a valid demo-specific page, `hasContentSpecificPage` is TRUE.

---

## How Recommendations Are Selected

### First-Match Rule Precedence

Recommendations use **first-match precedence**. Rules are checked in order, first match wins, producing one recommendation per demo.

**Rule evaluation uses Performance Signals**, not Performance Flags. Flags are diagnostic outputs calculated independently from source metrics.

**Rule order** (`computePerformanceAction_()`):
1. **Review data linkage** — No activity + MT value >$0
2. **Improve completion** — (HIGH usage + LOW/BELOW CR AND NOT NEW) OR (ESTABLISHED + BASE usage + page + LOW/BELOW CR)
3. **Boost sales impact** — ESTABLISHED + page + valid mapping + (HIGH usage OR HIGH CR with 25+ players) + selected MT value <$10K
4. **Create page** — (HIGH usage OR HIGH MT OR High-value niche OR (HIGH CR with 25+ players AND NOT low activity)) + no page
5. **Increase visibility** — (High-value niche + page) OR (BELOW usage + (HIGH/BASE CR with 25+ players)) OR (3/3 signals + declining/stale trend)
6. **Consider retirement** — (ESTABLISHED + 0/3 signals + no recovery AND NOT HIGH CR AND NOT HIGH MT AND NOT niche) OR (no activity + Content Age >3 mo + MT = $0) OR (STALLED + BELOW usage + BELOW/NONE MT)
7. **Needs review** — Validation failure OR (no activity + Content Age unavailable)
8. **No action needed** — Default (all other cases)

### Recommendation Table

| Recommendation | Assigned | Conditions | Notes |
|----------------|----------|------------|-------|
| **Review data linkage** | Admin | No activity + MT >$0 | Data integrity check |
| **Improve completion** | Creator | (HIGH usage + LOW/BELOW CR AND NOT NEW) OR (ESTABLISHED + BASE usage + page + LOW/BELOW CR) | NEW excluded from HIGH usage branch only; no sample size check for HIGH usage path |
| **Boost sales impact** | Admin | ESTABLISHED + page + valid mapping + (HIGH usage OR HIGH CR with 25+ players) + selected MT value <$10K | Requires mtMappingValid; HIGH CR path requires 25+ Total Players |
| **Create page** | Admin | (HIGH usage OR HIGH MT OR High-value niche OR (HIGH CR with 25+ players AND NOT low activity)) + no page | HIGH CR path requires 25+ Total Players |
| **Increase visibility** | Admin | (High-value niche + page) OR (BELOW usage + (HIGH/BASE CR with 25+ players)) OR (3/3 signals + declining/stale trend) | CR path requires 25+ Total Players |
| **Consider retirement** | Creator | (1) ESTABLISHED + 0/3 signals + no recovery AND NOT HIGH CR AND NOT HIGH MT AND NOT niche OR (2) no activity + Content Age >3 mo + MT = $0 OR (3) STALLED + BELOW usage + BELOW/NONE MT | Flagged for review; HIGH CR/MT/niche exemptions apply to path 1 only |
| **Needs review** | Admin | Validation failure OR (no activity + Content Age unavailable) | classifyRow_() failures + computePerformanceAction_() edge case |
| **No action needed** | — | All other cases | Does not imply content passed quality review |

**Assigned field**:
- Creator actions: `Improve completion`, `Consider retirement`
- Admin actions: `Create page`, `Increase visibility`, `Review data linkage`, `Boost sales impact`, `Needs review`
- No action needed: Assigned field empty

### Priority Calculation

**Priority rules** (`computePerformancePriority_()`):
- NEW content (`activeMonth.level === 'NEW'`) → Always `Low`
- No action needed → Always `Low`
- 2+ HIGH signals → `High`
- Declining/stale trend + ≥1 signal → `High`
- 1 HIGH signal → `Medium`
- Declining/stale trend (no meaningful signals) → `Medium`
- MATURE Content Age (>12 months) → `Medium`
- Default → `Low`
- **Priority cap**: Performance Tier = Low caps High priority → Medium

Priority combines:
- **Signals** (count and highCount from Usage/CR/MT levels)
- **L90 Trend** (declining/stale increases priority)
- **Content Age** (MATURE bumps to Medium)
- **Recommended action** (No action needed → Low)
- **Performance Tier cap** (Low tier caps High → Medium)

---

## Practical Examples

### Example 1: High Usage + Low CR → Improve Completion

**Metrics**:
- Active Months: 10 (ESTABLISHED), Total Players: 300, ppm: 30 (HIGH)
- CR: 18% (LOW), Completions: 54
- MT Opportunity: $5K (BELOW), Has Page: No

**Signals**: Usage HIGH, CR LOW, MT BELOW → 1/3 (usage only, HIGH count = 1)

**Flags** (diagnostic): `High usage`, `Low completion`

**Recommendation**: **Improve completion** (Priority: Medium, Assigned: Creator)

**Why**: First-match rule hit: HIGH usage + LOW CR + NOT NEW. The recommendation rules evaluate **Signals** (not Flags). Flags are diagnostic outputs showing notable performance patterns.

---

### Example 2: Low Usage + High CR → Increase Visibility

**Metrics**:
- Active Months: 8 (ESTABLISHED), Total Players: 96, ppm: 12 (BELOW)
- CR: 55% (HIGH), Completions: 53
- MT Opportunity: $15K (BELOW), MT Won: $0, Has Page: Yes
- Metrics Mapping Status: "Shared display-key"

**Signals**: Usage BELOW, CR HIGH, MT BELOW → 1/3 (CR only, HIGH count = 1)

**Flags** (diagnostic): `High engagement`

**Recommendation**: **Increase visibility** (Priority: Medium, Assigned: Admin)

**Why**: First-match rule hit: BELOW usage + HIGH CR with 25+ Total Players. The 25-player sample size requirement is met (96 Total Players), so the HIGH CR signal is considered reliable for this recommendation.

---

### Example 3: Low Usage + High MT → Increase Visibility

**Metrics**:
- Active Months: 12 (ESTABLISHED), Total Players: 96, ppm: 8 (BELOW)
- CR: 35% (BELOW), Completions: 34
- MT Opportunity: $120K (HIGH), MT Won: $5K (BELOW), Has Page: Yes

**Signals**: Usage BELOW, CR BELOW, MT HIGH → 1/3 (MT only, HIGH count = 1)

**Flags**: `High business impact`, `High-value niche`, `Low completion`

**Recommendation**: **Increase visibility** (Priority: Medium, Assigned: Admin)

**Why**: `High-value niche` flag (ESTABLISHED + ppm <15 + MT ≥$50K opp OR ≥$10K won) justifies low traffic.

---

### Example 4: No Positive Signals → Consider Retirement

**Metrics**:
- Active Months: 6 (ESTABLISHED), Content Age: 18 months (MATURE)
- Total Players: 48, ppm: 8 (BELOW), CR: 23% (BELOW), Completions: 11
- MT Opportunity: $3K (BELOW), MT Won: $0, Has Page: No

**Signals**: Usage BELOW, CR BELOW, MT BELOW → 0/3 (HIGH count = 0)

**Flags**: `Low completion`

**Recommendation**: **Consider retirement** (Priority: Medium, Assigned: Creator)

**Why**: 0/3 signals, no recovery. MATURE Content Age triggers Medium priority. Flagged for review, **not automatic retirement**.

---

### Example 5: Recovery Active → No Action Needed

**Scenario**: ESTABLISHED content (10 active months) with 0/3 all-time signals but recent L90 improvement.

**Metrics**:
- Active Months: 10 (ESTABLISHED), Total Players: 120, ppm: 12 (BELOW)
- CR: 30% (BELOW), MT: $2K (BELOW)
- **L90 Players: 60 (L90 ppm = 20 ≥ 15 baseline)** → Recovery active

**Signals**: Usage BELOW, CR BELOW, MT BELOW → 0/3 all-time, but Recovery: Active

**Recommendation**: **No action needed** (Priority: Low)

**Why**: Recovery overrides retirement. L90 data shows improvement.

**Note**: Recovery applies only to **ESTABLISHED** content with 0/3 all-time signals. INACTIVE content (0 active months) uses different retirement rules.

---

## Human Review and Actions

### Creator Workflow (Status Tracker)

1. Creator views recommendation in Status Tracker
2. Selects response:
   - **Improve completion**: `Updated`, `Need help`
   - **Consider retirement**: `Updated`, `Keep active`, `Retire`, `Need help`
3. Optionally provides new Creation Link or notes
4. Submits → **Action Status** → `Pending review`
5. Admin reviews in Admin Review panel (creator-actionable recommendations only)
6. Admin approves or requests changes
7. If approved: **Action Status** → `Complete`; if retirement approved: **Status** → `Retired`

See [Intake Status Tracker Lifecycle Workflow](https://github.com/rubyyyyang/interactive-experience-intake/blob/main/docs/status-tracker-lifecycle.md) for complete workflow documentation.

### Admin Workflow

**Admin actions** (`Create page`, `Increase visibility`, `Review data linkage`, `Boost sales impact`, `Needs review`):
- Review recommendation in Request_Master
- Decide on next steps
- Manually update **Action Status** through direct sheet edit or other workflows
- Admin-owned recommendations are NOT managed through Status Tracker Admin Review panel

**Manual retirement**:
- Admin can manually change **Status** to `Retired` at any time
- No automatic retirement exists currently based on creator non-response
- **Future plan** (not implemented): Grace-period automation with automatic retirement after no response. Requirements (grace period duration, notifications, exceptions, approval flow) are not yet defined.

---

## Operational Details

### Source Functions

**Performance analysis engine**: [`RM_Performance.js`](../RM_Performance.js)
- `runPerformanceLabels()` — Main entry point
- `classifyRow_()` — Row classification (skipped/needs review/processed)
- `parseMetrics_()` — Parses metrics from row data, including page detection from both Drupal Page URL and RHAC page
- `computePerformanceSignals_()` — Computes usage/CR/MT levels, Active Months level, page/mapping signals, recovery, trend, content age
- `computePerformanceFlags_()` — Generates diagnostic performance flags independently from source metrics
- `computePerformanceAction_()` — First-match rule precedence (evaluates Signals, not Flags)
- `computePerformancePriority_()` — Priority assignment combining signals, trend, content age, and tier cap
- `computePerformanceScore_()` — Score (0-100) from signals, trend, maturity
- `computePerformanceTier_()` — Tier (Top/Mid/Low/Inactive) from score
- `computePerformanceTrend_()` — L90 trend (growing/stable/declining/stale/unknown)

**Configuration**:
- `PERF_THRESHOLDS` — Usage, CR, MT, trend, content age thresholds
- `CREATOR_ACTIONS_` — Actions assigned to creators
- `ADMIN_ACTIONS_` — Actions assigned to admins
- `PERF_LABEL_COLUMNS` — Output column names
- `PERF_METRIC_COLUMNS` — Source metric column names

**Test harness**: `testPerformanceRules()`, `testProcessingAudit()`

### Missing Data Handling

**Required metrics**: Active Months, Total Players, Completions, MT Opportunity, MT Won, Completion Rate (if Players >0), First Activity Month (if Active Months 1-3)

**Eligible status values**: "Published", "Demo Reviewed", "Demo Received", or blank

**Skipped**: "Retired", "Closed", blank rows, Note = "Delete row"

**Needs review**: Ineligible status, blank Number column, "Unlinked request", missing required metrics

**Special case**: Zero players → Completion Rate not required

### Recalculation Behavior

**When recalculation runs** (Admin menu → "Run Performance Labels"):
- All Request_Master rows reprocessed
- Performance fields recalculated: Signals, Flags, Recommended action, Priority, Score, Tier, Trend, Content Age
- **Action Status preserved** for: `Pending review`, `Follow-up needed`, `Complete`, `Resubmit required`
- **Action Status written** (`Action needed`) only when: not a preserved state AND actionable recommendation AND Assigned populated

**Why preservation matters**: Prevents recalculation from overwriting in-progress workflow states.

### Edge Cases

**Retirement conditions**:
- ESTABLISHED (≥4 active months) + 0/3 signals + no recovery → `Consider retirement`
- Active Months = 0 AND Total Players = 0 AND Content Age >3 months AND MT = $0 → `Consider retirement`
- STALLED + BELOW usage + BELOW/NONE MT → `Consider retirement`

**Recovery overrides retirement**: ESTABLISHED content with 0/3 all-time signals but L90 recovery → `No action needed`

**Missing page mapping**: Blocks Low opportunity value flag AND Boost sales impact action (both require `mtMappingValid`)

**Priority cap**: Performance Tier = Low caps High priority → Medium

### Validation Workflow

**Before modifying thresholds**:
1. Run `testPerformanceRules()` and `testProcessingAudit()` in Apps Script editor
2. Validate individual functions with sample data (read-only)
3. Document threshold change rationale

**Production recalculation** (explicit approval required):
- `runPerformanceLabels()` calls `getMasterSheet()` → writes to production Request_Master
- Preserves workflow states

**Important**:
- `runPerformanceLabels()` writes to production. Do not run without approval.
- `clearPerformanceLabels()` is destructive (clears Action Status, Assigned, Response)
- For validation, use unit tests or manual function calls with sample data

---

**Last updated**: 2026-11-16  
**Source version**: Current `main` branch implementation  
**Maintainer**: Hub development team

For operational procedures, see [Hub Runbook](runbook.md). For creator workflow, see [Intake Status Tracker Lifecycle Workflow](https://github.com/rubyyyyang/interactive-experience-intake/blob/main/docs/status-tracker-lifecycle.md).
