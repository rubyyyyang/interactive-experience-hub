# CLAUDE.md

@AGENTS.md

## Claude Code

Use Plan Mode for architectural, multi-file, high-risk, or unclear changes. For small, well-understood changes, avoid unnecessary exploration and make the smallest safe change.

## Google Sheets Access

For external read-only Google Sheets access, use this repository's established Google Cloud authentication path.

Established service account:

`arcade-lifecycle-management@arcade-lifecycle-management.iam.gserviceaccount.com`

Access pattern:

- Use the existing authenticated Google Cloud user / ADC session.
- Impersonate the established service account.
- Request the Google Sheets read-only scope:
  `https://www.googleapis.com/auth/spreadsheets.readonly`
- Access spreadsheet data through the Google Sheets API.

Do not treat the interactive gcloud user identity itself as the spreadsheet-access identity.

If access fails, identify the failing layer before changing anything:

- local gcloud authentication or ADC
- service-account impersonation / IAM
- OAuth scopes
- required Google API enablement
- quota project
- spreadsheet sharing / permission

Report the exact limitation.

Do not create or download service-account keys, rotate credentials, modify IAM, change authentication configuration, or build a new access mechanism unless explicitly requested.

Do not scrape the Google Sheets browser UI as a substitute for direct API access.

If direct Sheet access is temporarily unavailable, use the cheapest remaining diagnostic that answers the underlying question rather than exhaustively working around the blocked access path.

Use `/memory` if needed to confirm which project instructions are loaded.