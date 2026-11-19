# Package 2A: Global Header & Resources Navigation - Deployment Guide

## Overview

Package 2A adds a Global Header component with responsive navigation to the Hub Discovery page. This guide documents the deployment procedure, navigation behavior, and verification steps.

## What This Package Adds

### Global Header Component
- **discovery_css.html**: 433 lines of responsive header styles
  - Sticky positioning with Red Hat branding
  - Dropdown navigation menus (Create & Submit, Resources)
  - Mobile hamburger menu (≤768px breakpoint)
  - Dark/light theme support
- **discovery_js.html**: 134 lines of header JavaScript
  - Mobile menu toggle functionality
  - Dropdown menu interactions
  - Keyboard navigation (Escape, Enter, Space)

### Environment-Aware Cross-App Navigation
- **DiscoveryWebApp.js**: Intake URL detection (already in main)
  - Detects DEV vs Production via `ScriptApp.getService().getUrl()`
  - Passes `intakeBaseUrl` to discovery template
- **discovery.html**: Native anchor links with template printing (already in main)

### Resources Dropdown Navigation
- **Desktop (>768px)**: 330px dropdown menu with 3 sections
- **Mobile (≤768px)**: Always-expanded drawer section
- **Items**: User Guide, Documentation, Analytics Dashboard, Slack, Submit Feedback

### Testing
- **tests/package2a-nav-destinations.test.js**: 19 navigation assertions
- **tests/package2a-layout-alignment.test.js**: 10 layout assertions

## Apps Script Project

**Project ID:** `1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ`

**Deployments:**
- DEV HEAD: `AKfycbxvHiD1Xab3gsf0pYA-k5ZejnRyabPupv6gULcY4m21` (@HEAD)
- Production: Version-based deployment (separate approval required)

## Deployment Procedure

### 1. Merge to Main

```bash
git checkout main
git pull origin main
git merge feature/package-2a-global-header
git push origin main
```

### 2. Create Deployment Worktree

```bash
# Use the verified main commit SHA after merge
git worktree add /tmp/deploy-hub-package2a <main-commit-sha>
cd /tmp/deploy-hub-package2a
git rev-parse HEAD  # Verify SHA
```

### 3. Configure clasp

```bash
cat > .clasp.json << 'EOF'
{
  "scriptId": "1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ",
  "rootDir": "."
}
EOF
```

**Verify project ID before proceeding.**

### 4. Run Tests

```bash
npm test
```

Expected: All tests pass (10 test files).

### 5. Deploy to Apps Script

```bash
clasp push
```

This updates @HEAD, which serves DEV.

### 6. Verify Deployment

```bash
mkdir /tmp/verify-hub-deployment
cd /tmp/verify-hub-deployment
cat > .clasp.json << 'EOF'
{
  "scriptId": "1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ"
}
EOF
clasp pull

# Verify files match source
diff -q discovery_css.html /tmp/deploy-hub-package2a/discovery_css.html
diff -q discovery_js.html /tmp/deploy-hub-package2a/discovery_js.html
```

### 7. Browser Testing

**DEV URL:** `https://script.google.com/a/macros/redhat.com/s/AKfycbxvHiD1Xab3gsf0pYA-k5ZejnRyabPupv6gULcY4m21/dev`

**Test:**
- Global Header visible and sticky
- Resources dropdown contains 5 links + Submit Feedback button
- Mobile menu (≤768px) works correctly
- Environment-aware navigation (DEV → Intake DEV)

### 8. Cleanup

```bash
cd /tmp
git worktree remove deploy-hub-package2a
```

## Production Deployment

Production deployment requires:
1. Successful DEV deployment and testing
2. Approval from stakeholders
3. Version creation in Apps Script
4. Deployment to versioned Production URL

**Do not deploy to Production without explicit approval.**

## Navigation Behavior

### Resources Dropdown

**Desktop (>768px):**
- 330px dropdown below Resources button
- 3 labeled sections: Guides & Documentation, Explore & Analyze, Help & Feedback
- 5 links + 1 Submit Feedback button

**Mobile (≤768px):**
- Always-expanded section in hamburger drawer
- Same 3 sections and 6 items as desktop
- No duplication

**Items:**
1. Best Practices Guide → Google Doc
2. Documentation → source.redhat.com  
3. Public Interactive Experiences → redhat.com
4. Analytics Dashboard → Superset
5. Ask in Slack → #interact-hub channel
6. Submit Feedback → Opens modal (button)

### Environment-Aware Navigation

**Create & Submit Menu:**
- Submit a Demo → `intakeBaseUrl` (DEV or Production)
- Check My Submissions → `intakeBaseUrl?page=status`

**Detection Logic (DiscoveryWebApp.js):**
```javascript
const baseUrl = ScriptApp.getService().getUrl() || '';
const isDev = baseUrl.indexOf('/dev') > -1;
const intakeBaseUrl = isDev
  ? 'https://script.google.com/.../dev'
  : 'https://script.google.com/.../exec';
```

### Mobile Behavior

**Hamburger Menu (≤768px):**
- Opens 280px right-side drawer
- Contains all navigation sections (expanded)
- Closes on outside click or Escape key
- Modal interactions close drawer (Saved Demos, Feedback)

## Layout Alignment

**Global Header:**
- Full viewport width (no max-width constraint)
- Sticky positioning (top: 0, z-index: 1000)
- 1600px content container inside header

**Page Content:**
- .wrap: 1600px max-width, 16px horizontal padding
- Global Header positioned outside .wrap

## Rollback Procedure

If issues occur in Production:

1. Identify last known good version
2. Update Production deployment to previous version via Apps Script UI
3. Verify rollback in browser
4. Investigate issue in DEV before redeploying

**Note:** @HEAD deployment (DEV) is independent of versioned Production deployment.

## Known Issues and Resolutions

### Branch Switching During Deployment
**Problem:** Shell context can switch branches between verification and deployment  
**Solution:** Use isolated Git worktrees pinned to specific commit SHA

### CSS Pseudo-Element Duplicate Headings
**Problem:** Resources section heading duplicated on mobile  
**Solution:** Exclude Resources dropdown from pseudo-element rule: `.navDropdownMenu:not(#resourcesDropdown)::before`

### Search/Filters Sticky Overlap
**Problem:** Search toolbar overlapped Global Header when scrolling  
**Solution:** Remove sticky positioning from .toolbarWrap, allow natural scroll

## Verification Checklist

- [ ] All tests pass locally
- [ ] Commit SHA verified in deployment worktree
- [ ] .clasp.json created with correct project ID
- [ ] clasp push successful
- [ ] Deployed files match source (via independent clasp pull)
- [ ] Browser testing complete (desktop and mobile)
- [ ] No regressions in existing functionality
- [ ] Environment-aware navigation verified (DEV → Intake DEV)
