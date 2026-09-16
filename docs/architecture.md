# Interactive Experience Architecture

## System Overview

The Interactive Experience program has two primary systems:

**Interactive Experience Intake**
- Creator-facing submission experience for Interactive Demo and YouTube content
- AI-assisted metadata drafting
- Review and status tracking interface (Status Tracker)
- Writes Interactive Demo submissions to Creator_Form_Raw
- Writes YouTube submissions to YouTube_Responses
- Notifies Hub for downstream processing

**Interactive Experience Hub**
- Google Apps Script solution for downstream lifecycle management
- Spreadsheet operations, web experience, and background automation
- Content lifecycle management, performance review, search & discovery, notifications, and data synchronization

```mermaid
flowchart LR
    CREATOR[Creators] --> INTAKE[Interactive Experience Intake]

    INTAKE -->|Interactive Demo via Creator_Form_Raw| HUB[Interactive Experience Hub]
    INTAKE -->|YouTube via YouTube_Responses| HUB
```

## Inside the Interactive Experience Hub

The Hub operates through three main areas:

```mermaid
flowchart TB
    HUB[Interactive Experience Hub]

    HUB --> SHEET[Spreadsheet Operations]
    HUB --> WEB[Web Experience]
    HUB --> AUTO[Background Automation & Integrations]

    SHEET --> LIFE[Content Lifecycle Management]
    SHEET --> PERF[Performance Review & Metrics]

    WEB --> SEARCH[Search & Discovery]

    AUTO --> PROCESS[Submission & Workflow Processing]
    AUTO --> EMAIL[Creator Lifecycle Notifications]
    AUTO --> SLACK[Slack Notifications]
    AUTO --> TRIG[Form / Edit / Status Triggers]
    AUTO --> DATA[Data Sync & Databricks]
```

The spreadsheet is the Hub's operational workspace and data layer. The Apps Script project is the execution layer.

## Data flow

**Interactive Demo:**
```text
Interactive Experience Intake
        ↓
Creator_Form_Raw
        ↓
Interactive Experience Hub
        ↓
Request_Master
        ↓
Hub capabilities:
Lifecycle workflows / Creator notifications / Search & Discovery
```

**YouTube:**
```text
Interactive Experience Intake
        ↓
YouTube_Responses
        ↓
Interactive Experience Hub
        ↓
Hub capabilities:
Lifecycle workflows / Creator notifications / Search & Discovery
```

## Creator Lifecycle Notification Flow

The Hub centralizes creator lifecycle email notifications for both Interactive Demo and YouTube content.

```mermaid
graph TB
    INTAKE[Interactive Experience Intake]
    
    CFR[Creator_Form_Raw]
    YT[YouTube_Responses]
    
    HUB_DEMO[Hub: Submission Processing]
    RM[Request_Master]
    
    NORM[Lifecycle Event Normalization]
    
    DISPATCH[Creator Lifecycle Notification Dispatcher]
    GMAIL[Gmail]
    
    SENT_DEMO[Sent-State Tracking<br/>Request_Master]
    SENT_YT[Sent-State Tracking<br/>YouTube_Responses]
    
    INTAKE -->|Interactive Demo<br/>submission| CFR
    INTAKE -->|YouTube<br/>submission| YT
    
    CFR --> HUB_DEMO
    HUB_DEMO --> RM
    
    HUB_DEMO -->|SUBMISSION_RECEIVED| NORM
    RM -->|CONTENT_PUBLISHED| NORM
    RM -->|CONTENT_RETIRED| NORM
    
    YT -->|SUBMISSION_RECEIVED| NORM
    YT -->|CONTENT_RETIRED| NORM
    
    NORM --> DISPATCH
    DISPATCH --> GMAIL
    
    GMAIL -->|Interactive Demo<br/>email sent| SENT_DEMO
    GMAIL -->|YouTube<br/>email sent| SENT_YT
    
    SENT_DEMO --> RM
    SENT_YT --> YT
```

**Key principles:**
- Hub normalizes content-type-specific statuses into shared lifecycle events
- Interactive Demo produces three lifecycle events (submission, published, retired)
- YouTube produces two lifecycle events (submission, retired) — no separate published email
- Email sent-state tracking is independent from Slack notifications
- Intake does not send creator lifecycle emails independently

## Performance Review Workflow

The Hub supports periodic performance review by combining metrics data, generating recommendations, and facilitating creator update-plan responses.

```mermaid
graph TB
    DB[Databricks]
    ATM[All Time Metrics Sheet<br/>Manual SQL Paste]
    
    METRICS[RM_Metrics.js<br/>YTD Metrics Pull]
    ALLTIME[RH_AllTimeMetricsMap.js<br/>All-Time & L90 Sync]
    
    RM[Request_Master<br/>Metrics Storage]
    
    PERF[RM_Performance.js<br/>Performance Analysis]
    SIGNALS[Performance Signals & Flags<br/>Recommended Action & Priority<br/>Score / Tier / Trend]
    
    EMAILGEN[email_gen.js<br/>Email Draft Generator]
    DRAFT[Gmail Draft]
    
    FORM[Creator Update Form]
    RAW[lifecycle_raw_updates Sheet]
    ROUTE[onFormSubmit Routing]
    SYNC[onUpdatePlanFormSubmit<br/>syncFormResponsesToQueue]
    QUEUE[Response_Queue]
    
    DB --> METRICS
    METRICS --> RM
    
    ATM --> ALLTIME
    ALLTIME --> RM
    
    RM --> PERF
    PERF --> SIGNALS
    SIGNALS --> RM
    
    RM --> EMAILGEN
    EMAILGEN --> DRAFT
    
    DRAFT -.->|Creator responds| FORM
    FORM --> RAW
    RAW --> ROUTE
    ROUTE --> SYNC
    SYNC --> QUEUE
```

**Key components:**
- **RM_Metrics.js** — Pulls YTD engagement and sales metrics from Databricks API
- **RH_AllTimeMetricsMap.js** — Syncs all-time and L90 metrics from manual SQL paste
- **RM_Performance.js** — Analyzes metrics and generates performance signals, flags, and recommendations
- **email_gen.js** — Generates Gmail drafts for creator performance review (manual, not automatic lifecycle emails)
- **Performance review responses** — Routed through central onFormSubmit to Response_Queue for admin follow-up

**Important distinctions:**
- Performance review emails are **Gmail drafts** generated manually, not automatic lifecycle notifications
- YTD metrics (Databricks API) and all-time/L90 metrics (manual SQL) are separate workflows
- Creator update-plan responses flow through lifecycle_raw_updates → Response_Queue for admin review

## Content types

**Interactive Experience** is the overall program.

Currently supported content types:
- **Interactive Demo**
- **YouTube** (video content)

Each content type may maintain its own status model and workflow within its source repository.

## Repositories and identity

The Hub processes content from multiple repositories:

- **Creator_Form_Raw** — Initial Interactive Demo creator submissions from Intake
- **Request_Master** — Downstream Interactive Demo lifecycle and workflow records
- **YouTube_Responses** — YouTube intake and lifecycle records

Downstream lifecycle records are resolved using:

```text
sourceRepository + Number
```

where `sourceRepository` is the downstream lifecycle repository (Request_Master or YouTube_Responses) and `Number` refers to the value in that repository's `Number` column, not the physical spreadsheet row number.

## Lifecycle normalization

For creator lifecycle notifications, the Hub normalizes content-type-specific statuses into shared lifecycle events:

- **SUBMISSION_RECEIVED** — Initial creator submission
- **CONTENT_PUBLISHED** — Content has reached the published lifecycle stage
- **CONTENT_RETIRED** — Content is no longer active

Raw statuses can differ by content type, but lifecycle notifications use these normalized events.

**Example**: A newly submitted YouTube record may have raw `Status = Published` in YouTube_Responses, but still maps to `SUBMISSION_RECEIVED` for creator lifecycle notification purposes. This is because YouTube videos are already published to YouTube before entering the Interactive Experience workflow.

## Notification architecture

The Hub is the centralized lifecycle notification layer.

**Key principles**:
- Slack notifications and creator email notifications are independent channels
- Each channel maintains its own sent-state tracking
- One notification channel failing should not block the other
- Idempotency is enforced via per-event sent-state columns

**Sent-state columns** (example):
- `Creator Submission Email Sent?`
- `Creator Published Email Sent?`
- `Creator Retired Email Sent?`

These are independent from Slack notification sent flags.

## Discovery web app

The Hub provides a search and discovery web app for Interactive Experience content.

**Card display**:
- Type (Interactive Demo / Video Demo)
- Title
- Primary Product
- Primary Topic
- Status

**Detail view Overview section**:
- Primary Product
- Product (other related products)
- Primary Topic
- Topic (other related topics)

Topic fields apply to Interactive Demo only. Video Demo submissions do not use Topic fields.

## Design principles

- **Content types may keep their own status models** — Video Demo records use "Published" as their initial status, while Interactive Demos use "Demo Received"
- **Shared lifecycle behavior is normalized in the Hub** — Downstream workflows operate on normalized lifecycle events, not raw statuses
- **Intake owns submission experience** — Creator-facing forms, AI-assisted drafting, and Status Tracker live in the Intake application
- **Hub owns downstream lifecycle orchestration** — Notifications, Discovery, performance analysis, and data synchronization are Hub responsibilities
