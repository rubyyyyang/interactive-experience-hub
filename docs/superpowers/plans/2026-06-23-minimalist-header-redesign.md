# Minimalist Header Redesign + Launch Demo Button Color

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire area above the result cards (header, discover strip, search toolbar) into a clean minimalist layout, and change the "Launch Demo" button color from purple to Red Hat red.

**Architecture:** Single-file edit to `discovery.html` — CSS rewrites for the header/toolbar/discover-strip components plus HTML simplification. No server-side changes. No new files.

**Tech Stack:** HTML, CSS (custom properties), Google Apps Script `HtmlService`

## Global Constraints

- Google Apps Script single-file frontend — all changes in `discovery.html`
- Preserve all existing functionality (search, filters, quick pills, theme toggle, sidebar, saved demos)
- Maintain dark mode support via existing CSS custom property system
- Deploy via `clasp push`
- No build step, no npm, no bundler

---

### Task 1: Simplify the Header (topbar + brand)

**Files:**
- Modify: `discovery.html` — CSS lines 181-281 (`.topbar`, `.brand`, `.brand-logo`, `.brand-content`, `.headerButtonGroup`, `.resourcesHeaderBtn`) and HTML lines 1997-2032

**Current state:** The header has a large logo, a 30px h1, a two-line subtitle paragraph, an interact.redhat.com link paragraph, and 5 header buttons with heavy box-shadows and hover transforms.

**Target:** Compact single-line header. Logo + title on the left, utility buttons on the right. Subtitle and interact link move into the discover strip or get removed. Buttons become ghost/borderless icons, no box-shadow.

- [ ] **Step 1: Rewrite `.topbar` CSS to a compact horizontal bar**

Replace CSS at lines 181-188 with:
```css
.topbar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:16px;
  margin-bottom:8px;
  padding:4px 0;
}
```

- [ ] **Step 2: Simplify `.brand` to a horizontal logo + title row**

Replace CSS at lines 190-225 with:
```css
.brand{
  display:flex;
  align-items:center;
  gap:10px;
}
.brand-logo{
  height:24px;
  width:auto;
  flex-shrink:0;
}
.brand-content{ min-width:0; }
.brand h1{
  margin:0;
  font-size:20px;
  font-weight:700;
  line-height:1.2;
}
.brand p{ display:none; }
```

Note: `.brand p { display:none }` hides the subtitle and interact.redhat.com link. The subtitle content is already conveyed by the discover strip below. The interact.redhat.com link was already added as a discover card.

- [ ] **Step 3: Simplify `.resourcesHeaderBtn` to minimal ghost buttons**

Replace CSS at lines 228-259 with:
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

- [ ] **Step 4: Update dark mode overrides for `.resourcesHeaderBtn`**

In the dark theme override blocks (lines ~60 and ~90), change from:
```css
:root:not([data-theme="light"]) .resourcesHeaderBtn { background: #374151; border-color: #4b5563; color: #f3f4f6; }
```
to:
```css
:root:not([data-theme="light"]) .resourcesHeaderBtn { background: transparent; border-color: transparent; color: #9ca3af; }
```

Same for the `[data-theme="dark"]` variant at line ~90.

- [ ] **Step 5: Update responsive breakpoints**

In the media queries (~lines 1481-1533), update `.brand h1` font-size from `24px` to `18px` at the 700px breakpoint, and `.brand-logo` from `28px` to `22px`.

- [ ] **Step 6: Push and verify**

```bash
cd "/Users/rubyyang/Arcade Finder" && clasp push
```

Open the HEAD/dev deployment. Verify:
- Header is a single compact row: logo + "The Interact Hub" left, ghost buttons right
- Subtitle paragraphs are hidden
- Buttons show as text+icon, no borders, accent hover
- Dark mode still works

---

### Task 2: Lighten the Discover Strip

**Files:**
- Modify: `discovery.html` — CSS lines 584-633 (`.discover-strip`, `.discover-heading`, `.discover-row`, `.discover-card`, children)

**Current state:** Cards have 14px padding, 14px border-radius, icon boxes with accent background, border. Heading is 16px bold.

**Target:** Lighter, more minimal. Smaller text, no icon background boxes — just the colored icon inline. Thinner border. Heading is a small muted label, not a bold statement.

- [ ] **Step 1: Update discover-strip CSS**

Replace CSS at lines 584-633 with:
```css
.discover-strip{
  padding:0 0 12px;
}
.discover-heading{
  font-size:12px;
  font-weight:600;
  color:var(--muted);
  text-transform:uppercase;
  letter-spacing:.3px;
  margin-bottom:8px;
}
.discover-row{
  display:flex;
  gap:8px;
  overflow-x:auto;
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
}
.discover-row::-webkit-scrollbar{display:none}
.discover-card{
  flex:1 1 0;
  min-width:120px;
  display:flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--surface);
  text-decoration:none;
  color:var(--ink);
  transition:border-color .15s;
}
.discover-card:hover{
  border-color:var(--accent);
}
.discover-card-icon{
  width:20px;
  height:20px;
  color:var(--accent);
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
}
.discover-card-icon svg{width:14px;height:14px}
.discover-card-text{min-width:0}
.discover-card-label{font-size:12px;font-weight:600;line-height:1.3}
.discover-card-sub{font-size:10px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
```

Key changes: icon box loses its background/border-radius (just a colored icon), card padding reduced, heading becomes a small uppercase label, border-radius tightened, hover effect is just a border color change (no box-shadow).

- [ ] **Step 2: Push and verify**

```bash
cd "/Users/rubyyang/Arcade Finder" && clasp push
```

Verify the discover strip is lighter and less visually heavy. Cards are compact, icons are inline accent color without background boxes.

---

### Task 3: Slim Down the Search Toolbar

**Files:**
- Modify: `discovery.html` — CSS lines 283-337 (`.toolbarWrap`, `.toolbar`, `.searchRow`, `input`) and lines 1433-1479 (`.instant-filters`, `.instant-pill`)

**Current state:** Toolbar has 20px border-radius, heavy shadow, 14px padding. Input has 12px border-radius. Quick filter pills have borders and background.

**Target:** Flatter toolbar — thinner border, less shadow, smaller radius. Input gets a subtler style. Quick filter pills become minimal text-only tags.

- [ ] **Step 1: Update toolbar CSS**

Replace `.toolbarWrap` (lines 283-290):
```css
.toolbarWrap{
  position:sticky;
  top:0;
  z-index:20;
  padding:6px 0 10px;
  background:linear-gradient(to bottom, rgba(246,247,251,.97), rgba(246,247,251,.9));
  backdrop-filter:blur(10px);
}
```

Replace `.toolbar` (lines 292-298):
```css
.toolbar{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:14px;
  box-shadow:0 1px 3px rgba(0,0,0,.04);
  padding:12px;
}
```

Replace `input` (lines 323-337):
```css
input{
  width:100%;
  padding:8px 12px;
  border:1px solid var(--border);
  border-radius:10px;
  outline:none;
  background:#fff;
  color:var(--ink);
  font-size:13px;
}
input:focus{
  border-color:rgba(109,40,217,.42);
  box-shadow:0 0 0 3px rgba(109,40,217,.08);
}
```

- [ ] **Step 2: Update quick filter pills to minimal style**

Replace `.instant-pill` (lines ~1460-1479):
```css
.instant-pill{
  display:inline-flex;
  align-items:center;
  padding:4px 10px;
  border-radius:999px;
  border:1px solid var(--border);
  background:transparent;
  font-size:11px;
  color:var(--muted);
  cursor:pointer;
  transition:color .15s, border-color .15s;
  white-space:nowrap;
}
.instant-pill:hover{
  border-color:var(--accent);
  color:var(--accent);
}
.instant-pill.active{
  background:var(--accent);
  border-color:var(--accent);
  color:#fff;
}
.instant-pill.active:hover{
  background:#5b21b6;
  border-color:#5b21b6;
}
```

- [ ] **Step 3: Push and verify**

```bash
cd "/Users/rubyyang/Arcade Finder" && clasp push
```

Verify: toolbar is flatter with less shadow, input is slightly smaller, quick pills are minimal. Dark mode still correct.

---

### Task 4: Change "Launch Demo" Button Color

**Files:**
- Modify: `discovery.html` — CSS for `.btn.launch` (currently at lines ~399-406)

**Current state:** `.btn.launch` uses `var(--accent)` (purple `#6d28d9`) for background and border, white text. Hover is `#5b21b6`.

**Target:** Red Hat red (`#ee0000`) for the Launch Demo button — distinct from the purple accent used elsewhere. Hover darkens to `#cc0000`.

- [ ] **Step 1: Update `.btn.launch` CSS**

Replace the existing `.btn.launch` rules:
```css
.btn.launch{
  background:#ee0000;
  border-color:#ee0000;
  color:#fff;
}
.btn.launch:hover{
  background:#cc0000;
  border-color:#cc0000;
}
```

- [ ] **Step 2: Push and verify**

```bash
cd "/Users/rubyyang/Arcade Finder" && clasp push
```

Verify: "Launch Demo" buttons on cards and in the drawer are now Red Hat red. "Edit Demo" muted buttons are unchanged. The accent purple is still used for interactive elements (links, hover states, icons) but the primary CTA is now red.

---

## Verification Checklist

After all tasks are complete:

1. Open the HEAD/dev deployment
2. **Header:** compact single row, ghost buttons, no subtitle text visible
3. **Discover strip:** light cards with inline icons, small heading label
4. **Toolbar:** flatter, less shadow, minimal pills
5. **Launch Demo buttons:** Red Hat red on all cards and in the detail drawer
6. **Dark mode:** toggle theme and verify all sections render correctly
7. **Mobile:** resize browser to verify responsive layout still works
8. **Functionality:** search, filter, quick pills, saved demos, home menu sidebar all still work
