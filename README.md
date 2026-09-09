# Interactive Experience Hub

The Interactive Experience Hub is a Google Apps Script application that supports downstream lifecycle management, notifications, discovery, and data workflows for Interactive Experience content.

It works together with the [Interactive Experience Intake](https://github.com/rubyyyyang/interactive-experience-intake) application.

## What the Hub owns

The Hub currently supports:

- lifecycle processing for Interactive Demo and YouTube content
- creator lifecycle email notifications
- Slack lifecycle notifications
- Request_Master workflow processing
- Discovery search and browse experiences
- lifecycle, performance, and data synchronization workflows

The primary operational data is stored in Google Sheets.

## Development

Prerequisites:

- Node.js
- `clasp`
- access to the relevant Red Hat Google Workspace resources

Install dependencies:

```bash
npm install
```

Run local deterministic tests:

```bash
npm test
```

Additional browser test commands are available in `package.json`.

## Apps Script

Git is the shared source of truth for the codebase. Google Apps Script is the runtime and deployment environment.

For normal development:

```text
local changes
→ tests
→ clasp push
→ validate in the Apps Script development deployment
→ manually update the production deployment
```

Production deployment is currently performed manually in Google Apps Script after development validation.

`.clasp.json` is kept local and maps the local repository to the corresponding Apps Script project.

`.claspignore` defines which local development files are excluded from Apps Script deployment.

## Related repository

Creator-facing intake, AI-assisted submission processing, and the Status Tracker are maintained in:

[Interactive Experience Intake](https://github.com/rubyyyyang/interactive-experience-intake)
