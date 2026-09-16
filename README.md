# Interactive Experience Hub

The Interactive Experience Hub is a Google Apps Script solution for downstream lifecycle management, notifications, discovery, and data workflows for Interactive Experience content.

The Hub provides three main areas:

1. **Spreadsheet Operations** — Content lifecycle management and performance review workflows in Google Sheets
2. **Web Experience** — Search and discovery web app for Interactive Experience content
3. **Background Automation & Integrations** — Creator and Slack notifications, form/edit triggers, and data synchronization

It works together with the [Interactive Experience Intake](https://github.com/rubyyyyyang/interactive-experience-intake) application.

The spreadsheet is the Hub's operational workspace and data layer. The Apps Script project is the execution layer.

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

**GitHub `main` is the source of truth for Apps Script source.** Start work from the latest `main` branch, test changes in the DEV Apps Script project, then commit the tested source back to `main`. Avoid unreconciled source edits directly in Apps Script.

Google Apps Script is the runtime and deployment environment.

For normal development:

```text
local changes
→ tests
→ clasp push to DEV
→ validate in the DEV Apps Script deployment
→ commit tested source to GitHub main
→ manually update the production deployment
```

Production deployment is currently performed manually in Google Apps Script after development validation.

`.clasp.json` is kept local and maps the local repository to the corresponding Apps Script project.

`.claspignore` defines which local development files are excluded from Apps Script deployment.

## Documentation

- [Architecture](docs/architecture.md) — System structure, data flows, and major workflows
- [Code Map](docs/code-map.md) — Current source files and their responsibilities
- [Runbook](docs/runbook.md) — Testing, deployment, triggers, and troubleshooting

## Internal Resources

- [Google Apps Script project](https://script.google.com/u/0/home/projects/1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ/edit)
- [Request_Master spreadsheet](https://docs.google.com/spreadsheets/d/1t7TJtTL-jbUaCVKVLMMOahbKcL5b1IyCf3uUSCmQo4A/edit?gid=1123598561#gid=1123598561)
- [Production app](https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/exec)

## Related repository

Creator-facing intake, AI-assisted submission processing, and the Status Tracker are maintained in:

[Interactive Experience Intake](https://github.com/rubyyyyang/interactive-experience-intake)
