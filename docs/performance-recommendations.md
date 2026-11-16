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
6. [Human Review and Lifecycle Actions](#human-review-and-lifecycle-actions)
7. [Operational Details and Limitations](#operational-details-and-limitations)

---

## Overview

### What the Recommendation System Does

The performance recommendation system analyzes Interactive Experience usage, engagement, and business impact data to suggest actionable next steps for content lifecycle management.

**Output**: For each eligible demo, the system generates:
- **Performance Signals**: Structured metrics showing usage level, completion rate, business value, and maturity
- **Performance Flags**: Qualitative characteristics (High usage, Low completion, High business impact, etc.)
- **Recommended action**: One actionable next step (Improve completion, Increase visibility, Consider retirement, etc.)
- **Action Priority**: High/Medium/Low urgency based on signals and trends
- **Performance Score** (0-100): Composite measure combining all-time signals, recent trend, and content maturity
- **Performance Tier**: Top/Mid/Low/Inactive bucketing
- **Performance L90 Trend**: Growing/Stable/Declining/Stale based on recent activity

**Source**: [`RM_Performance.js`](../RM_Performance.js) — Run via Admin menu → "Run Performance Labels"

### What It Does NOT Do

- **Does not automatically retire content** — Recommendations flag content for human review
- **Does not approve business decisions** — Thresholds are implementation defaults, not board-approved policy
- **Does not replace human judgment** — Context and nuance require creator and admin input
- **Does not modify content** — System writes recommendations only; content changes are manual

### Difference Between Recommendations and Approved Lifecycle Changes

| System Recommendation | Human-Approved Lifecycle Action |
|----------------------|----------------------------------|
| **Recommended action** column: `Consider retirement` | **Status** column: `Retired` (after admin approval) |
| **Action Status**: `Action needed` → signals pending creator/admin review | **Status**: `Published` → `Retired` transition (manual or via Status Tracker approval) |
| Performance analysis suggests next step | Creator or admin executes next step |
| Written by `RM_Performance.js` | Written by Status Tracker or manual sheet edit |

---

## How It Works

### Where Performance Data Comes From

**All-time and L90 metrics** (manual workflow):
1. SQL query runs externally against Databricks
2. Results pasted into `All Time Metrics` sheet
3. Admin runs "Sync All-Time Metrics" from Admin menu
4. [`RH_AllTimeMetricsMap.js`](../RH_AllTimeMetricsMap.js) writes metrics to `Request_Master`

**YTD metrics** (automated workflow):
- Admin runs "Pull Metrics from Databricks" from Admin menu
- [`RM_Metrics.js`](../RM_Metrics.js) retrieves year-to-date data via Databricks API
- YTD columns updated in `Request_Master`

**Performance recommendations** (generated from all-time/L90 data):
- Admin runs "Run Performance Labels" from Admin menu
- [`RM_Performance.js`](../RM_Performance.js) analyzes all-time and L90 metrics
- Performance columns updated in `Request_Master`

See [Hub Runbook](runbook.md#manual-metrics-refresh) for refresh procedures.

### How Metrics Become Signals and Recommendations

**Step 1: Parse metrics**
- Active Months, All-time Players, Players per Month (ppm), Completions, Completion Rate
- All-time MT Opportunity Value, All-time MT Won Value
- L90 Players, L90 Completions, L90 MT values
- Drupal Page URL presence (demo-specific vs. generic listing page)
- Metrics Mapping Status (validates MT data linkage)

**Step 2: Compute performance signals**
- **Usage level**: HIGH (≥25 ppm), BASE (15-24 ppm), BELOW (<15 ppm)
- **Completion rate level**: HIGH (≥50%), BASE (40-49%), BELOW (20-39%), LOW (<20%)
- **MT level**: HIGH, BASE, BELOW, NONE (based on opportunity or won thresholds)
- **Maturity**: ESTABLISHED (≥4 active months), NEW (1-3 months + recent), STALLED (1-3 months + old), INACTIVE (0 active months)
- **Recovery check**: L90 data shows recent improvement despite low all-time signals

**Step 3: Apply first-match recommendation rules**
- Rules checked in precedence order (see [How Recommendations Are Selected](#how-recommendations-are-selected))
- **One recommendation per demo** — first matching rule wins
- Priority, score, and tier computed based on signals and trend

**Step 4: Write results to Request_Master**
- Performance Signals, Performance Flags, Recommended action, Recommended action reason
- Action Priority, Performance Score, Performance Tier, Performance L90 Trend
- Processing Result (audit trail: Processed/Skipped/Needs review)

### Where Results Are Written

**Request_Master columns** (auto-created if missing):
- Performance Signals
- Performance Flags
- Recommended action
- Recommended action reason
- Action Priority
- Performance Score (0-100)
- Performance Tier (Top/Mid/Low/Inactive)
- Performance L90 Trend
- Content Age
- Processing Result
- Assigned (Creator or Admin, based on recommendation type)
- Action Status (Action needed → Pending review → Complete)

**Action Status workflow**:
- System writes `Action needed` for actionable recommendations
- **Preserves workflow states** — Never overwrites `Pending review`, `Follow-up needed`, `Complete`, or `Resubmit required` during recalculation
- Status Tracker or manual review advances Action Status to terminal states

### How Humans Review and Act on Recommendations

**Creator response workflow** (via Status Tracker):
1. Creator views creator-actionable recommendation in Status Tracker (`Improve completion` or `Consider retirement`)
2. Creator selects response:
   - **Improve completion**: `Updated`, `Need help`
   - **Consider retirement**: `Updated`, `Keep active`, `Retire`, `Need help`
3. Creator optionally provides new link or notes
4. Creator submits → **Action Status** → `Pending review`
5. Admin reviews in Admin Review panel (applies to creator-actionable recommendations only)
6. Admin approves or requests changes
7. If approved: **Action Status** → `Complete`
8. If retirement approved: **Status** → `Retired`, **Action Status** → `Complete`

See [Intake Status Tracker Lifecycle Workflow](https://github.com/rubyyyyang/interactive-experience-intake/blob/main/docs/status-tracker-lifecycle.md) for complete creator response workflow documentation.

**Admin manual review** (direct sheet edit):
- Admin reviews recommendation in `Request_Master`
- Admin updates **Action Status** manually or through other workflows
- Admin may update **Status** to `Retired` directly if retirement is warranted

**Important**: Recommendations do not automatically retire content. Human review and approval are required before **Status** changes to `Retired`.

---

## What We Evaluate

### Usage and Active Months

**Players per month (ppm)**: All-time Players ÷ Active Months

**Thresholds**:
- HIGH usage: ≥25 players/month
- BASELINE usage: 15-24 players/month
- BELOW baseline: <15 players/month

**Active Months**: Count of months with at least one recorded play

**Maturity levels**:
- **ESTABLISHED**: ≥4 active months
- **NEW**: 1-3 active months, first activity within last 3 months
- **STALLED**: 1-3 active months, first activity more than 3 months ago
- **INACTIVE**: 0 active months

**Why it matters**: Low usage alone does not mean retirement. Context matters:
- **New content** (1-3 months, recent): May receive actionable recommendations (Improve completion, etc.) but Priority is always Low
- **Niche content** (low ppm, high MT): High business value justifies lower traffic
- **Stalled content** (1-3 months, old): Never gained traction, may need updating or retirement

### Completion and Engagement

**Completion Rate**: All-time Completions ÷ All-time Players (always parsed as a metric)

**Signal thresholds**:
- HIGH engagement: ≥50% completion rate
- BASELINE engagement: 40-49% completion rate
- BELOW baseline: 20-39% completion rate
- LOW engagement: <20% completion rate

**Flag-specific requirements**:
- **High engagement flag**: Requires ≥50% CR **AND** ≥25 completions
- **Low completion flag**: Requires ≥25 total players **AND** CR <40%

Completion rate is always parsed and used in signal classification. The minimum sample-size checks apply only to specific performance flags, not to the completion rate metric itself or to recommendation logic that uses CR signals.

**Why it matters**: High traffic with low completion signals content quality or flow issues, not retirement. Recommendations prioritize fixing completion over retiring well-trafficked content.

### Business Impact

**All-time MT Opportunity Value**: Cumulative MTPV opportunity pipeline attributed to demo

**All-time MT Won Value**: Cumulative MTPV won deals attributed to demo

**Thresholds**:
- HIGH business impact: ≥$100K opportunity OR ≥$25K won
- BASELINE business impact: $50K-$99K opportunity OR $10K-$24K won
- BELOW baseline: >$0 but below thresholds
- NONE: $0 opportunity AND $0 won

**Metrics Mapping Status**: Validates data linkage between demo and sales metrics
- **Missing redhat.com page mapping**: Blocks **Low opportunity value** flag only. High business impact and High-value niche flags are NOT blocked.
- **Shared display-key**: Valid mapping, MT data reliable
- **Unlinked request**: Demo not linked to metrics, row marked "Needs review"

MT values are still parsed and used in signal classification and recommendations even when mapping status is "Missing redhat.com page mapping". The mapping check only affects the Low opportunity value flag, which requires both a demo-specific page AND valid mapping.

**Why it matters**: Business value can justify lower traffic. High-value niche content (low ppm, high MT) gets different recommendations than low-value low-traffic content.

### Content Maturity

**Content Age**: Months since earliest available timestamp (Status Received Timestamp OR Status Published Timestamp, Status Received checked first)

**Thresholds**:
- MATURE content: >12 months
- RECENT content: 4-12 months
- NEW content: ≤3 months

**Why it matters**:
- NEW content (≤3 months) with zero activity and MT = $0 → No action needed
- MATURE content (>12 months) with zero activity and MT = $0 → Consider retirement
- MATURE content with actionable recommendation → May receive Medium priority (age bump)

### Recent Performance Trends and Recovery

**Performance L90 Trend**: Compares last 90 days to all-time rate

**L90 players per month**: L90 Players ÷ 3 months

**Trend categories**:
- **Growing**: L90 ppm ≥ 120% of all-time ppm AND L90 ppm ≥ 7.5 (baseline * 0.5)
- **Stable**: L90 ppm ≥ 50% of all-time ppm
- **Declining**: L90 ppm < 50% of all-time ppm
- **Stale**: No L90 data AND last activity >6 months ago
- **Unknown**: No L90 data, last activity within 6 months OR all-time ppm = 0

**Recovery signal**: When all-time signals are 0/3 (no BASE or HIGH usage/CR/MT) but L90 shows recent improvement:
- L90 ppm ≥15 → Recovery active
- L90 CR ≥40% (with ≥5 L90 completions) → Recovery active
- L90 MT ≥$12.5K opportunity OR ≥$2.5K won → Recovery active

**Why recovery matters**: A demo with poor all-time performance but recent improvement gets **No action needed** instead of **Consider retirement**. Recent data takes precedence over historical underperformance.

### Page Availability and Data Quality

**Has demo-specific page**: Drupal Page URL is a demo-specific redhat.com page (not generic listing, not arcade.redhat.com)

**Page detection examples**:
- Demo-specific: `redhat.com/en/interactive-experiences/my-demo` → TRUE
- Generic listing: `redhat.com/en/interactive-experiences` → FALSE
- Arcade URL: `arcade.redhat.com/...` → FALSE
- External URL: `example.com/...` → FALSE

**Why it matters**:
- Well-performing content without a page → **Create page**
- Content with page but low sales impact → **Boost sales impact** (review page linking/CTAs)

**Data quality flags**:
- **Unlinked request**: Demo not linked to metrics → Row marked "Needs review"
- **Missing redhat.com page mapping**: Blocks MT-based flags
- **No activity + MT value >$0**: Data doesn't add up → **Review data linkage**

---

## How Recommendations Are Selected

### First-Match Rule Precedence

Recommendations are assigned using **first-match precedence**. Rules are checked in order. The first rule that matches determines the recommendation.

**Rule order** (simplified):
1. **Review data linkage** — No activity but MT value >$0
2. **Boost sales impact** — Strong completion, page present, but low sales impact
3. **Improve completion** — High usage + Low CR (players start but don't finish)
4. **Create page** — Performing well but no demo-specific page
5. **Increase visibility** — Good content, low visibility
6. **Consider retirement** — Low activity with no positive signals or recovery
7. **Needs review** — System cannot classify (missing data)
8. **No action needed** — Default (strong performance, new content, or recovery active)

**Important**: This is a deterministic algorithm, not a machine learning model. Same signals → same recommendation.

### Concise Table of Recommendation Types

| Recommendation | Assigned To | When It Appears | Key Signals |
|----------------|-------------|-----------------|-------------|
| **Review data linkage** | Admin | No activity + MT value >$0 | Data integrity check |
| **Boost sales impact** | Admin | High completion + page + MT <$10K won | Page has traffic but low pipeline |
| **Improve completion** | Creator | High usage + Low CR OR Base usage + page + Low CR | Players start, don't finish |
| **Create page** | Admin | (High usage OR High CR OR High MT OR Niche) + no page | Performing content needs visibility |
| **Increase visibility** | Admin | Niche + page OR Low usage + good CR OR 3/3 signals + declining/stale trend | Good content, needs distribution |
| **Consider retirement** | Creator | Low activity + no recovery OR No activity (MATURE, MT=$0) OR Stalled + low signals | Flagged for review |
| **Needs review** | Admin | System cannot classify | Missing data or edge case |
| **No action needed** | — | All other cases | Strong performance, new content, or recovery |

**Assigned field**:
- **Creator actions**: `Improve completion`, `Consider retirement` → Assigned = Creator name or "Creator"
- **Admin actions**: `Create page`, `Increase visibility`, `Review data linkage`, `Boost sales impact`, `Needs review` → Assigned = "Admin"
- **No action needed**: Assigned field empty

### Why Low Traffic Does Not Automatically Mean Retirement

**Context matters**:
- **NEW content** (≤3 months): Early days, audience building, not actionable
- **Recovery active**: Recent L90 improvement overrides poor all-time performance
- **Niche content**: Low ppm + high MT → **Increase visibility**, not retirement
- **Moderate usage + good CR**: Content quality is fine → **Increase visibility**, not retirement
- **High usage + Low CR**: High traffic signals value → **Improve completion**, not retirement

**Only flagged for retirement when**:
- ESTABLISHED maturity (≥4 months) + 0/3 signals (no BASE or HIGH usage/CR/MT) + no recovery
- OR MATURE content (>12 months) + no activity ever + MT = $0
- OR STALLED content (1-3 months old, never recent) + low usage + low MT

Even then, retirement is **recommended**, not automatic. Human review decides final action.

### Distinction: Increase Visibility vs. Consider Retirement

| Increase Visibility | Consider Retirement |
|---------------------|---------------------|
| Good content, low distribution | Low activity, no positive signals |
| **Niche** (low ppm, high MT) + page | **Low activity** (0/3 signals, no recovery) |
| Low usage + HIGH or BASE CR | Low usage + LOW or BELOW CR + low MT |
| 3/3 all-time signals + declining/stale trend | STALLED or MATURE + below baseline + MT ≠ HIGH/BASE |
| Content worth promoting | Content worth reviewing for retirement |

**Example**: Demo with 10 ppm, 50% CR, $5K MT:
- **Signals**: Usage BELOW, CR HIGH, MT BELOW → 1/3 signals (CR only)
- **Recommendation**: **Increase visibility** (good content, needs distribution)
- **NOT Consider retirement** (HIGH CR signals content quality)

### Difference Between Action, Priority, Score, and Tier

| Field | What It Measures | Example Values |
|-------|------------------|----------------|
| **Recommended action** | What to do next | `Improve completion`, `Consider retirement`, `No action needed` |
| **Action Priority** | How urgently to act | `High` (2+ HIGH signals OR declining + meaningful), `Medium` (1 HIGH signal OR mature content), `Low` (default) |
| **Performance Score** | Composite all-time performance (0-100) | 85 (Top tier), 55 (Mid tier), 30 (Low tier), 0 (Inactive) |
| **Performance Tier** | Bucketing by score | `Top` (≥70), `Mid` (40-69), `Low` (1-39), `Inactive` (0) |

**Score calculation** (simplified):
- +20 points per BASE signal (usage, CR, MT)
- +5 points per HIGH signal
- +15 for growing trend, +10 for stable, +5 for declining
- +10 for ESTABLISHED maturity, +5 for NEW, +3 for STALLED
- Capped at 100

**Priority rules**:
- NEW content → Always `Low`
- No action needed → Always `Low`
- 2+ HIGH signals → `High`
- Declining/stale + ≥1 signal → `High`
- 1 HIGH signal → `Medium`
- MATURE content (>12 months) → Bumps `Low` → `Medium`
- Low tier demos cap `High` → `Medium` (score-priority coherence)

---

## Practical Examples

**Note**: These examples are illustrative, not actual Request_Master records. Signals and recommendations are computed using current implemented logic.

### Example 1: High Usage + Low Completion → Improve Completion

**Scenario**: Popular demo with traffic but users don't finish

**Metrics**:
- Active Months: 10
- Total Players: 300
- Players per Month: 30 (HIGH usage)
- Completion Rate: 18% (LOW)
- Completions: 54
- MT Opportunity: $5K (BELOW)
- Has Page: No
- L90 Players: 0 (no L90 data)

**Signals**:
- Usage: HIGH (30 ppm)
- CR: LOW (18%)
- MT: BELOW ($5K)
- Signal count: 1/3 (usage only, HIGH count = 1)
- Maturity: ESTABLISHED
- Trend: Unknown (no L90 data)

**Flags**: `High usage`, `Low completion`

**Recommendation**: **Improve completion**
- **Why**: Players start but don't finish — review demo flow and content
- **Priority**: Medium (1 HIGH signal)
- **Assigned**: Creator

**What matters**: High traffic signals value. Fix completion rate, don't retire.

---

### Example 2: Low Usage + High CR → Increase Visibility

**Scenario**: Quality content with low distribution

**Metrics**:
- Active Months: 8
- Total Players: 96
- Players per Month: 12 (BELOW baseline)
- Completion Rate: 55% (HIGH)
- Completions: 53
- MT Opportunity: $8K (BELOW)
- Has Page: Yes
- L90 Players: 0 (no L90 data)

**Signals**:
- Usage: BELOW (12 ppm)
- CR: HIGH (55%)
- MT: BELOW ($8K)
- Signal count: 1/3 (CR only, HIGH count = 1)
- Maturity: ESTABLISHED
- Trend: Unknown (no L90 data)

**Flags**: `High engagement`

**Recommendation**: **Increase visibility**
- **Why**: Good content, low visibility — needs distribution
- **Priority**: Medium (1 HIGH signal)
- **Assigned**: Admin

**What matters**: HIGH CR signals quality. Low usage does NOT mean retirement when engagement is strong.

---

### Example 3: Niche Content (Low PPM + High MT) → Increase Visibility (Not Retirement)

**Scenario**: Low-traffic demo with high business value

**Metrics**:
- Active Months: 12
- Total Players: 96
- Players per Month: 8 (BELOW baseline)
- Completion Rate: 35% (BELOW baseline)
- Completions: 34
- MT Opportunity: $120K (HIGH)
- MT Won: $5K (BELOW)
- Has Page: Yes
- L90 Players: 0 (no L90 data)
- Metrics Mapping Status: "Shared display-key" (valid)

**Signals**:
- Usage: BELOW (8 ppm)
- CR: BELOW (35%)
- MT: HIGH ($120K)
- Signal count: 1/3 (MT only, HIGH count = 1)
- Maturity: ESTABLISHED
- Trend: Unknown (no L90 data)

**Flags**: `High business impact`, `High-value niche`, `Low completion`

**Recommendation**: **Increase visibility**
- **Why**: Good content, low visibility — needs distribution
- **Priority**: Medium (1 HIGH signal)
- **Assigned**: Admin

**What matters**: HIGH MT justifies low traffic. This is a **niche** demo, not a retirement candidate.

---

### Example 4: Low Activity + No Positive Signals → Consider Retirement

**Scenario**: Underperforming content with no strong signals

**Metrics**:
- Active Months: 6
- Content Age: 18 months (MATURE)
- Total Players: 48
- Players per Month: 8 (BELOW baseline)
- Completion Rate: 23% (BELOW baseline)
- Completions: 11
- MT Opportunity: $3K (BELOW)
- MT Won: $0 (BELOW)
- Has Page: No
- L90 Players: 0 (no L90 data)
- Last activity: >90 days ago
- Metrics Mapping Status: "Shared display-key" (valid)

**Signals**:
- Usage: BELOW (8 ppm)
- CR: BELOW (23%)
- MT: BELOW ($3K)
- Signal count: 0/3 (no BASE or HIGH, HIGH count = 0)
- Maturity: MATURE (18 months)
- Recovery: Not active
- Trend: Unknown (no L90 data, last activity >90 days ago)

**Flags**: `Low completion`

**Recommendation**: **Consider retirement**
- **Why**: This demo is flagged for retirement — review the demo page and consider updating or confirming retirement
- **Priority**: Low (0 HIGH signals, MATURE age, but no declining trend)
- **Assigned**: Creator

**What matters**: No positive signals (0/3), no recovery, MATURE age. Flagged for review, but **retirement is not automatic**.

---

### Example 5: Recovery Active (Poor All-Time, Good L90) → No Action Needed

**Scenario**: Historical underperformer showing recent improvement

**Metrics**:
- Active Months: 10
- Total Players: 120
- Players per Month: 12 (BELOW baseline)
- Completion Rate: 30% (BELOW baseline)
- Completions: 36
- MT Opportunity: $2K (BELOW)
- MT Won: $0 (BELOW)
- Has Page: No
- **L90 Players**: 60 (L90 ppm = 20, above 15 baseline)
- L90 Completions: 18
- Metrics Mapping Status: "Missing redhat.com page mapping" (valid, but Low opportunity value flag blocked)

**Signals**:
- Usage: BELOW (12 ppm)
- CR: BELOW (30%)
- MT: BELOW ($2K)
- Signal count: 0/3 (no BASE or HIGH all-time, HIGH count = 0)
- Maturity: ESTABLISHED
- **Recovery: Active** (L90 ppm = 20 ≥ 15 baseline)
- Trend: Growing (L90 rate 167% of all-time rate, L90 ppm ≥ 7.5)

**Flags**: `Low completion` (≥25 players, CR <40%)

**Recommendation**: **No action needed**
- **Why**: No action needed (recovery active)
- **Priority**: Low
- **Assigned**: (empty)

**What matters**: Recent L90 data shows improvement. Poor all-time performance **does not trigger retirement** when recovery is active.

---

## Human Review and Lifecycle Actions

### Creator and Admin Responsibilities

**Creator actions** (`Improve completion`, `Consider retirement`):
- Review recommendation in Status Tracker
- Select response:
  - **Improve completion**: `Updated`, `Need help`
  - **Consider retirement**: `Updated`, `Keep active`, `Retire`, `Need help`
- Optionally provide new Creation Link or notes
- Submit response → **Action Status** → `Pending review`

**Admin actions** (`Create page`, `Increase visibility`, `Review data linkage`, `Boost sales impact`, `Needs review`):
- Review recommendation in Request_Master
- Decide on next steps (create page, update visibility, investigate data linkage)
- Manually update **Action Status** through direct sheet edit or other workflows
- Admin-owned recommendations are NOT managed through Status Tracker Admin Review panel (that panel is for creator-actionable recommendations only)

**Admin review of creator responses**:
- View pending responses in Admin Review panel
- Approve response → **Action Status** → `Complete`
- Request changes → **Action Status** → `Follow-up needed`
- If retirement approved → **Status** → `Retired`, **Action Status** → `Complete`

See [Intake Status Tracker Lifecycle Workflow](https://github.com/rubyyyyang/interactive-experience-intake/blob/main/docs/status-tracker-lifecycle.md) for complete workflow documentation.

### Current Status Tracker Workflow

**Creator submission**:
1. Creator views recommendation panel in Status Tracker (expanded submission detail)
2. Creator selects response value from valid options
3. Creator optionally provides new link or notes
4. Creator clicks Submit → System writes to Response_Queue and updates **Action Status** → `Pending review`

**Admin review**:
1. Admin views pending responses in Admin Review panel (admin-only UI)
2. Admin reviews creator response and submission context
3. Admin approves or requests changes:
   - **Approve** → Master **Action Status** → `Complete`, Queue **Review Status** → `Complete`
   - **If retirement** → Master **Status** → `Retired`, **Status Retired Timestamp** → current timestamp
   - **Request changes** → Queue **Review Status** → `Follow-up needed`, Master **Action Status** → `Follow-up needed`
4. Creator resubmits after follow-up feedback (if needed)

**Important**: Status Tracker writes are **non-atomic, sequential Sheets operations**. Write order differs by operation. Partial-write failures are possible and require manual recovery. See [Intake Status Tracker documentation](https://github.com/rubyyyyang/interactive-experience-intake/blob/main/docs/status-tracker-lifecycle.md#partial-write-recovery) for recovery procedures.

### Hub Performance Classification vs. Intake Approval

| Hub Performance System | Intake Status Tracker Workflow |
|------------------------|--------------------------------|
| Generates **Recommended action** | Creator responds to recommendation |
| Writes **Action Status** = `Action needed` | Updates **Action Status** → `Pending review` → `Complete` |
| Does not modify **Status** column | Admin approval can modify **Status** → `Retired` |
| Performance scoring and tier assignment | Lifecycle response workflow and admin approval |
| Automated recalculation via Admin menu | Human-driven creator response and admin review |
| Preserves workflow states during recalculation | Advances workflow states to terminal values |

**Recommendations do not automatically retire content.** Human review and admin approval are required before **Status** changes to `Retired`.

### Legacy Email/Form Workflows

**Hub's `email_gen.js` workflow**:
- Older form-based performance response workflow
- Uses `lifecycle_raw_updates` sheet for creator responses
- Relationship to Status Tracker workflow is not documented here
- Current operational status (active, deprecated, or retired) is not verified

**Current documentation scope**: This guide describes the Status Tracker `submitCreatorResponse()` workflow only. For Hub email generation and form-based response workflows, consult Hub operational documentation.

---

## Operational Details and Limitations

### Relevant Functions and Source Links

**Performance analysis engine**: [`RM_Performance.js`](../RM_Performance.js)
- `runPerformanceLabels()` — Main entry point, processes all Request_Master rows
- `classifyRow_()` — Row-level classification logic (skipped/needs review/processed)
- `parseMetrics_()` — Parses metrics from row data
- `computePerformanceSignals_()` — Computes usage/CR/MT levels and maturity
- `computePerformanceFlags_()` — Generates performance flags
- `computePerformanceAction_()` — First-match rule precedence for recommendations
- `computePerformancePriority_()` — Priority assignment (High/Medium/Low)
- `computePerformanceScore_()` — 0-100 composite score
- `computePerformanceTier_()` — Top/Mid/Low/Inactive bucketing
- `computePerformanceTrend_()` — Growing/Stable/Declining/Stale/Unknown

**Thresholds and constants**:
- `PERF_THRESHOLDS` (lines 64-79) — Usage, CR, MT, maturity thresholds
- `CREATOR_ACTIONS_` (line 43) — `Improve completion`, `Consider retirement`
- `ADMIN_ACTIONS_` (line 44) — `Create page`, `Increase visibility`, etc.

**Test harness**:
- `testPerformanceRules()` — Rule logic unit tests (300+ assertions)
- `testProcessingAudit()` — Row classification and audit tests

### Missing-Data Handling

**Required metrics** (minimum for processing):
- Active Months
- Total Players
- Completions
- MT Opportunity Value
- MT Won Value
- Completion Rate (only required if Total Players >0)
- First Activity Month (only required if Active Months is 1-3)

**Eligible status values**:
- "Published"
- "Demo Reviewed"
- "Demo Received"
- Blank (empty Status column)

Any other status value (except "Retired" and "Closed", which are skipped) triggers a "Needs review" outcome.

**Missing data outcomes**:
- **Row is blank** (all non-output columns empty) → **Skipped** — Blank row
- **Status = "Retired"** → **Skipped** — Status = Retired
- **Status = "Closed"** → **Skipped** — Status = Closed
- **Note = "Delete row"** → **Skipped** — Note = Delete row
- **Status not eligible** → **Needs review** — Row has status "[value]", which is not eligible for performance labeling (only Published, Demo Reviewed, Demo Received, or blank)
- **Number column blank** → **Needs review** — The Number column is blank, so this row cannot be matched to metrics data
- **Metrics Mapping Status = "Unlinked request"** → **Needs review** — The intake request is not linked to a demo record, so reliable performance metrics are unavailable
- **Required metrics missing** → **Needs review** — One or more required performance metrics are missing: [list]

**Special case: Zero Players + Blank Completion Rate**:
- Zero players → Completion Rate not required (division by zero scenario)
- Validation passes if other required metrics are present

### Recalculation Behavior and Preserved Workflow States

**When recalculation runs** (Admin menu → "Run Performance Labels"):
- All Request_Master rows are reprocessed
- **Performance-only fields** recalculated: Performance Signals, Flags, Recommended action, Recommended action reason, Priority, Score, Tier, Trend, Content Age, Processing Result
- **Workflow fields** also written: Assigned, Action Status (with preservation rules below)
- **Action Status is preserved** for workflow states: `Pending review`, `Follow-up needed`, `Complete`, `Resubmit required`

**Preserved workflow states**:
- **Pending review**: Creator response submitted, awaiting admin review
- **Follow-up needed**: Admin requested changes, creator needs to resubmit
- **Complete**: Admin approved, action complete
- **Resubmit required**: Creator needs to resubmit (legacy state)

**Recalculation writes `Action needed`** only when:
- Current Action Status is NOT a preserved workflow state
- Recommended action is actionable (not `No action needed`)
- Assigned field is populated (Creator or Admin)

**Why preservation matters**: Prevents recalculation from overwriting in-progress workflow states. If a creator response is `Pending review` and recalculation runs, the system does not reset Action Status to `Action needed`.

### Relevant Limitations and Edge Cases

**Non-activity scenarios**:
- **No activity + MT value >$0**: Data integrity issue → **Review data linkage**
- **No activity + MATURE + MT = $0**: No traction → **Consider retirement**
- **No activity + NEW (≤3 months) + MT = $0**: Early days → **No action needed**
- **No activity + Content Age unavailable**: Cannot classify → **Needs review**

**Recovery overrides retirement**:
- Even with 0/3 all-time signals, if L90 shows recovery → **No action needed**
- Recovery check only runs when 0/3 signals + ESTABLISHED maturity

**Stale vs. Declining**:
- **Stale**: No L90 data + last activity >6 months ago
- **Declining**: L90 ppm < 50% of all-time ppm (or last activity ≤6 months with no L90 data)

**Page URL normalization**:
- Strips protocol, www, query params, hash, trailing slashes
- Case-insensitive comparison
- Generic listing patterns: `redhat.com/en/interactive-experiences`
- Arcade URLs excluded: `arcade.redhat.com`

**Metrics Mapping Status edge cases**:
- **"Missing redhat.com page mapping"**: Valid row, but Low opportunity value flag blocked
- **"Shared display-key"**: Valid mapping
- **"Unlinked request"**: Row marked "Needs review"

**Priority cap**: Low-tier demos (score <40) cap High priority → Medium (coherence rule)

**Sporadic activity flag**: Content Age ≥6 months + Active Months / Content Age <50%

### How Maintainers Should Verify Rule Changes

**Before modifying thresholds or rules**:
1. Run `testPerformanceRules()` in Apps Script editor → Verify all tests pass
2. Run `testProcessingAudit()` → Verify classification logic
3. Document threshold change rationale (business justification, not implementation convenience)
4. Update this guide to reflect new thresholds or rules

**Safe validation workflow**:
1. **Test rule logic** with deterministic unit tests (`testPerformanceRules()`, `testProcessingAudit()` in Apps Script editor)
2. **Validate individual functions** — Call `computePerformanceSignals_()`, `computePerformanceAction_()`, etc. with sample metrics objects to verify expected outputs (read-only)
3. **Review proposed rule changes** — Manually inspect changed logic before any production writes
4. **Production recalculation** (explicit approval required) — `runPerformanceLabels()` calls `getMasterSheet()` to resolve the configured MASTER_SHEET_ID and writes recommendations, Assigned, and Action Status to production Request_Master. Preserves workflow states: Pending review, Complete, Follow-up needed.
5. **Post-recalculation audit** — Review Logs for processed count, action distribution, and unexpected "Needs review" outcomes

**Important**:
- `runPerformanceLabels()` writes to production Request_Master via `getMasterSheet()`. Do not run on production data without explicit approval.
- `clearPerformanceLabels()` is **destructive** — clears Action Status, Assigned, and Response. Use only when intentionally resetting all workflow state.
- For read-only validation, use unit test functions or manual function calls with sample data.

**Test coverage**: `testPerformanceRules()` and `testProcessingAudit()` provide deterministic unit test coverage for thresholds, signals, flags, actions, priority, score, tier, and classification logic.

---

**Last updated**: 2026-11-16  
**Source version**: Current `main` branch implementation  
**Maintainer**: Hub development team

For operational procedures, see [Hub Runbook](runbook.md). For creator workflow, see [Intake Status Tracker Lifecycle Workflow](https://github.com/rubyyyyang/interactive-experience-intake/blob/main/docs/status-tracker-lifecycle.md).
