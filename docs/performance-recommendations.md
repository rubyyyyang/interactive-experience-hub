# Performance Recommendations: Current Logic and Review Guidelines

Explanatory guide for the Interactive Experience Hub performance recommendation system.

This documents **current implementation**, not formally approved business policy.

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

**Step 1: Parse metrics** — Active Months, Players, ppm, Completions, CR, MT values, L90 data, Page URL, Metrics Mapping Status

**Step 2: Compute signals** — Usage level (HIGH/BASE/BELOW), CR level (HIGH/BASE/BELOW/LOW), MT level (HIGH/BASE/BELOW/NONE), Active Months level (ESTABLISHED/NEW/STALLED/INACTIVE), Recovery check

**Step 3: Apply first-match recommendation rules** — First matching rule wins, one recommendation per demo

**Step 4: Write results** — Performance Signals, Flags, Recommended action, Priority, Score, Tier, Trend, Content Age, Action Status

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
- BASELINE: 15-24 ppm
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
- BASELINE: 40-49%
- BELOW: 20-39%
- LOW: <20%

**Flag-specific requirements**:
- **High engagement flag**: ≥50% CR AND ≥25 completions
- **Low completion flag**: ≥25 total players AND CR <40%

### Business Impact (MT)

**All-time MT Opportunity Value** and **All-time MT Won Value**

**MT thresholds**:
- HIGH: ≥$100K opportunity OR ≥$25K won
- BASELINE: $50K-$99K opportunity OR $10K-$24K won
- BELOW: >$0 but below thresholds
- NONE: $0 opportunity AND $0 won

**Metrics Mapping Status**:
- **"Shared display-key"**: Valid mapping
- **"Missing redhat.com page mapping"**: Valid row, but blocks **Low opportunity value** flag and **Boost sales impact** action (both require `mtMappingValid = true`)
- **"Unlinked request"**: Row marked "Needs review"

### Content Age

**Content Age**: Months since earliest available timestamp

**Calculation** (line 234 in RM_Performance.js):
```javascript
var originDate = receivedTs || publishedTs;  // Status Received Timestamp checked first
```

**Content Age thresholds**:
- NEW: ≤3 months
- RECENT: 4-12 months
- MATURE: >12 months

**Used for**:
- Retirement condition: Content Age >3 months (not NEW) with zero activity and MT = $0 → `Consider retirement`
- Priority bump: MATURE content (>12 months) with actionable recommendation → Medium priority

**Note**: Content Age (lifecycle timestamp) is distinct from Active Months level (activity pattern).

### Performance Trends (L90)

**L90 ppm**: L90 Players ÷ 3 months

**Trend categories**:
- **Growing**: L90 ppm ≥ 120% of all-time ppm AND L90 ppm ≥ 7.5
- **Stable**: L90 ppm ≥ 50% of all-time ppm
- **Declining**: L90 ppm < 50% of all-time ppm
- **Stale**: No L90 data AND last activity >6 months ago
- **Unknown**: No L90 data, last activity within 6 months OR all-time ppm = 0

**Recovery signal** (ESTABLISHED content with 0/3 all-time signals):
- L90 ppm ≥15 OR L90 CR ≥40% (≥5 L90 completions) OR L90 MT ≥$12.5K opp OR ≥$2.5K won
- Recovery active → `No action needed` (overrides retirement)

### Page Availability

**Has demo-specific page**: Drupal Page URL is a demo-specific redhat.com page (not generic listing, not arcade.redhat.com)

**Page detection**:
- Demo-specific: `redhat.com/en/interactive-experiences/my-demo` → TRUE
- Generic listing: `redhat.com/en/interactive-experiences` → FALSE
- Arcade URL: `arcade.redhat.com/...` → FALSE

---

## How Recommendations Are Selected

### First-Match Rule Precedence

Recommendations use **first-match precedence**. Rules checked in order, first match wins.

**Rule order**:
1. **Review data linkage** — No activity + MT value >$0
2. **Boost sales impact** — (High usage OR High completion) + page + valid mapping + MT Won <$10K
3. **Improve completion** — (High usage + Low CR OR Base usage + page + Low CR) AND NOT NEW
4. **Create page** — (High usage OR High CR OR High MT OR Niche) + no page
5. **Increase visibility** — Niche + page OR Low usage + (High/Base CR) OR 3/3 signals + declining/stale
6. **Consider retirement** — Low activity (0/3 signals, no recovery) OR No activity (Content Age >3 mo, MT=$0) OR STALLED + low usage + low MT
7. **Needs review** — Missing data or ineligible status
8. **No action needed** — Default (strong performance, NEW content, or recovery active)

### Recommendation Table

| Recommendation | Assigned | Conditions | Notes |
|----------------|----------|------------|-------|
| **Review data linkage** | Admin | No activity + MT >$0 | Data integrity check |
| **Boost sales impact** | Admin | (High usage OR High CR) + page + valid mapping + MT Won <$10K | Requires mtMappingValid |
| **Improve completion** | Creator | (High usage + Low CR OR Base usage + page + Low CR) AND NOT NEW | NEW excluded |
| **Create page** | Admin | (High usage OR High CR OR High MT OR Niche) + no page | Performing content needs page |
| **Increase visibility** | Admin | Niche + page OR Low usage + good CR OR 3/3 + declining/stale | Good content, needs distribution |
| **Consider retirement** | Creator | (1) ESTABLISHED + 0/3 + no recovery OR (2) Content Age >3 + no activity + MT=$0 OR (3) STALLED + low usage + low MT | Flagged for review |
| **Needs review** | Admin | Missing data or edge case | System cannot classify |
| **No action needed** | — | All other cases | Strong performance, NEW, or recovery |

**Assigned field**:
- Creator actions: `Improve completion`, `Consider retirement`
- Admin actions: `Create page`, `Increase visibility`, `Review data linkage`, `Boost sales impact`, `Needs review`
- No action needed: Assigned field empty

### Priority Calculation

**Priority rules** (line 688-703 in RM_Performance.js):
- NEW content (`activeMonth.level === 'NEW'`) → Always `Low`
- No action needed → Always `Low`
- 2+ HIGH signals → `High`
- Declining/stale trend + ≥1 signal → `High`
- 1 HIGH signal → `Medium`
- Declining/stale trend (no meaningful signals) → `Medium`
- MATURE Content Age (>12 months) → `Medium`
- Default → `Low`
- **Priority cap**: Low-tier demos (score <40) cap High → Medium

---

## Practical Examples

### Example 1: High Usage + Low CR → Improve Completion

**Metrics**:
- Active Months: 10 (ESTABLISHED), Total Players: 300, ppm: 30 (HIGH)
- CR: 18% (LOW), Completions: 54
- MT Opportunity: $5K (BELOW), Has Page: No

**Signals**: Usage HIGH, CR LOW, MT BELOW → 1/3 (usage only, HIGH count = 1)

**Flags**: `High usage`, `Low completion`

**Recommendation**: **Improve completion** (Priority: Medium, Assigned: Creator)

**Why**: High traffic signals value. Fix completion, don't retire.

---

### Example 2: Low Usage + High CR → Increase Visibility

**Metrics**:
- Active Months: 8 (ESTABLISHED), Total Players: 96, ppm: 12 (BELOW)
- CR: 55% (HIGH), Completions: 53
- MT Opportunity: $15K (BELOW), MT Won: $0, Has Page: Yes
- Metrics Mapping Status: "Shared display-key"

**Signals**: Usage BELOW, CR HIGH, MT BELOW → 1/3 (CR only, HIGH count = 1)

**Flags**: `High engagement`

**Recommendation**: **Increase visibility** (Priority: Medium, Assigned: Admin)

**Why**: HIGH CR signals quality. Low usage does NOT mean retirement when engagement is strong.

---

### Example 3: Niche (High MT) → Increase Visibility

**Metrics**:
- Active Months: 12 (ESTABLISHED), Total Players: 96, ppm: 8 (BELOW)
- CR: 35% (BELOW), Completions: 34
- MT Opportunity: $120K (HIGH), MT Won: $5K (BELOW), Has Page: Yes

**Signals**: Usage BELOW, CR BELOW, MT HIGH → 1/3 (MT only, HIGH count = 1)

**Flags**: `High business impact`, `High-value niche`, `Low completion`

**Recommendation**: **Increase visibility** (Priority: Medium, Assigned: Admin)

**Why**: HIGH MT justifies low traffic. Niche demo, not retirement.

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
- `parseMetrics_()` — Parses metrics from row data
- `computePerformanceSignals_()` — Computes usage/CR/MT levels and Active Months level
- `computePerformanceFlags_()` — Generates performance flags
- `computePerformanceAction_()` — First-match rule precedence
- `computePerformancePriority_()` — Priority assignment
- `computePerformanceScore_()`, `computePerformanceTier_()`, `computePerformanceTrend_()`

**Thresholds**: `PERF_THRESHOLDS` (lines 64-79), `CREATOR_ACTIONS_` (line 43), `ADMIN_ACTIONS_` (line 44)

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
- Content Age >3 months (not NEW) + no activity + MT = $0 → `Consider retirement`
- STALLED + low usage + low MT → `Consider retirement`

**Recovery overrides retirement**: ESTABLISHED content with 0/3 all-time signals but L90 recovery → `No action needed`

**Missing page mapping**: Blocks Low opportunity value flag AND Boost sales impact action (both require `mtMappingValid`)

**Priority cap**: Low-tier demos (score <40) cap High → Medium

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
