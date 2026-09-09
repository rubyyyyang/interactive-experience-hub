# Interactive Experience Architecture

## System overview

The Interactive Experience program supports two primary applications:

**Interactive Experience Intake**
- Creator-facing submission experience for Interactive Demo and YouTube content
- AI-assisted metadata drafting
- Review and status tracking interface (Status Tracker)
- Writes Interactive Demo submissions to Creator_Form_Raw
- Writes YouTube submissions to YouTube_Responses
- Notifies Hub for downstream processing

**Interactive Experience Hub**
- Reads from Creator_Form_Raw and processes Interactive Demo submissions into Request_Master
- Reads from YouTube_Responses for YouTube lifecycle processing
- Request_Master workflow orchestration
- Creator lifecycle email notifications
- Slack lifecycle notifications
- Discovery web app (search and browse experience)
- Supporting workflows for lifecycle analysis, performance metrics, and data synchronization

**Data flow**:

```text
Interactive Demo:
  Interactive Experience Intake
          ↓
  Creator_Form_Raw
          ↓
  Interactive Experience Hub
          ↓
  Request_Master
          ↓
  Lifecycle processing → Notifications / Discovery

YouTube:
  Interactive Experience Intake
          ↓
  YouTube_Responses
          ↓
  Interactive Experience Hub
          ↓
  Lifecycle processing → Notifications / Discovery
```

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

## Design principles

- **Content types may keep their own status models** — YouTube records use "Published" as their initial status, while Interactive Demos use "Demo Received"
- **Shared lifecycle behavior is normalized in the Hub** — Downstream workflows operate on normalized lifecycle events, not raw statuses
- **Intake owns submission experience** — Creator-facing forms, AI-assisted drafting, and Status Tracker live in the Intake application
- **Hub owns downstream lifecycle orchestration** — Notifications, Discovery, performance analysis, and data synchronization are Hub responsibilities
