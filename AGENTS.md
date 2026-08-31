# AGENTS.md

Verification workflow for Arcade Finder.

## Context → Impact → Plan → Build → Verify → Review → Evidence → Stop

### Verification Rules

**`npm test`** = Local deterministic Finder logic
- Search text normalization (`normalizeSearchText_`)
- Synonym expansion (`expandSearchTokenGroup_`)
- Status normalization (`normalizeStatusCanonical`)
- Discovery visibility rules (`computeIsReadyToUse_`, `computeIsDiscoverable_`)
- Email domain validation (config check)
- **When**: Always before deployment
- **Runtime**: <1 second, 6 tests
- **Verifies**: Pure functions, no Apps Script runtime required

**Playwright (`npm run test:e2e`)** = Authenticated browser verification
- Finder app smoke test (UI loads, search visible, data loads, no errors)
- Core discovery search flow (search, filter, reset)
- **Target**: Apps Script `/dev` deployment
- **When**: After changes to `discovery.html`, browser-side behavior, search UI, navigation, or rendering
- **Runtime**: ~20 seconds, 2 tests
- **Verifies**: Browser UI and client-side behavior only

### What Remains Manual/Unverified

- **Sheets backend integrations**: `google.script.run` calls, `Request_Master` reads/writes
- **Server-side Apps Script logic**: `DiscoveryWebApp.js` server functions, caching, pagination
- **Email/Slack notifications**: Actual sending via RM_Utils
- **Document generation**: Drive API template operations
- **Multi-user concurrency**: Shared sheet state
- **Cross-browser compatibility**: Only Chromium tested

**Verification claim guidance:**
- ✅ Claim "local logic verified" when `npm test` passes
- ✅ Claim "browser UI verified" when Playwright passes against `/dev`
- ❌ Do NOT claim "Sheets integration verified" unless manually tested
- ❌ Do NOT claim "backend verified" for server-side Apps Script changes

### Deployment Checklist

Before deploying to `/exec` (production):
1. Run `npm test` (6 deterministic tests must pass)
2. Run `npm run test:e2e` (2 browser tests must pass against `/dev`)
3. Manual smoke test production `/exec` URL after deployment
4. Verify no console errors in production deployment

### Setup

**One-time authentication** (when auth expires):
```bash
rm playwright/.auth/user.json
npx playwright test tests/auth.setup.ts --headed --project=setup
```

**Normal workflow**:
```bash
npm test                  # Local deterministic tests
npm run test:e2e          # Browser tests (headless)
npm run test:e2e:headed   # Browser tests (see browser)
npm run test:e2e:ui       # UI mode
```
