# Clean Header UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the area above the search toolbar (topbar + discover strip) into a cleaner, less cluttered layout while preserving all existing text and links.

**Architecture:** CSS + minor HTML restructure in `discovery.html`. Two-tier header: Row 1 is logo + title + buttons. Row 2 is subtitle text consolidated into a single compact line. Discover strip converts from large bordered cards to slim inline pills. No changes to toolbar, filters, result cards, or button colors.

**Tech Stack:** HTML, CSS, Google Apps Script `HtmlService`

## Global Constraints

- Only modify the `.topbar`, `.brand`, `.resourcesHeaderBtn`, `.discover-strip`, and related CSS/HTML
- Do NOT change `.toolbarWrap`, `.toolbar`, search input, `.instant-pill`, filter dropdowns, result cards, or `.btn.launch` color
- Preserve ALL existing text content — no hiding, no `display:none`
- Preserve all functionality, links, onclick handlers, and dark mode
- Deploy via `clasp push`

---

### Task 1: Restructure the Header Layout

**Files:**
- Modify: `discovery.html` — CSS (lines 181–273) and HTML (lines 1986–2021)

**Current problem:** The brand uses `flex-direction:column` layout crammed into a horizontal row with `align-items:center`, causing the two subtitle paragraphs to sit beside the title awkwardly. The header buttons are large with heavy borders and box-shadows. All of this creates visual noise above the search bar.

**Target layout:**
- Row 1: Logo + "The Interact Hub" title on left, compact ghost-style buttons on right — all vertically centered on one tight line
- Row 2: Both subtitle sentences merged into a single `<p>` line in a smaller muted font, directly below the topbar

**Fix:**

- [ ] **Step 1: Update `.topbar` CSS**

Replace the `.topbar` block (line 181) with:
```css
.topbar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  margin-bottom:4px;
  flex-wrap:wrap;
}
```

- [ ] **Step 2: Update `.brand` and related CSS**

Replace `.brand`, `.brand-logo`, `.brand-content`, `.brand h1`, and `.brand p` blocks (lines 190–218) with:
```css
.brand{
  display:flex;
  align-items:center;
  gap:10px;
}
.brand-logo{
  flex-shrink:0;
  height:26px;
  width:auto;
}
.brand-content{ min-width:0; }
.brand h1{
  margin:0;
  font-size:22px;
  font-weight:700;
  line-height:1.2;
}
.brand p{ display:none; }
```

Note: `.brand p` is hidden because the subtitle text moves to a new `.brand-subtitle` element outside the topbar div (see Step 5).

- [ ] **Step 3: Add new `.brand-subtitle` CSS**

After the `.brand p` rule, add:
```css
.brand-subtitle{
  font-size:12px;
  color:var(--muted);
  margin-bottom:10px;
  line-height:1.4;
}
.brand-subtitle a{
  color:var(--accent);
  font-weight:600;
  text-decoration:none;
}
.brand-subtitle a:hover{ text-decoration:underline; }
```

- [ ] **Step 4: Slim down header buttons to ghost style**

Replace `.resourcesHeaderBtn`, `.resourcesHeaderBtn:hover`, `.resourcesHeaderBtn svg`, and `.resourcesHeaderBtn:hover svg` blocks (lines 220–258) with:
```css
.resourcesHeaderBtn{
  display:flex;
  align-items:center;
  gap:6px;
  padding:6px 12px;
  border-radius:8px;
  border:1px solid transparent;
  background:transparent;
  color:var(--muted);
  font-size:13px;
  font-weight:600;
  cursor:pointer;
  transition:color .15s, background .15s;
  white-space:nowrap;
}
.resourcesHeaderBtn:hover{
  color:var(--accent);
  background:var(--accent2);
}
.resourcesHeaderBtn svg{ transition:none; }
.resourcesHeaderBtn:hover svg{ transform:none; }
```

- [ ] **Step 5: Restructure the HTML — move subtitle below topbar**

Replace the topbar HTML (lines 1986–2021, from `<div class="topbar">` through the closing `</div>` of topbar) with:
```html
<div class="topbar">
  <div class="brand">
    <img class="brand-logo" src="https://coolstuff.redhat.com/assets/stores/REDHAT/branding/site-logo.png" alt="Red Hat" title="Red Hat">
    <div class="brand-content">
      <h1>The Interact Hub</h1>
    </div>
  </div>
  <div class="headerButtonGroup">
    <button class="resourcesHeaderBtn" id="themeToggleBtn" onclick="cycleTheme()" title="Toggle theme">
      <span id="themeIcon">&#9788;</span>
    </button>
    <button class="resourcesHeaderBtn" id="debugBtn" onclick="toggleDebugPanel()" title="Debug Controls" style="display: none;">
      🐛
      Debug
    </button>
    <button class="resourcesHeaderBtn" id="aiAssistantHeaderBtn" onclick="window.open('https://notebooklm.google.com/notebook/26663614-ab4e-4ae0-ae75-1360c149438f', '_blank')">
      ✨
      AI Demo Assistant
    </button>
    <button class="resourcesHeaderBtn" id="savedArcadesHeaderBtn" onclick="openSavedArcadesModal()">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/>
      </svg>
      Saved Demos
      <span class="savedArcadesCounter" id="savedArcadesCounter" style="display: none;">0</span>
    </button>
    <button class="resourcesHeaderBtn" id="resourcesHeaderBtn" onclick="toggleResourcesSidebar()">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z"/>
      </svg>
      Home Menu
    </button>
  </div>
</div>
<p class="brand-subtitle">Demo it! Find your Interactive Experiences; from the video demos, to the Interactive Demos. From Livestreams to your Interactive Labs. For public facing material, access: <a href="https://interact.redhat.com" target="_blank" rel="noopener">interact.redhat.com &rarr;</a></p>
```

This merges the two `<p>` elements into one single-line `<p>` placed between the topbar and the discover strip.

- [ ] **Step 6: Update dark mode overrides for `.resourcesHeaderBtn`**

Replace:
```css
:root:not([data-theme="light"]) .resourcesHeaderBtn { background: #374151; border-color: #4b5563; color: #f3f4f6; }
```
With:
```css
:root:not([data-theme="light"]) .resourcesHeaderBtn { background: transparent; border-color: transparent; color: #9ca3af; }
```

Replace:
```css
[data-theme="dark"] .resourcesHeaderBtn { background: #374151; border-color: #4b5563; color: #f3f4f6; }
```
With:
```css
[data-theme="dark"] .resourcesHeaderBtn { background: transparent; border-color: transparent; color: #9ca3af; }
```

- [ ] **Step 7: Update responsive breakpoint (700px)**

Replace:
```css
.brand-logo{
  height:22px;
  width:auto;
}

.brand h1{
  font-size:18px;
}
```
With:
```css
.brand-logo{
  height:20px;
  width:auto;
}

.brand h1{
  font-size:17px;
}
```

---

### Task 2: Convert Discover Strip from Cards to Compact Pills

**Files:**
- Modify: `discovery.html` — CSS (lines 576–625) and HTML (lines 2023–2081)

**Current problem:** The discover strip uses large bordered cards with icons, labels, and subtitles — each ~50px tall with padding, borders, and gaps. This consumes significant vertical space.

**Target:** Convert to slim inline pill-style links — each pill is just icon + label, no subtitle, no border, tighter padding. The "Find the demo that suits you…" heading becomes smaller and inline.

- [ ] **Step 1: Replace discover strip CSS**

Replace the entire `.discover-strip` through `.discover-card-sub` CSS block (lines 576–625) with:
```css
.discover-strip{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  margin-bottom:12px;
}
.discover-heading{
  font-size:13px;
  font-weight:600;
  color:var(--muted);
  white-space:nowrap;
}
.discover-row{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
}
.discover-card{
  display:flex;
  align-items:center;
  gap:6px;
  padding:5px 12px;
  border-radius:999px;
  background:var(--accent2);
  text-decoration:none;
  color:var(--accent);
  font-size:12px;
  font-weight:600;
  transition:background .15s, box-shadow .15s;
  white-space:nowrap;
}
.discover-card:hover{
  background:#ddd6fe;
  box-shadow:0 1px 4px rgba(109,40,217,.12);
}
.discover-card-icon{
  width:16px;
  height:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
}
.discover-card-icon svg{width:12px;height:12px}
.discover-card-text{min-width:0}
.discover-card-label{font-size:12px;font-weight:600;line-height:1.3}
.discover-card-sub{display:none}
```

The subtitle text inside each card is hidden since the pill label is sufficient. The icon background square is removed — the icon sits directly in the pill.

- [ ] **Step 2: Update dark mode overrides for discover cards**

Replace:
```css
:root:not([data-theme="light"]) .discover-card { background: #1f2937; border-color: #374151; }
:root:not([data-theme="light"]) .discover-card:hover { border-color: var(--accent); }
```
With:
```css
:root:not([data-theme="light"]) .discover-card { background: rgba(139,92,246,.12); color: #a78bfa; }
:root:not([data-theme="light"]) .discover-card:hover { background: rgba(139,92,246,.22); }
```

Replace:
```css
[data-theme="dark"] .discover-card { background: #1f2937; border-color: #374151; }
```
With:
```css
[data-theme="dark"] .discover-card { background: rgba(139,92,246,.12); color: #a78bfa; }
```

Replace:
```css
[data-theme="dark"] .discover-card:hover { border-color: var(--accent); }
```
With:
```css
[data-theme="dark"] .discover-card:hover { background: rgba(139,92,246,.22); }
```

- [ ] **Step 3: Push and verify**

```bash
cd "/Users/rubyyang/Arcade Finder" && clasp push
```

---

## Verification Checklist

1. Header is one clean row: logo + title left, ghost buttons right
2. Subtitle text is visible below the header in a single compact line (12px muted)
3. Both original sentences present: "Demo it!..." and "For public facing material..."
4. interact.redhat.com link works
5. Discover strip is a row of compact accent-colored pills with icons, no borders
6. All 6 discover links work (YouTube, Livestreams, Interactive Demos, Interactive Labs, Architectures, Labs)
7. Toolbar/search/filters unchanged
8. Result cards unchanged
9. Launch Demo button color unchanged (purple)
10. Dark mode works for header buttons, pills, and subtitle
11. Mobile responsive works (pills wrap, buttons wrap)
