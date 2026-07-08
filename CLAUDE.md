# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arcade Finder is an internal Red Hat tool that runs as a single Google Apps Script project backed by a Google Sheets spreadsheet. It serves two purposes:

1. **Discovery Web App** — a public-facing search/filter/save/share interface for interactive demo arcades, served via `doGet()`.
2. **Request Management Backend** — intake workflows for request and creator forms, Slack notifications, document generation, data sync to Databricks, and Version sheet management.

This is a Google Apps Script project. Do not modernize it into Node, React, Express, or REST API. Preserve Apps Script compatibility and make small, targeted changes.

## Development Workflow

The project uses `clasp` for local editing and deployment:

```bash
clasp push         # sync local files to Apps Script
clasp pull         # pull remote changes locally
clasp deploy       # publish a new deployment version
clasp open         # open in Apps Script editor
clasp status       # see tracked/untracked files
```

Clasp uses `.js` extensions (not `.gs`). The `.clasp.json` links this folder to the Apps Script project. There is no local build, test, lint, or npm pipeline.

Before editing, inspect the server/client boundary and explain what files, functions, sheet columns, permissions, cache behavior, or deployment behavior may be affected.

## Architecture

### Discovery Web App (the frontend-facing side)

| File | Purpose |
|------|---------|
| `DiscoveryWebApp.js` | Server-side logic: reads records from `Request_Master`, builds index bundle for search/filtering, handles email actions, logs analytics |
| `discovery.html` | Single-file frontend (HTML + CSS + JS): search, filters, result cards, detail drawer, saved arcades, modals, notifications, analytics tracking |

### Request Management Backend (RM_* files)

| File | Purpose |
|------|---------|
| `RM_Config.js` | Centralized configuration (`ENHANCED_CONFIG`): Drive IDs, Slack channels/user IDs, sheet names, status values, origin types, performance tuning. Script Properties override code defaults. |
| `RM_Workflow.js` | Request lifecycle: form intake, master row creation/update via `upsertMasterRowByGlobalId()`, Slack thread creation, status-based workflow actions |
| `RM_CreatorIntake.js` | Creator form submissions: two paths — has Global ID (update existing request) or no Global ID (create creator-only request). Entry point: `onCreatorFormSubmit(event)` |
| `RM_Utils.js` | Shared helpers: document creation from templates, header map caching, status normalization, sheet lookups, Slack messaging, error logging |
| `RM_Triggers.js` | Installable trigger handlers: `onEdit_VersionSync`, `onChange_VersionCleanup`, form submission triggers |
| `RM_Datasync.js` | Syncs `Request_Master` rows to `Version` sheet and to Databricks. Trigger-driven with batch processing and retry logic |
| `RH_Test.js` | Test harness: simulates request/creator form submissions end-to-end without real forms |
| `OneTime.js` | Backfill/replay helpers: reprocesses recent rows from `Creator_Form_Raw` and `Request_Form_Raw` sheets |

### Config & Manifest

| File | Purpose |
|------|---------|
| `appsscript.json` | Apps Script manifest: V8 runtime, Pacific timezone, web app deployed as deploying user with domain access |
| `.clasp.json` | Links local folder to Apps Script project by script ID |

## Google Apps Script Constraints

Preserve compatibility with these services:

* `HtmlService`, `SpreadsheetApp`, `GmailApp`, `CacheService`, `PropertiesService`, `Session`, `Utilities`, `DriveApp`, `DocumentApp`
* `google.script.run` on the frontend (do not replace with `fetch()` or API routes)
* `UrlFetchApp` for Slack webhooks and Databricks sync

All server-side functions share a single global namespace. Name collisions across files will silently shadow each other.

## Server and Client Communication

The frontend calls server-side functions through:

```js
google.script.run
  .withSuccessHandler(...)
  .withFailureHandler(...)
  .functionName(...);
```

Public functions have no trailing underscore. Private helpers use a trailing underscore by convention.

Key public server functions for the Discovery Web App:

| Function | Purpose |
|----------|---------|
| `doGet()` | Serves `discovery.html` |
| `getDiscoveryBootstrap()` | Returns user info, initial results, and filter options |
| `getDiscoveryInitialBootstrap()` | Returns user info and initial results only |
| `getDiscoveryFilterOptions()` | Returns available filter values |
| `listDiscoveryPage(params)` | Paginated filtered search results |
| `getDiscoveryRecord(recordId)` | Fetches a single record by sheet row number |
| `sendEventPackageRequest(emailData)` | Sends event package request email |
| `shareArcadeCollection(emailData)` | Shares arcades by email |
| `submitFeedback(emailData)` | Sends feedback email |
| `recordAnalyticsEvent(eventData)` | Logs interaction to Analytics sheet |

## Data Model

The `Request_Master` sheet is the source of truth. Each row is one demo/interactive experience record.

Required columns: `Status`, `Final Demo Title`, `Suggested Demo Title`, `Product`, `Event`, `Production Link`, `Public Site Link`, `RHAC page`, `Latest Prod Link`, `Number`.

A record is discoverable when:
1. `Status` normalizes to `IE Published` or `IE Reviewed`
2. At least one usable link exists (`Production Link`, `Public Site Link`, `RHAC page`, or `Latest Prod Link`)

Sort priority: Featured+Latest > Featured > Latest > Other, then by `Number` descending.

Featured/Latest status comes from active date windows (`Featured Start/End Date`, `Latest Start/End Date`) or the `Publish states` field.

The `Version` sheet is a sync target — `RM_Datasync.js` mirrors watched columns from `Request_Master` into it, keyed by `Number`.

## Frontend State

App state lives in module-level variables in `discovery.html`:

* `CURRENT_PAGE`, `TOTAL_PAGES`, `CURRENT_RESULTS`: pagination
* `FILTER_OPTIONS`, `INITIAL_RESULTS`: bootstrap data
* `RECORD_CACHE`: Map for fetched record details
* `filterState`: selected filter values
* `SELECTION_MODE`, `SELECTED_CARDS`: multi-select for export/email
* `SAVED_ARCADES`: bookmarks persisted in `localStorage`

Use `getCachedElement(id)` for DOM lookups in existing frontend code.

## Filters

Adding or changing a filter touches both client and server:

* Frontend: `FILTER_DEFS`, `filterState`
* Server: `normalizeDiscoveryParams_()`, `buildDiscoveryFilterOptionsFromBundle_()`, `buildDiscoveryListResultFromBundle_()`, facet map creation in the index bundle

Do not add a frontend filter without confirming server support in normalized params, filter options, facet maps, and result matching.

## Caching

Server-side: runtime memo (`DISCOVERY_RUNTIME_MEMO`), `CacheService.getScriptCache()`, sheet version keys (`getDiscoverySheetVersion_()`), manual bump (`bumpDiscoveryDataVersion_()`).

Frontend: `RECORD_CACHE` Map, `localStorage` for saved arcades and preferences.

When changing search, filters, links, visibility rules, or data shape, consider whether cached data may become stale.

## Email, Security, and Validation

* Email restricted to `redhat.com` domain
* Rate-limited per user
* Body and address fields sanitized before sending
* Frontend HTML escaped before DOM insertion
* Do not weaken validation, sanitization, rate limiting, or domain restrictions unless explicitly requested

## Analytics

User interactions log to an Analytics sheet via `recordAnalyticsEvent(eventData)`. Do not remove analytics calls unless explicitly requested. When changing UI actions, check whether analytics logging needs updating.

## Configuration System

`RM_Config.js` defines `ENHANCED_CONFIG` with defaults for Drive, Slack, Sheets, Status values, and performance tuning. Script Properties (set in Apps Script editor > Project Settings) override code defaults. Key sections:

* `ENHANCED_CONFIG.SLACK` — channel IDs, user IDs, message templates
* `ENHANCED_CONFIG.SHEETS` — sheet tab names (`Request_Master`, `Version`, `Creator_Form_Raw`, `Request_Form_Raw`)
* `ENHANCED_CONFIG.STATUS` — canonical status values used in workflow transitions
* `ENHANCED_CONFIG.DRIVE` — template and output folder IDs

## Testing

From the Apps Script editor:

* `test__request_intake_dummy()` — simulates a request form submission end-to-end (creates document, master row, Slack thread). Returns a Global ID.
* `test__creator_with_globalId_dummy(globalId)` — simulates a creator form update for an existing request
* `test__creator_no_globalId_dummy()` — simulates a creator-only submission
* `backfillLast4CreatorSubmissions()` / `backfillLast4RequestSubmissions()` — replays recent form rows through current code
* `testSetup()` — verifies Analytics sheet access, Gmail permission, and `Request_Master`
* `getAnalyticsSummary(days)` — inspects recent analytics logging

Manually test the deployed web app after frontend or server changes.

## Style Conventions

* Public Apps Script functions: no trailing underscore
* Private helpers: trailing underscore
* Single-file HTML structure for the frontend
* Use `getCachedElement(id)` for DOM lookups
* Preserve CSS custom properties (`--accent`, `--surface`, `--border`, etc.)
* Escape user-visible dynamic HTML before DOM insertion

## High-Risk Changes

Explain impact before editing any of these:

* `doGet()` or the served HTML filename
* `Request_Master` tab name or required columns
* Discoverability rules, Featured/Latest logic
* `google.script.run` calls or public function signatures
* Email recipients, allowed domains, rate limiting
* Analytics sheet logic or cache keys/invalidation
* `ENHANCED_CONFIG` values that affect Slack channels, Drive IDs, or sheet names
* Installable trigger handlers (`onEdit_VersionSync`, `onChange_VersionCleanup`, form triggers)
* Databricks sync logic or table names
