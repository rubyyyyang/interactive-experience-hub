# Interactive Experience Hub: Code Map

Source file guide for the current production system. For the system overview, see [Architecture](architecture.md).

## Core Workflow

**RM_Config.js**

Centralized configuration for sheet names, column definitions, Slack channels, Databricks endpoints, and Script Properties access.

**RM_Workflow.js**

Request lifecycle orchestration for master row updates, Slack workflow actions, status-based processing, and request document updates.

**RM_CreatorIntake.js**

Creator intake processing for submissions with or without Global ID, including updates to existing requests and creation of creator-only entries.

**RM_Triggers.js**

Central installable trigger routing layer for form submissions and spreadsheet edits.

## Review and Performance

**RM_Performance.js**

Current performance analysis engine that computes performance signals, flags, recommended actions, priorities, scores, tiers, and trends.

**RM_Metrics.js**

Databricks metrics workflow that retrieves engagement and sales metrics and writes the resulting metrics to `Request_Master`.

**email_gen.js**

Creator performance-review workflow that generates email drafts and synchronizes creator update-plan responses to `Response_Queue`.

## Lifecycle Notifications

**RM_Creator_Lifecycle_Notifications.js**

Centralized creator lifecycle email notifications for Interactive Demo submission received, published, and retired events, and YouTube submission received and retired events.

## Discovery

**DiscoveryWebApp.js**

Server-side Discovery web app logic for search, filtering, pagination, and sharing.

**discovery.html**

Discovery web app HTML template.

**discovery_js.html**

Discovery web app client-side JavaScript.

**discovery_css.html**

Discovery web app styles.

## Data and Sync

**RM_Datasync.js**

Data synchronization between `Request_Master`, Version data, and Databricks-backed workflows, including synchronization and cleanup handling.

## Shared Utilities

**RM_Utils.js**

Shared utilities for document generation, token replacement, header mapping, status normalization, date formatting, and master sheet access.

**RM_Gemini.js**

Gemini API integration wrapper for AI-assisted workflows that require structured JSON responses.

## Manual / Admin Utilities

**RM_AdminMenu.js**

Central spreadsheet `onOpen()` menu that provides access to metrics, performance analysis, and creator performance-review tools.

**OneTime.js**

One-time operational and administrative utilities that are not part of normal automated execution.

**RH_Test.js**

Manual test and debugging utilities that are not part of the production workflow.
