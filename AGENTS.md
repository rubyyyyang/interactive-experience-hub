# AGENTS.md

Persistent instructions for coding agents working in Arcade Finder.

## Project

Arcade Finder is an internal Red Hat Google Apps Script application backed primarily by Google Sheets.

Major areas:

- **Discovery Web App**: search, filtering, browsing, saving, sharing, and analytics
- **Request Management**: request and creator intake, lifecycle workflows, Slack, documents, sheet synchronization, and Databricks sync
- **Lifecycle / Performance**: content health, metrics, analysis, and lifecycle actions

Preserve the existing Google Apps Script architecture.

Do not migrate the application to Node, React, Express, REST APIs, or another framework unless explicitly requested.

Prefer the smallest safe, maintainable change.

## Communication

Keep user-facing reports proportional to the task.

Do the necessary investigation internally, but do not restate the full investigation unless requested.

For a simple confirmed bug, default to:
- root cause
- smallest recommended action
- important risk or uncertainty
- verification result

Avoid repeating raw evidence, code paths, intermediate hypotheses, or detailed verification plans when they no longer affect the decision.

## Project Data Sources

### Primary Google Spreadsheet

Primary Arcade Finder spreadsheet:

- Spreadsheet ID: `1t7TJtTL-jbUaCVKVLMMOahbKcL5b1IyCf3uUSCmQo4A`
- Canonical URL: `https://docs.google.com/spreadsheets/d/1t7TJtTL-jbUaCVKVLMMOahbKcL5b1IyCf3uUSCmQo4A/edit`

Important tabs include:

- `Request_Master` — primary Arcade / interactive demo records
- `YouTube_Responses` — YouTube video source records
- `Version` — synchronized downstream version data
- `Creator_Form_Raw` — raw creator form submissions
- `Request_Form_Raw` — raw request form submissions

Other tabs may support workflow, lifecycle, metrics, analysis, or operational processes.

When a task depends on spreadsheet data:

1. Identify the relevant tab from the task context and current code/configuration.
2. Inspect the real tab headers and representative rows when direct read-only access is available.
3. Treat the spreadsheet as the source of truth for current data shape.
4. Do not infer one source's schema from another source.
5. Do not duplicate full column schemas in this file because they change more frequently than project-level architecture.

If a required tab is not documented here, inspect the workbook or canonical sheet-name configuration instead of guessing.

Documentation provides navigation, not a frozen schema. When current data shape matters, inspect the actual source.

## Architecture Map

### Discovery

Primary files:

- `DiscoveryWebApp.js` — server-side Discovery logic, source ingestion, normalization, search, facets, filtering, pagination, caching, record lookup, analytics, and email actions
- `discovery.html` — HTML shell
- `discovery_css.html` — Discovery styles
- `discovery_js.html` — browser-side Discovery behavior

Browser-to-server communication uses `google.script.run`.

Discovery combines multiple source schemas:

- `Request_Master` — Arcade / interactive demo records
- `YouTube_Responses` — YouTube video records

Records are normalized into a shared Discovery model before entering shared search, facet, filtering, sorting, and rendering paths.

For source-specific bugs, inspect the real source data and trace its normalization path into the shared model.

Do not assume Request Master fields exist in YouTube Responses or vice versa.

### Request Management and Lifecycle

Primary files include:

- `RM_Config.js` — shared configuration
- `RM_Workflow.js` — request lifecycle
- `RM_CreatorIntake.js` — creator intake
- `RM_Utils.js` — shared helpers
- `RM_Triggers.js` — trigger and form-event routing
- `RM_Datasync.js` — Version / Databricks synchronization and related edit handling
- `RM_Lifecycle.js` — lifecycle behavior
- `RM_Performance.js` — performance logic
- `RM_Metrics.js` — metrics
- `RM_Analysis.js` — analysis
- `RM_Gemini.js` — Gemini-assisted functionality
- `RH_Test.js` — Apps Script test helpers
- `OneTime.js` — one-time and replay utilities
- `lifecycle.html` — lifecycle UI

All server-side Apps Script files share one global namespace.

Avoid accidental global function-name collisions.

Canonical external integration IDs and configuration should remain in repository configuration such as `RM_Config.js` rather than being duplicated here.

## Platform Constraints

Preserve Google Apps Script compatibility and existing integration patterns, including:

- `SpreadsheetApp`
- `HtmlService`
- `GmailApp`
- `CacheService`
- `PropertiesService`
- `Session`
- `Utilities`
- `DriveApp`
- `DocumentApp`
- `UrlFetchApp`
- `google.script.run`

Do not replace `google.script.run` with `fetch()` or introduce a separate API layer unless explicitly required by an architectural decision.

Private Apps Script helpers use a trailing underscore by convention.

Do not weaken validation, sanitization, rate limiting, permissions, analytics, or cache behavior unless explicitly required.

## Development and Verification

Apps Script synchronization:

```bash
clasp status
clasp pull
clasp push
clasp deploy
clasp open