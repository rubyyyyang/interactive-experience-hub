# Global Header PRs Review and Closure Recommendation

**Date**: 2026-11-24  
**Repositories Reviewed**:
- rubyyyyyang/interactive-experience-hub (Hub), PR #9
- rubyyyyyang/interactive-experience-intake (Intake), PR #14

## Executive Summary

**Recommendation**: Close both PRs as superseded by already-merged work.

- **Hub PR #9**: Contains only documentation (PR9_MERGE_REPORT.md). All functionality already in main via PR #10.
- **Intake PR #14**: Behind main by 394 lines. Would delete tests and revert functionality already in main via PR #15.

**No production or DEV verification needed** - intended functionality already deployed and verified.

---

## Hub Repository (interactive-experience-hub)

### PR #9: Package 2A - Global Header Navigation
**Branch**: feature/package-2a-global-header  
**Status**: Open  
**Behind main**: 0 commits (up to date after merge)

#### Current State

**Difference from main**:
```
PR9_MERGE_REPORT.md | 210 insertions
1 file changed, 210 insertions(+)
```

**Main branch already contains**:
- Commit ae2f590: "Add direct Explore Demos and Status Tracker navigation to Global Header (#10)"
- Commit 7c7bcba: "Package 2A: Global Header with Environment-Aware Navigation (#8)"
- Commit 826a768: "Package 3A: Hub Filter UI & Browse by Experience (#11)"

#### Functionality Verification

**Global Header Navigation in main** (from PR #10):
✅ "Explore Demos" link with aria-current="page" active state  
✅ "Status Tracker" link with cross-app navigation  
✅ window.top.location.href for iframe-safe navigation  
✅ Active state styling (purple background)  
✅ No underline on hover for active links

**Package 3A Features in main** (from PR #11):
✅ Quick Filters immediate apply  
✅ Browse by Experience immediate switching  
✅ Performance optimizations (caching, prefetch)  
✅ All stale-response guards

#### PR #9 Content Analysis

**Files modified**: 1 (documentation only)
- PR9_MERGE_REPORT.md (merge preparation report)

**Functional changes**: None

**Tests**: None

**Documentation value**: The merge report documents the resolution of conflicts between Package 2A and Package 3A, which could be useful for historical reference but adds no functionality.

#### Recommendation for Hub PR #9

**Action**: CLOSE as superseded

**Reasoning**:
1. All intended functionality already in main via PR #10
2. Only difference is a documentation file
3. No functional changes would result from merging
4. Creates noise in git history without adding value
5. The merge report was created to document conflict resolution that's already been resolved differently in main

**Alternative**: If documentation is valuable, extract it to a separate docs/ location and close the PR.

---

## Intake Repository (interactive-experience-intake)

### PR #14: Package 2B - Shared Global Header
**Branch**: feature/package-2b-shared-header  
**Status**: Open  
**Behind main**: Would revert recent changes

#### Current State

**Difference from main**:
```
14 files changed, 91 insertions(+), 485 deletions(-)
```

**Net effect**: -394 lines (deletions exceed additions)

**Main branch already contains**:
- Commit a578e2e: "Add direct Explore Demos and Status Tracker navigation to Global Header (#15)"
- Commit de980d3: "feat: align Intake and Status Tracker UI with Hub purple accent (#13)"
- Commit 40a9401: "Restore Submit new button on Status Tracker page (#12)"
- Commit 535fc27: "Package 2B Phase 1: Shared Global Header and Light Design Foundation (#11)"

#### Functionality Comparison

**Features in MAIN (would be lost if PR #14 merged)**:

**GlobalHeader.html**:
```html
<!-- Direct navigation links (MAIN) -->
<a href="<?= hubBaseUrl ?>">Explore Demos</a>
<a href="<?= webAppBaseUrl ?>?page=status" aria-current="page">Status Tracker</a>
```

vs.

```html
<!-- Old dropdown structure (PR #14) -->
<a href="#" onclick="globalHeaderNavigateToTracker(event)">Check My Submissions</a>
```

**GlobalHeader_CSS.html**:
```css
/* Active state styling (MAIN) */
.navLink[aria-current="page"] {
  background: var(--border);
  font-weight: 600;
}
```

vs.

```css
/* No active state styling (PR #14) */
.brandLink:hover .brandTitle {
  color: var(--accent);
}
```

**Code.js**:
```javascript
// currentPage parameter (MAIN)
const currentPage = (page === 'status') ? 'status' : 'intake';
template.currentPage = currentPage;

// Template evaluation function (MAIN)
function includeGlobalHeader(hubBaseUrl, webAppBaseUrl, currentPage) {
  const template = HtmlService.createTemplateFromFile('GlobalHeader');
  template.hubBaseUrl = hubBaseUrl;
  template.webAppBaseUrl = webAppBaseUrl;
  template.currentPage = currentPage;
  return template.evaluate().getContent();
}
```

vs.

```javascript
// No currentPage or template evaluation (PR #14)
// Missing includeGlobalHeader function
```

#### Tests That Would Be Deleted

PR #14 would delete:
1. **tests/global-header-integration.test.js** (136 lines)
   - Tests GlobalHeader template evaluation
   - Tests currentPage parameter passing
   - Tests navigation context

2. **tests/global-header-template-evaluation.test.js** (146 lines)
   - Tests includeGlobalHeader function
   - Tests scriptlet evaluation
   - Tests parameter passing

3. **tests/submit-new-button.test.js** (79 lines)
   - Tests Status Tracker header cleanup
   - Verifies redundant "Submit new" button removed
   - Verifies navigateToIntake() function removed

**Total test coverage lost**: 361 lines across 3 test files

#### Files That Would Be Reverted

**Files with regressions**:
1. **GlobalHeader.html**
   - Removes direct navigation links
   - Reverts to old dropdown structure
   - Removes aria-current active state
   - Removes currentPage conditional logic

2. **GlobalHeader_CSS.html**
   - Removes active state styling
   - Reverts to old hover effects
   - Missing purple accent for active items

3. **GlobalHeader_JS.html**
   - Adds back deleted navigation functions
   - Re-introduces code that was cleaned up

4. **Code.js**
   - Removes currentPage parameter
   - Removes includeGlobalHeader function
   - Breaks template evaluation logic

5. **Index.html & StatusTracker.html**
   - Structural changes that conflict with main
   - Would break template parameter passing

6. **.claspignore**
   - Removes important exclusions added in main

#### Recommendation for Intake PR #14

**Action**: CLOSE as superseded and would introduce regressions

**Reasoning**:
1. All intended functionality already in main via PR #15
2. PR #14 is based on outdated code before PR #15 merged
3. Merging would DELETE 361 lines of test coverage
4. Would REVERT the direct navigation links back to dropdown
5. Would REMOVE currentPage active state functionality
6. Would DELETE includeGlobalHeader template evaluation
7. Would REMOVE purple accent active state styling
8. Net -394 lines indicates this is a reversion, not an addition

**Risk if merged**:
- Loss of direct navigation links
- Loss of active state indication
- Loss of test coverage
- Regression to inferior UX (dropdown vs direct links)
- Breaking change to template evaluation

---

## Production & DEV Verification Status

### Hub (interactive-experience-hub)

**Current Production State**:
- Global Header navigation: ✅ Deployed (PR #10)
- Package 3A filters: ✅ Deployed (PR #11)

**Current DEV State**:
- Same as Production (main branch deployed)

**Verification Needed**: None - functionality already verified and deployed

### Intake (interactive-experience-intake)

**Current Production State**:
- Global Header navigation: ✅ Deployed (PR #15)
- Purple accent styling: ✅ Deployed (PR #13)
- Submit new button cleanup: ✅ Deployed (PR #12)
- Shared Global Header: ✅ Deployed (PR #11)

**Current DEV State**:
- Same as Production (main branch deployed)

**Verification Needed**: None - functionality already verified and deployed

---

## Comparison Table

| Feature | Hub Main | Hub PR #9 | Intake Main | Intake PR #14 |
|---------|----------|-----------|-------------|---------------|
| Direct "Explore Demos" link | ✅ | ✅ | ✅ | ❌ (dropdown) |
| Direct "Status Tracker" link | ✅ | ✅ | ✅ | ❌ (dropdown) |
| aria-current active state | ✅ | ✅ | ✅ | ❌ |
| Purple accent styling | ✅ | ✅ | ✅ | ❌ |
| currentPage parameter | N/A | N/A | ✅ | ❌ |
| includeGlobalHeader function | N/A | N/A | ✅ | ❌ |
| Template evaluation tests | N/A | N/A | ✅ | ❌ (deleted) |
| Package 3A filters | ✅ | ✅ | N/A | N/A |
| Merge report doc | ❌ | ✅ | N/A | N/A |

---

## Git History Analysis

### Hub Timeline

1. **PR #8** (7c7bcba): Package 2A - Global Header foundation
2. **PR #10** (ae2f590): Direct navigation links added
3. **PR #11** (826a768): Package 3A filters merged
4. **PR #9**: Created to merge main into Package 2A branch after PR #11

**Current status**: PR #9 is an artifact of trying to keep the Package 2A branch current after PR #10 and PR #11 merged. The functionality it was meant to deliver is already in main.

### Intake Timeline

1. **PR #11** (535fc27): Package 2B Phase 1 - Shared Header foundation
2. **PR #12** (40a9401): Submit new button cleanup
3. **PR #13** (de980d3): Purple accent styling
4. **PR #15** (a578e2e): Direct navigation links added
5. **PR #14**: Older branch that predates PR #15, still has dropdown structure

**Current status**: PR #14 represents an older state of the codebase before the direct navigation links were added in PR #15. It was never updated after PR #15 merged.

---

## Recommendations Summary

### Hub PR #9: CLOSE
- **Reason**: Documentation-only, no functional changes
- **Action**: Close with comment referencing PR #10 and PR #11
- **Alternative**: Extract merge report to docs/ if valuable for historical reference

### Intake PR #14: CLOSE
- **Reason**: Superseded by PR #15, would introduce regressions
- **Action**: Close with comment explaining it's been superseded
- **Risk**: Would delete tests and revert functionality if merged

### No Further Action Required
- ✅ All intended Global Header functionality deployed
- ✅ All repositories at correct state in main
- ✅ No verification or testing needed
- ✅ No deployment needed

---

## Proposed PR Close Comments

### Hub PR #9
```
Closing as superseded. All Global Header navigation functionality from this PR is already present in main via PR #10 (commit ae2f590).

The only difference between this branch and main is PR9_MERGE_REPORT.md, which documents a merge conflict resolution that was ultimately resolved differently when PR #10 merged directly to main.

Main branch current state includes:
- Direct "Explore Demos" and "Status Tracker" navigation links
- aria-current active state styling
- Cross-app navigation with window.top.location.href
- Package 3A filter UI and performance optimizations

No functional changes would result from merging this PR.
```

### Intake PR #14
```
Closing as superseded by PR #15 (commit a578e2e) and would introduce regressions if merged.

Main branch already contains all intended Global Header functionality:
- Direct "Explore Demos" and "Status Tracker" navigation links (PR #15)
- aria-current active state with currentPage parameter (PR #15)
- Purple accent styling (PR #13)
- includeGlobalHeader template evaluation function (PR #15)
- Comprehensive test coverage (PR #15)

This PR is based on code before PR #15 merged and would:
- Revert direct navigation links back to dropdown structure
- Delete 361 lines of test coverage (3 test files)
- Remove currentPage active state functionality
- Remove includeGlobalHeader function
- Remove purple accent active styling

Net effect: -394 lines (deletions exceed additions), indicating this would be a reversion rather than an addition.
```

---

## Conclusion

Both PRs should be closed as superseded. The intended Global Header functionality is already deployed and verified in both repositories' main branches. No further verification, testing, or deployment is required.

**Next Step**: Close PRs with explanatory comments and move on to other work.
