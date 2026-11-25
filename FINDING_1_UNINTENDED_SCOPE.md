# Finding 1: Unintended Scope in Commit c75b595

## Investigation Results

**Commit:** c75b595 fix(discovery): implement content type toggle to deselect

**Unintended Changes Found:**
1. Card layout compaction (`renderCard()`, `buildCardHtml()`)
2. Drawer redesign (metadata field removal, format badge addition)
3. Primary link fallback for YouTube/Video Demo (`getPrimaryLink()`)
4. Edit in Arcade visibility guard (`hasEditableSource()`)
5. Bookmark synchronization (`syncCardBookmarkIcons_()`)

## Origin

**Source:** Package 3B feature branch (`feature/package-3b-demo-cards`)

**Commits:**
- 5f11179 feat: update buildCardHtml() with compact layout
- d864a5e feat: reorganize Detail Drawer with summary-first layout  
- 7025175 feat: add CSS for collapsible Technical details section
- e20f8a5 refine(package-3b): UI refinements for cards and drawer

**Cause:** Beta-feedback worktree was created from main working directory, which was on `feature/package-3b-demo-cards` branch instead of `origin/main`.

## Status

✅ **NOT from other active Hub session** - these are complete, legitimate Package 3B changes already on a feature branch

✅ **NOT incomplete work** - Package 3B commits are finished and ready for merge

⚠️ **Dependency created** - Beta feedback PR includes Package 3B changes

## Impact

**Current state:**
- PR #13 (`worktree-beta-feedback`) includes both beta feedback AND Package 3B changes
- Subsequent commits (67600c3 filter discoverability, etc.) build on Package 3B base
- Cannot simply revert c75b595 without affecting later commits

**Merge implications:**
- If Package 3B merges first: PR #13 will have conflicts
- If PR #13 merges first: Package 3B changes go to production unintentionally
- Both PRs contain overlapping discovery_js.html changes

## Proposed Resolution

**Option A: Note Dependency (Simplest)**
- Document in PR #13 that it includes Package 3B changes
- Merge Package 3B first, then rebase PR #13 onto updated main
- Beta feedback changes will layer cleanly on top

**Option B: Surgical Rebase (Complex)**
- Interactive rebase c75b595 to remove Package 3B changes
- Preserve only `browseByExperience()` toggle logic
- Risk: later commits may have conflicts

**Option C: Separate PRs (Safest but most work)**
- Extract pure toggle fix into new commit on clean origin/main
- Keep filter discoverability and performance as separate commits
- Abandon current c75b595, recreate from scratch

## Recommendation

**Proceed with Option A** due to:
1. Package 3B changes are complete and ready
2. No work from other active session affected
3. Cleanest merge path with least risk
4. Beta feedback naturally builds on Package 3B UI improvements

**Action Items:**
1. Update PR #13 description to note Package 3B dependency
2. Coordinate merge order: Package 3B → Beta Feedback
3. Rebase PR #13 onto main after Package 3B merges
4. Resolve any conflicts in discovery_js.html

## Pure Toggle Change (For Reference)

If surgical extraction needed, the ONLY intended change in c75b595 was:

```javascript
// In browseByExperience() function (lines 2027-2043)
function browseByExperience(type) {
  const startTime = performance.now();

  // Determine current state to support toggle behavior
  const currentFormats = filterState.formats || [];
  const isCurrentlySelected = (type !== 'all' && currentFormats.length === 1 && currentFormats[0] === type);

  // Toggle behavior: clicking already-selected type deselects it and returns to All Experiences
  // Otherwise, set the clicked type (preserving search and other filters)
  if (isCurrentlySelected) {
    filterState.formats = [];
    type = 'all'; // Update visual target
  } else if (type === 'all') {
    filterState.formats = [];
  } else {
    filterState.formats = [type];
  }
  
  // ... rest unchanged
}
```

All other changes in discovery_js.html are from Package 3B.
