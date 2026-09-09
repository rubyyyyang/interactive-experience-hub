# Interactive Experience Runbook

## Normal development

The standard development flow is:

```text
local changes
→ targeted tests
→ clasp push
→ validate in the Apps Script development deployment
→ commit and push Git changes
→ manually update the versioned deployment in Google Apps Script
→ production smoke test
```

Git is the shared source of truth for the codebase. Google Apps Script is the runtime and deployment environment.

`.clasp.json` remains local and maps the local repository to the corresponding Apps Script project.

`clasp push` updates the Apps Script project source code. Production deployment is currently updated manually in Google Apps Script.

## Development vs production deployment

The development and production deployments behave differently:

- `/dev` uses the latest Apps Script project code.
- `/exec` may point to a versioned deployment.
- `clasp push` does not automatically update the production `/exec` deployment.

After validating changes in development, manually update the production deployment in Google Apps Script.

## Tests

Run local deterministic tests:

```bash
npm test
```

Additional browser test commands supported by this repository are available in `package.json`.

For Intake-specific authenticated browser testing, see the [Interactive Experience Intake](https://github.com/rubyyyyyang/interactive-experience-intake) repository.

## Triggers

The Hub uses installable triggers for privileged spreadsheet workflows.

`handleSpreadsheetEdit` is used as the installable spreadsheet edit handler. This installable handler runs with the Apps Script permissions authorized for the project.

Do not introduce a reserved top-level `onEdit(event)` handler for the same privileged workflow. A simple trigger can execute separately with limited authorization, which can cause duplicate executions and authorization failures.

When adding edit-based workflow logic, either extend the existing `handleSpreadsheetEdit` routing or intentionally create a separate installable trigger.

Triggers can be reviewed in the Google Apps Script Triggers panel.

`installTriggers()` is used by the project to configure supported triggers.

`deleteAllTriggers()` removes all installable triggers for the project. Review the existing trigger configuration before using it. It should not be treated as a routine development step.

## Troubleshooting

For workflow or notification failures, check:

1. Apps Script Executions
2. whether the expected development or production deployment is running
3. installable trigger configuration
4. expected Google Sheet columns and status values
5. Script Properties and configuration
6. notification sent-state columns used for idempotency

For creator lifecycle email issues, also verify:

- the creator email address is available
- the record qualifies for creator lifecycle notifications
- the raw status maps to the expected normalized lifecycle event
- the corresponding creator email sent flag has not already been set

## Deployment safety

Before updating production:

- validate changes in the development deployment
- remember that `clasp push` does not update `/exec`
- preserve the current trigger configuration unless intentionally changing it
- run a small production smoke test after deployment
