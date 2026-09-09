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

## Documentation

- [Architecture](docs/architecture.md)
- [Runbook](docs/runbook.md)

## Internal Resources

- [Google Apps Script project](https://script.google.com/u/0/home/projects/1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ/edit)
- [Request_Master spreadsheet](https://docs.google.com/spreadsheets/d/1t7TJtTL-jbUaCVKVLMMOahbKcL5b1IyCf3uUSCmQo4A/edit?gid=1123598561#gid=1123598561)
- [Production app](https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/exec)

## Related repository

Creator-facing intake, AI-assisted submission processing, and the Status Tracker are maintained in:

[Interactive Experience Intake](https://github.com/rubyyyyang/interactive-experience-intake)
