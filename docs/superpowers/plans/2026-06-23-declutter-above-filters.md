# Declutter Area Above Filter Box

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce vertical space consumed by the brand header and discover strip so users reach the search/filter box faster. No changes to the toolbar, cards, or button colors.

**Architecture:** CSS-only changes in `discovery.html`. Compact the header into a single horizontal row and tighten the discover strip spacing.

**Tech Stack:** HTML, CSS, Google Apps Script `HtmlService`

## Global Constraints

- Only modify CSS for `.topbar`, `.brand`, and `.discover-strip` areas
- Do NOT change the toolbar (`.toolbarWrap`), result cards, or button colors
- Preserve all functionality and dark mode
- Deploy via `clasp push`

---

### Task 1: Compact the Header into a Single Row

**Files:**
- Modify: `discovery.html` — CSS for `.topbar`, `.brand`, `.brand-logo`, `.brand h1`, `.brand p`

**Current problem:** The brand section stacks vertically — logo on top, then a 30px title, then a 2-line subtitle paragraph, then an interact.redhat.com link paragraph. Combined with the header buttons row, this eats ~120px of vertical space.

**Fix:** Make the brand a horizontal row (logo + title inline) and hide the subtitle paragraphs. The subtitle content ("Demo it! Find your Interactive Experiences…") is redundant with the discover strip below. The interact.redhat.com link is already a discover card.

- [ ] **Step 1: Change `.topbar` alignment from `flex-start` to `center`**

Replace:
```css
.topbar{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:16px;
  margin-bottom:16px;
  flex-wrap:wrap;
}
```
With:
```css
.topbar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:16px;
  margin-bottom:10px;
  flex-wrap:wrap;
}
```

- [ ] **Step 2: Change `.brand` from column to row layout**

Replace:
```css
.brand{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:8px;
}
```
With:
```css
.brand{
  display:flex;
  align-items:center;
  gap:10px;
}
```

- [ ] **Step 3: Shrink logo and hide subtitle paragraphs**

Replace:
```css
.brand-logo{
  flex-shrink:0;
  height:32px;
  width:auto;
  transition:transform 0.2s ease;
  object-fit:contain;
}

.brand-logo:hover{
  transform:scale(1.05);
}
```
With:
```css
.brand-logo{
  flex-shrink:0;
  height:26px;
  width:auto;
}
```

Replace:
```css
.brand h1{
  margin:0;
  font-size:30px;
  line-height:1.08;
}

.brand p{
  margin:8px 0 0;
  color:var(--muted);
  font-size:14px;
  max-width:860px;
}
```
With:
```css
.brand h1{
  margin:0;
  font-size:22px;
  font-weight:700;
  line-height:1.2;
}
.brand p{ display:none; }
```

- [ ] **Step 4: Update 700px responsive breakpoint**

Replace:
```css
.brand-logo{
  height:28px;
  width:auto;
}

.brand h1{
  font-size:24px;
}
```
With:
```css
.brand-logo{
  height:22px;
  width:auto;
}

.brand h1{
  font-size:18px;
}
```

- [ ] **Step 5: Push and verify**

```bash
cd "/Users/rubyyang/Arcade Finder" && clasp push
```

Verify: header is one compact row — logo + "The Interact Hub" left, buttons right. Subtitle text gone. Discover strip and toolbar unchanged.

---

## Verification Checklist

1. Header is compact — logo and title on one line
2. Subtitle paragraphs are hidden
3. Discover strip unchanged (same size, same cards)
4. Toolbar/search/filters unchanged
5. Result cards unchanged
6. Launch Demo button color unchanged (purple)
7. Dark mode works
8. Mobile responsive works
