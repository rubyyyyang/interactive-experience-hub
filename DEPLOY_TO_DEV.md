# Deploy Package 3A to DEV for Browser Testing

**PR**: #11 (feature/package-3a-filter-ui)  
**Commit**: af91b4d (latest)  
**Purpose**: Browser verification of automated tests and manual testing

## Pre-Deployment Checklist

- [x] All corrections committed and pushed to PR #11
- [x] Button order fixed: Search + More filters + Apply + Reset
- [x] removeAppliedFilter() marks pending (Manual Apply preserved)
- [x] Test assertions throw on failure (reliable pass/fail)
- [x] Quick Filter mappings verified (AI, Virtualization correct)
- [x] .clasp.json configured in worktree
- [x] appsscript.json exists in worktree

## Deployment Steps

### 1. Push to DEV Apps Script

```bash
cd "/Users/rubyyang/Arcade Finder/.claude/worktrees/package-3a"
clasp push
```

**Expected Output**:
```
└─ appsscript.json
└─ discovery.html
└─ discovery_css.html
└─ discovery_js.html
... (other files)
Pushed X files.
```

### 2. Open DEV Discovery Page

**URL**: Check Apps Script deployment URL for DEV environment  
**Browser**: Chrome or Firefox (DevTools required)

### 3. Load Test Suite

Open browser DevTools console and paste:

```javascript
// Load test suite
const script = document.createElement('script');
script.src = 'https://raw.githubusercontent.com/rubyyyyang/interactive-experience-hub/feature/package-3a-filter-ui/tests/package-3a-regression.test.js';
document.head.appendChild(script);

// OR paste test file contents directly into console
```

### 4. Run Tests

```javascript
runPackage3ATests()
```

**Expected Output** (if all pass):
```
=== Package 3A Regression Tests ===

Test 1: Quick Filter toggle behavior
✓ Test 1 passed
Test 2: Browse by Experience preserves other filters
✓ Test 2 passed
Test 3: Advanced filter sync to Quick Filters
✓ Test 3 passed
Test 4: No reload before Apply
✓ Test 4 passed
Test 5: Pending indication on Apply button
✓ Test 5 passed
Test 6: More Filters starts collapsed
✓ Test 6 passed
Test 7: Applied filters display and manual apply after removal
✓ Test 7 passed

✅ All Package 3A regression tests passed!
```

**If any test fails**:
- Error will throw with assertion message
- Note which test failed
- Note exact error message
- Report back for fix

### 5. Manual Verification (After Automated Pass)

**Desktop (Light Theme)**:
- [ ] Quick Filters toggle and show active state
- [ ] Browse cards highlight on click
- [ ] More Filters expands/collapses
- [ ] Dropdowns not clipped when More Filters expanded
- [ ] Applied filter chips appear after Apply
- [ ] Clicking X on chip marks pending (Apply* shown)
- [ ] Apply button reloads results

**Desktop (Dark Theme)**:
- [ ] Switch theme via account menu
- [ ] Verify same functionality as light theme
- [ ] Check contrast and readability

**Mobile (iPhone SE or similar)**:
- [ ] Search input full width
- [ ] Buttons stack or wrap responsively
- [ ] Quick Filters wrap to multiple rows
- [ ] Browse cards stack vertically
- [ ] Touch targets adequate size
- [ ] No horizontal scroll

**Tablet (iPad or similar)**:
- [ ] Layout between mobile and desktop
- [ ] Dropdowns not clipped
- [ ] Touch and mouse both work

**External Links (Browse by Experience)**:
- [ ] Livestreams → https://www.redhat.com/en/livestreaming
- [ ] Architectures → https://www.redhat.com/architect/portfolio/
- [ ] Interactive Labs → https://www.redhat.com/en/interactive-labs
- [ ] Labs → https://demo.redhat.com/
- [ ] All open in new tab

**URL State**:
- [ ] Apply filters (search + product + format)
- [ ] Copy URL from address bar
- [ ] Open in new tab
- [ ] Verify filters restored

**Pagination**:
- [ ] Apply filter that returns >20 results
- [ ] Navigate to page 2
- [ ] Verify results update
- [ ] Verify applied filters still shown

**Saved Demos**:
- [ ] Save a demo (bookmark icon)
- [ ] Open Saved Demos modal
- [ ] Verify demo appears
- [ ] Unsave demo
- [ ] Verify removed from modal

**Export**:
- [ ] Select 3 demos (checkboxes)
- [ ] Click Export button
- [ ] Verify CSV download
- [ ] Open CSV, verify data

**Integration**:
- [ ] Type search query
- [ ] Click Quick Filter
- [ ] Click Browse card
- [ ] Expand More Filters, select dropdown option
- [ ] Verify Apply* shown
- [ ] Click Apply
- [ ] Verify all filters combine in results
- [ ] Verify applied filter chips show all 4 selections

**Applied Filter Removal**:
- [ ] Apply 3 filters (search + product + format)
- [ ] Verify 3 chips in applied filters bar
- [ ] Click X on product chip
- [ ] Verify Apply* shown (pending)
- [ ] Verify chips still show 3 (not updated yet)
- [ ] Click Apply
- [ ] Verify results reload
- [ ] Verify applied chips now show 2 (search + format)

## Success Criteria

**Automated Tests**: All 7 pass ✅  
**Manual Tests**: All 10 scenarios pass ✅  
**Regressions**: None found ✅  

## After Verification

**If tests pass**:
- Update PR description with test results
- Request review for merge to main
- Do NOT deploy to Production until approved

**If tests fail**:
- Document exact failure
- Return to worktree for fix
- Re-test after fix
- Repeat until all pass

## Safety Notes

- DEV deployment only - Production unchanged
- Worktree isolated - main branch unchanged
- PR #9 (Global Header) unaffected
- Can revert with `clasp push` from main directory if needed

## Deployment Script ID

**Apps Script Project**: 1j9kP2ZqJpQoUdszg4-X1Nvc0BaMG23KB2uMKLvf3T35k4KfpoZac_xpQ

This is the same script ID as main - DEV and Production share the same Apps Script project. Ensure you're deploying to the correct version/deployment.
