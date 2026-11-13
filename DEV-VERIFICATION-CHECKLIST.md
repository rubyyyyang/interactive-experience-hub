# Package 1 DEV Verification Checklist

**DEV URL:** https://script.google.com/macros/s/AKfycbxvHiD1Xab3gsf0pYA-k5ZejnRyabPupv6gULcY4m21/dev

**Date:** 2026-11-13  
**Verifier:** _____________  
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete

---

## Pre-Verification

- [ ] Confirmed DEV environment loaded (no errors on page load)
- [ ] Confirmed Discovery results are visible
- [ ] Browser console shows no JavaScript errors

---

## 1. Interactive Demo Records (Existing Published Records)

**Find an existing Interactive Demo record** (look for `/share/{id}` URLs, NOT `/share/videos/`)

Record Title: _________________________________

### Card Display:
- [ ] Format filter shows "Interactive Demo" option
- [ ] Can filter to show only Interactive Demo records
- [ ] Button shows "Launch Demo" (NOT "Watch Video")
- [ ] "Edit in Arcade" button is visible
- [ ] Clicking "Edit in Arcade" copies a URL
- [ ] Copied URL format: `https://app.arcade.software/flows/{id}/edit`

### Drawer (Click "More Info"):
- [ ] Drawer opens successfully
- [ ] Shows "Demo Page" link
- [ ] Shows "Production Link"
- [ ] Shows "Creation Link" with "Edit in Arcade" button
- [ ] All links are valid URLs

### Saved Demos:
- [ ] Can save the record (bookmark icon)
- [ ] Saved counter updates
- [ ] Can unsave the record
- [ ] Refresh page - saved state persists

### Search & Filter:
- [ ] Search for record title - appears in results
- [ ] Filter by product - appears in results
- [ ] Clear filters - record reappears

---

## 2. YouTube Records (Existing Published Records)

**Find an existing YouTube record** (look for youtube.com or youtu.be URLs)

Record Title: _________________________________

### Card Display:
- [ ] Format filter shows "YouTube" option
- [ ] Can filter to show only YouTube records
- [ ] Button shows "Watch Video" (NOT "Launch Demo")
- [ ] "Edit in Arcade" button is NOT visible
- [ ] Record ID format: `yt-{number}` (check in browser DevTools or URL when drawer opens)

### Drawer (Click "More Info"):
- [ ] Drawer opens successfully (this tests YouTube record resolution!)
- [ ] Shows "Video Demo" link pointing to YouTube URL
- [ ] Does NOT show "Edit in Arcade" button
- [ ] No broken links or errors

### Saved Demos:
- [ ] Can save the YouTube record
- [ ] Saved counter updates
- [ ] Can unsave the record
- [ ] Refresh page - saved state persists (tests YouTube ID compatibility)

### Search & Filter:
- [ ] Search for record title - appears in results
- [ ] Filter by Type → YouTube - appears in results
- [ ] Clear filters - record reappears

---

## 3. Video Demo Records (NEW - May Not Exist)

**Look for records with `/share/videos/` URLs**

Status: ⬜ Found | ⬜ Not Found

If FOUND, record title: _________________________________

### Card Display (if found):
- [ ] Format filter shows "Video Demo" option
- [ ] Can filter to show only Video Demo records
- [ ] Button shows "Watch Video" (NOT "Launch Demo")
- [ ] "Edit in Arcade" button is NOT visible

### Drawer (if found):
- [ ] Drawer opens successfully
- [ ] Shows "Video Demo" link
- [ ] Does NOT show "Edit in Arcade" button

**If NOT FOUND:** Document as "Video Demo content type unverified - no existing records with /share/videos/ URLs in DEV"

---

## 4. Cross-Cutting Verification

### Format Filter:
- [ ] "Type" dropdown is visible
- [ ] Shows "Interactive Demo" option
- [ ] Shows "YouTube" option
- [ ] Shows "Video Demo" option (if any Video Demo records exist)
- [ ] Filtering works correctly for each type

### Search Functionality:
- [ ] Text search returns relevant results
- [ ] Search works across all content types
- [ ] Search + filter combination works

### Saved Demos Modal:
- [ ] Click saved counter to open modal
- [ ] Saved records display correctly
- [ ] Shows correct button labels per content type
- [ ] "Remove from saved" works
- [ ] Saved records persist after page refresh

### Export/Share:
- [ ] Select multiple records (selection mode)
- [ ] Can select mix of Interactive Demo and YouTube
- [ ] Export to CSV works (optional - don't send actual email)

### Browser Console:
- [ ] No JavaScript errors
- [ ] No "Record not found" errors when opening drawers
- [ ] No 500 errors from backend

---

## 5. Cache Behavior

### First Load:
- [ ] Page loads successfully
- [ ] Check browser DevTools → Network → Filter by "getDiscoveryBootstrap"
- [ ] Response includes records with correct format values

### Second Load (refresh):
- [ ] Page loads from cache (check console: "⚡ Using cached bootstrap")
- [ ] Records still display correctly

### Cache Invalidation Test:
- [ ] Open browser DevTools → Application → Local Storage
- [ ] Find key: `discovery_bootstrap_cache`
- [ ] Delete the key
- [ ] Refresh page
- [ ] Records reload correctly with new format values

---

## 6. Security Verification

### YouTube Record Direct Access:
**Goal:** Verify non-discoverable YouTube records cannot be accessed

**Method 1 - Using existing YouTube record:**
1. Open a YouTube record drawer (note the ID, e.g., `yt-45`)
2. Check backend: Does this YouTube record have Status = "Published"?
3. Expected: Yes (only published records are in Discovery)

**Method 2 - Test non-existent ID:**
1. Try to manually construct a URL or trigger `getDiscoveryRecord("yt-999999")`
2. Expected: Returns "Record not found" (not crash)

**Can only test Method 1 in UI. Method 2 would require backend testing.**

---

## 7. Regression Testing

### Existing Functionality:
- [ ] Pagination works (if > 20 records)
- [ ] TDP counts display correctly
- [ ] Product filter works
- [ ] Event filter works
- [ ] Creator filter works
- [ ] Recent searches work (if implemented)
- [ ] Theme toggle works

---

## Issues Found

**Issue 1:**
- Description: _________________________________
- Severity: ⬜ Critical | ⬜ High | ⬜ Medium | ⬜ Low
- Steps to reproduce: _________________________________
- Expected: _________________________________
- Actual: _________________________________

**Issue 2:**
- Description: _________________________________
- Severity: ⬜ Critical | ⬜ High | ⬜ Medium | ⬜ Low
- Steps to reproduce: _________________________________
- Expected: _________________________________
- Actual: _________________________________

---

## Verification Results

**Overall Status:** ⬜ PASS | ⬜ PASS with Notes | ⬜ FAIL

**Summary:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________

**Ready for Production?** ⬜ Yes | ⬜ No | ⬜ Yes with caveats

**Caveats/Notes:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________

---

## Sign-Off

**Verified by:** _________________________________  
**Date:** _________________________________  
**Time spent:** _________________________________

**Recommendation:**
⬜ Deploy to Production  
⬜ Fix issues then re-verify  
⬜ Do not deploy

**Next steps:**
_____________________________________________________________________________
_____________________________________________________________________________
