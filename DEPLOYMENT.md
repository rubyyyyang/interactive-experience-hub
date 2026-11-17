# Package 2A: Global Header & Resources Navigation - Deployment Guide

## Final Deployed State

**DEV Deployment Date:** 2026-11-16  
**Deployed Commit:** `a3ebb2db65a1f26d95d99d708428fa8a1a50749b`  
**GitHub Branch:** `feature/package-2a-global-header`  
**Apps Script Project:** 1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ (Hub DEV)

## Isolated Git Worktree Deployment Procedure

### Why Isolated Worktrees?

**Problem:** Deploying from a directory where you actively switch branches can cause wrong code to be pushed to Apps Script HEAD if shell context changes between verification and deployment.

**Solution:** Use isolated Git worktrees that are pinned to a specific commit.

### Deployment Steps

```bash
# 1. Create isolated worktree pinned to verified commit SHA
git worktree add /tmp/deploy-package2a <commit-sha>

# 2. Navigate to worktree
cd /tmp/deploy-package2a

# 3. Verify commit SHA
git rev-parse HEAD
# Expected: <commit-sha>

# 4. Create .clasp.json (gitignored, not in worktree by default)
cat > .clasp.json << 'EOF'
{"scriptId":"1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ","rootDir":"."}
EOF

# 5. Verify Hub script ID
cat .clasp.json
# Expected: {"scriptId":"1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ","rootDir":"."}
# WARNING: Verify this is the correct Hub project ID before proceeding

# 6. Verify .claspignore excludes test files
cat .claspignore | grep -E "test|playwright|package"

# 7. Deploy to Apps Script
clasp push

# 8. Verify deployment in independent temp directory
cd /tmp && mkdir verify-deployment && cd verify-deployment
cat > .clasp.json << 'CLASP'
{"scriptId":"1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ","rootDir":"."}
CLASP
clasp pull

# 9. Compare frontend files
diff -q discovery.html /tmp/deploy-package2a/discovery.html
diff -q discovery_css.html /tmp/deploy-package2a/discovery_css.html
diff -q discovery_js.html /tmp/deploy-package2a/discovery_js.html

# 10. Cleanup worktree (optional)
cd /tmp
git worktree remove deploy-package2a

# IMPORTANT: Do not commit .clasp.json
# .clasp.json is gitignored and contains environment-specific script IDs
```

### Pre-Deployment Checklist

- [ ] All tests pass (100/100)
- [ ] Commit SHA verified
- [ ] No uncommitted changes
- [ ] **.clasp.json created in worktree** (gitignored, not in repo)
- [ ] Script ID verified: 1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ (Hub)
- [ ] .claspignore excludes test/playwright/package files
- [ ] 20 deployable files confirmed

### Post-Deployment Verification

- [ ] Remote HEAD pulled to independent directory
- [ ] Frontend files (HTML/CSS/JS) match byte-for-byte
- [ ] Structure verified in remote files
- [ ] Functional testing at 375px and 1440px
- [ ] No regressions in existing functionality

## Package 2A Navigation Behavior

### Global Header (Sticky)

**Position:** Always visible at top of viewport  
**z-index:** 1000  
**Items (left to right):**
1. Red Hat logo + "The Interact Hub" brand
2. Create & Submit dropdown
3. AI Assistant link
4. Resources dropdown ← **Package 2A deliverable**
5. Account dropdown
6. Mobile hamburger menu (≤768px)

### Resources Dropdown

**Desktop (>768px):**
- Width: 330px
- Position: Dropdown below Resources button
- Structure: 3 labeled sections, 7 total items

**Mobile (≤768px):**
- Position: Always-expanded section in right-side drawer
- Structure: Same 3 labeled sections, 7 total items
- No duplicate More Resources section

**Section Structure:**

```
GUIDES & DOCUMENTATION
  • User Guide → GitHub user-guide.md
  • Best Practices Guide → Google Doc
  • The Source → source.redhat.com

EXPLORE & ANALYZE
  • Public Interactive Experiences → redhat.com
  • Analytics Dashboard → Superset

HELP & FEEDBACK
  • Ask in Slack → C07HQMHFWQG
  • Send Feedback → openFeedbackModal()
```

### Search and Filters (Non-Sticky)

**Position:** Scrolls naturally with page content  
**Behavior:** 
- Search and filters scroll out of view when user scrolls down
- Global Header remains visible while content scrolls
- No overlap with Global Header
- No unexpected whitespace or clipping

**Components:**
- Search input with recent searches dropdown
- Quick Filters: RHEL, OpenShift, Ansible, AI, Virtualization
- Advanced filters: Formats, Products, TDPs, Sales Tactics, Marketing Programs, Creator Names
- Apply and Reset buttons

### Mobile Navigation (≤768px)

**Hamburger Menu:**
- Position: Top-right of Global Header
- Triggers: Right-side drawer (280px width)
- Animation: Slides in from right

**Drawer Structure (always expanded):**
1. Create & Submit section (3 links)
2. AI Assistant link
3. Resources section (3 labeled groups, 7 items)
4. Account section (user info + Saved Demos + Theme)

**Modal Behavior:**
- Send Feedback: Opens modal, closes drawer (≤768px only)
- Saved Demos: Opens modal, closes drawer (≤768px only)
- Theme toggle: Cycles system → light → dark

### CSS Pseudo-Element Rules

**Create & Submit and Account dropdowns:**
```css
.navDropdownMenu:not(#resourcesDropdown)::before {
  content: attr(data-section);
  /* Generates section heading from data-section attribute */
}
```

**Resources dropdown:**
- Excluded from pseudo-element rule
- Uses explicit `navDropdownSectionLabel` divs
- Prevents duplicate headings on mobile

## Key Implementation Decisions

### Unified Markup Strategy

**Approach:** Single Resources dropdown serves both desktop and mobile
- Desktop: Displayed as 330px dropdown
- Mobile: Displayed as always-expanded drawer section
- Section labels visible on both viewports
- No duplicate link definitions

**Benefits:**
- Single source of truth
- No synchronization issues
- Minimal CSS differences between viewports

### Responsive Visibility

**Desktop-only items:** None (all 7 Resources items visible on both)
**Mobile-only items:** None (unified structure)
**Label visibility:** All section labels visible on both viewports

**Removed pattern:** Separate mobileOnly More Resources section (caused duplicates)

### Z-Index Layering

- Global Header: 1000 (top-most, always visible)
- Navigation dropdowns: 1001 (appear above header when open)
- Mobile drawer: 1001 (appears above header)
- Selection floating toolbar: Auto (no z-index, floats with scroll)
- Search/Filters: Auto (scrolls naturally, no z-index)

## Testing

**Test Coverage:** 100 tests (81 existing + 19 Package 2A)

**Package 2A Tests:**
- Destination URLs (7 resources)
- Section labels and structure
- Mobile/desktop visibility
- Item count and ordering
- No duplicate sections or links
- Modal close behaviors

**Test File:** `tests/package2a-nav-destinations.test.js`

**Run tests:**
```bash
npm test
```

## Known Issues and Resolutions

### Issue 1: Branch Switching During Deployment
**Symptom:** Wrong code deployed to Apps Script HEAD  
**Root Cause:** Shell context switched branches between verification and deployment  
**Resolution:** Use isolated Git worktrees pinned to verified commit SHA

### Issue 2: CSS Pseudo-Element Duplicate Headings
**Symptom:** "RESOURCES" heading appeared above "GUIDES & DOCUMENTATION" on mobile  
**Root Cause:** `.navDropdownMenu::before` generated heading from `data-section` attribute  
**Resolution:** Exclude Resources dropdown: `.navDropdownMenu:not(#resourcesDropdown)::before`

### Issue 3: Mobile Navigation Duplication
**Symptom:** Resources items appeared in both Resources and More Resources sections  
**Root Cause:** Separate mobileOnly section duplicated desktop items  
**Resolution:** Unified markup, removed More Resources section, all 7 items in single Resources section

### Issue 4: Search/Filters Sticky Overlap
**Symptom:** Search toolbar overlapped Global Header when scrolling  
**Root Cause:** `.toolbarWrap` had `position: sticky; top: 0`  
**Resolution:** Removed sticky positioning, allow natural scroll

## Production Deployment (Not Yet Authorized)

**Important:** Hub DEV HEAD and Production @153 are deployments of the **same** Apps Script project (ID: 1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ). Do not switch script IDs.

**Steps for future authorized Production release:**

1. **Merge to main (preserving independent commits)**
   ```bash
   # Note: main contains independent performance docs commit not on feature branch
   git checkout main
   git pull origin main
   git merge feature/package-2a-global-header
   # Resolve any conflicts, preserve both branches' commits
   ```

2. **Create isolated worktree from verified main commit**
   ```bash
   git worktree add /tmp/deploy-production <verified-main-sha>
   cd /tmp/deploy-production
   ```

3. **Create .clasp.json with Hub project ID**
   ```bash
   cat > .clasp.json << 'EOF'
   {"scriptId":"1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ","rootDir":"."}
   EOF
   # Verify: This is the SAME script ID as DEV (Hub uses HEAD and versioned deployments)
   ```

4. **Run full test suite**
   ```bash
   npm test
   # Expected: 100/100 tests pass
   ```

5. **Deploy to Production (creates new version, updates @153 deployment)**
   ```bash
   clasp push
   # This updates HEAD (currently deployed to DEV)
   
   # Create new version for Production
   clasp version "Package 2A: Global Header and Resources Navigation"
   
   # Update existing Production deployment @153 to new version
   # (Preserves deployment ID and URL, updates code to new version)
   # Deployment ID @153 continues to serve users without URL changes
   ```

6. **Verify Production deployment independently**
   ```bash
   cd /tmp/verify-production
   cat > .clasp.json << 'EOF'
   {"scriptId":"1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ","rootDir":"."}
   EOF
   clasp pull --versionNumber <new-version-number>
   # Compare against expected files
   ```

7. **Functional testing at multiple viewports**
   - Desktop: 1440px, 1920px
   - Tablet: 768px
   - Mobile: 375px, 414px

8. **Monitor for user feedback**
   - Check Slack feedback channel
   - Monitor for error reports
   - Verify Resources dropdown usage

**Current Status:** Production release NOT AUTHORIZED. DEV deployment only.

## Files Changed

**HTML (1 file):**
- `discovery.html` - Global Header structure, Resources dropdown

**CSS (1 file):**
- `discovery_css.html` - Header styling, Resources sections, responsive rules

**Tests (1 file):**
- `tests/package2a-nav-destinations.test.js` - Navigation verification (new)

**Configuration (1 file):**
- `package.json` - Added Package 2A tests to npm test command

**Total:** 4 files, 176 insertions, 37 deletions

## Commit History

```
a3ebb2d fix: remove sticky positioning from Search and Filters toolbar
996d553 fix: prevent duplicate Resources heading from CSS pseudo-element on mobile
d0946df fix: consolidate mobile Resources navigation into single unified section
01373eb feat: refine Package 2A Resources navigation with grouped sections
864c9cf fix: align Package 2A navigation with frozen contract
ae60b4a test: add Package 2A navigation destination and visibility tests
eb2b4f0 fix: eliminate mobile resource duplication with desktopOnly class
ebb008b fix: correct Package 2A navigation destinations and resource accessibility
0f941db feat: simplify mobile navigation with expanded sections
a382f71 fix: mobile menu layout - prevent vertical distribution of nav items
abdfa56 fix: exclude playwright.config.js from clasp deployment
```

Total: 11 commits from baseline to final Package 2A

## Next Steps: Package 2B

Package 2B will address additional navigation and UX refinements as specified in separate requirements. Implementation will follow the same isolated worktree deployment procedure and testing rigor established in Package 2A.
