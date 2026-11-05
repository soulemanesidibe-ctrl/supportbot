# Skill: Responsive Mobile-First Design in React with Inline Styles

## Overview

A reusable reference for implementing responsive, mobile-first layouts in React applications that use inline styles (no Tailwind, no CSS modules). Covers breakpoint systems, touch targets, safe-area handling, drawer patterns, table-to-card transformations, and Recharts responsiveness.

---

## 1. Breakpoint System

### Tokens

```js
// Define once, import everywhere
export const BP = {
  sm:      375,   // small mobile (minimum viable)
  mobile:  768,   // mobile/tablet boundary (primary breakpoint)
  tablet:  1024,  // tablet/desktop boundary
  desktop: 1440,  // wide desktop
}
```

### useBreakpoint Hook

```jsx
// src/hooks/useBreakpoint.js
import { useState, useEffect } from 'react'
import { BP } from '../lib/responsive'

export function useBreakpoint() {
  const get = () => {
    const w = window.innerWidth
    if (w < BP.mobile)  return 'mobile'
    if (w < BP.tablet)  return 'tablet'
    return 'desktop'
  }
  const [bp, setBp] = useState(get)
  useEffect(() => {
    const handler = () => setBp(get())
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return bp  // 'mobile' | 'tablet' | 'desktop'
}

// Convenience
export function useIsMobile() {
  return useBreakpoint() === 'mobile'
}
```

### Usage Pattern

```jsx
const bp = useBreakpoint()
const isMobile = bp === 'mobile'

// Inline style switch
const containerStyle = {
  padding: isMobile ? '12px 16px' : '24px 32px',
  flexDirection: isMobile ? 'column' : 'row',
}
```

### rs() Helper (optional)

```jsx
// Merge base + breakpoint overrides at runtime
export function rs(base, overrides = {}, w = window.innerWidth) {
  let result = { ...base }
  if (w < BP.mobile && overrides.mobile)  result = { ...result, ...overrides.mobile }
  else if (w < BP.tablet && overrides.tablet) result = { ...result, ...overrides.tablet }
  return result
}
```

---

## 2. Mobile-First Global CSS Baseline

Inject via `<style>` tag in `index.html` or a single `<GlobalStyles>` component. This handles things inline styles cannot (pseudo-selectors, safe-area custom properties, overflow resets).

```css
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; max-width: 100vw; overflow-x: hidden; -webkit-text-size-adjust: 100%; }

/* Dynamic viewport height custom property */
:root { --dvh: 1vh; }
@supports (height: 1dvh) { :root { --dvh: 1dvh; } }

/* Safe-area custom properties */
:root {
  --safe-top:    env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left:   env(safe-area-inset-left, 0px);
  --safe-right:  env(safe-area-inset-right, 0px);
}

/* Prevent flex children from overflowing */
img, video, svg { max-width: 100%; }
```

---

## 3. min-h-dvh (Dynamic Viewport Height)

**Problem:** `100vh` on iOS Safari includes the browser chrome, causing overflow.
**Solution:** Use `100dvh` — it reacts to browser chrome show/hide.

```jsx
// Replace all minHeight:'100vh' with:
const layoutStyle = {
  minHeight: '100dvh',
  // Fallback for older browsers (iOS 14 and earlier):
  // minHeight: 'calc(var(--dvh, 1vh) * 100)',
}
```

**Rule:** Search for `100vh` in any layout/shell component and replace with `100dvh`.

---

## 4. Safe-Area Insets (iOS Notch / Home Indicator)

**Prerequisite viewport meta:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

### env() in React inline styles

`env(safe-area-inset-*)` works as a plain string value in React inline styles:

```jsx
style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
```

### Bottom Navigation Bar

```jsx
// Nav container: grows to cover home indicator
const bottomNavStyle = {
  position: 'fixed',
  bottom: 0,
  width: '100%',
  background: '#fff',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  borderTop: '1px solid #D4EEEE',
}

// Content area: pad to avoid overlap with nav + safe area
const contentStyle = {
  flex: 1,
  overflowY: 'auto',
  paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
  // 88px = visual height of nav bar
}
```

### Top Bar (PWA standalone mode)

```jsx
const topBarStyle = {
  position: 'sticky',
  top: 0,
  zIndex: 90,
  paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
  // or: paddingTop: 'max(10px, env(safe-area-inset-top, 0px))'
}
```

### Fixed Sidebar (admin)

```jsx
const sidebarStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
}
```

---

## 5. Off-Canvas Drawer (Hamburger Menu) Pattern

For admin/sidebar layouts on mobile, the fixed sidebar becomes an off-canvas drawer.

### State

```jsx
const [drawerOpen, setDrawerOpen] = useState(false)
const isMobile = useIsMobile()

// Lock body scroll when drawer is open
useEffect(() => {
  document.body.style.overflow = isMobile && drawerOpen ? 'hidden' : ''
  return () => { document.body.style.overflow = '' }
}, [isMobile, drawerOpen])
```

### Backdrop

```jsx
{isMobile && drawerOpen && (
  <div
    onClick={() => setDrawerOpen(false)}
    style={{
      position: 'fixed', inset: 0, zIndex: 199,
      background: 'rgba(0,0,0,.45)',
      backdropFilter: 'blur(2px)',
      WebkitBackdropFilter: 'blur(2px)',
    }}
  />
)}
```

### Drawer Panel

```jsx
const drawerStyle = isMobile
  ? {
      position: 'fixed', top: 0, left: 0, bottom: 0,
      width: 280, zIndex: 200,
      transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
      transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      overflowY: 'auto',
    }
  : {
      // existing desktop fixed/collapsible sidebar
      width: collapsed ? 68 : 248,
      transition: 'width .22s cubic-bezier(.4,0,.2,1)',
    }
```

### Hamburger Button

```jsx
<button
  onClick={() => setDrawerOpen(true)}
  aria-label="Ouvrir le menu"
  aria-expanded={drawerOpen}
  style={{
    background: 'transparent', border: 'none', cursor: 'pointer',
    minWidth: 44, minHeight: 44,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  }}
>
  <HamburgerIcon size={22} />
</button>
```

### Auto-close on Navigation

```jsx
// On every nav link inside the drawer:
<NavLink onClick={() => isMobile && setDrawerOpen(false)} ...>
```

---

## 6. Touch Target Rules

| Rule | Value | Source |
|------|-------|--------|
| Minimum touch target size | 44 × 44 px | Apple HIG, WCAG 2.5.5 |
| Minimum spacing between targets | 8 px | Apple HIG |
| Body text on mobile | 16 px minimum | Prevents iOS auto-zoom |
| Input font-size | 16 px minimum | Prevents iOS Safari zoom on focus |

```jsx
// All interactive elements
const touchBase = {
  minHeight: 44,
  minWidth: 44,
  cursor: 'pointer',
}

// Icon-only buttons — expand hit area with padding
const iconButtonStyle = {
  padding: 10,
  minHeight: 44,
  minWidth: 44,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

// Prevent iOS input zoom — set font-size >= 16px on inputs
const inputMobileStyle = {
  fontSize: 16,  // critical: anything < 16 triggers iOS Safari zoom
}
```

---

## 7. Table → Cards Pattern

Render `<table>` on desktop, stacked cards on mobile.

```jsx
function ResponsiveTable({ columns, data, keyField = 'id' }) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.map(row => (
          <div key={row[keyField]} style={{
            background: '#fff', borderRadius: 12,
            border: '1px solid #D4EEEE',
            padding: '14px 16px',
            boxShadow: '0 1px 8px rgba(4,55,64,.06)',
          }}>
            {columns.map(col => (
              <div key={col.key} style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', marginBottom: 8, gap: 8,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#5A7A7A',
                  textTransform: 'uppercase', letterSpacing: .3,
                  flexShrink: 0, minWidth: 90,
                }}>
                  {col.label}
                </span>
                <span style={{ fontSize: 13, color: '#043740', textAlign: 'right' }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #D4EEEE' }}>
            {columns.map(col => (
              <th key={col.key} style={{
                padding: '10px 14px', textAlign: 'left',
                color: '#5A7A7A', fontWeight: 700, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: .3, whiteSpace: 'nowrap',
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row[keyField]} style={{ borderBottom: '1px solid #D4EEEE' }}>
              {columns.map(col => (
                <td key={col.key} style={{ padding: '11px 14px', color: '#043740' }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

---

## 8. Recharts Responsive Patterns

### ResponsiveContainer (required)

Always wrap charts. Never set a fixed `width` prop on the chart component itself.

```jsx
<div style={{ width: '100%', height: isMobile ? 220 : 320 }}>
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{
      top: 5,
      right: isMobile ? 5 : 20,
      bottom: isMobile ? 20 : 5,
      left: isMobile ? -20 : 0,
    }}>
      ...
    </LineChart>
  </ResponsiveContainer>
</div>
```

### Axis Adaptation

```jsx
<XAxis
  dataKey="label"
  tick={{ fontSize: isMobile ? 10 : 12 }}
  // Show only first/last label on mobile
  interval={isMobile ? 'preserveStartEnd' : 0}
  // Or limit to ~4 labels:
  // interval={isMobile ? Math.ceil(data.length / 4) : 0}
/>

<YAxis
  tick={{ fontSize: isMobile ? 10 : 12 }}
  width={isMobile ? 28 : 40}
  tickCount={isMobile ? 4 : 6}
  // Optionally hide on very small screens:
  // hide={windowWidth < 375}
/>
```

### Legend Repositioning

```jsx
<Legend
  layout={isMobile ? 'horizontal' : 'vertical'}
  verticalAlign={isMobile ? 'bottom' : 'middle'}
  align={isMobile ? 'center' : 'right'}
  wrapperStyle={{ fontSize: isMobile ? 10 : 12, paddingTop: isMobile ? 8 : 0 }}
/>
```

### Height by Screen Width

```jsx
const chartHeight = (w) => {
  if (w < 375)  return 180
  if (w < 768)  return 220
  if (w < 1024) return 280
  return 320
}
```

### PieChart / Donut Radius

```jsx
<Pie
  outerRadius={isMobile ? 70 : 100}
  innerRadius={isMobile ? 40 : 60}
  label={isMobile ? false : renderCustomLabel}
  // Hide labels on mobile — use Tooltip instead
/>
```

### Dot Visibility

```jsx
// Hide dots on mobile (too small, crowded)
<Line type="monotone" dataKey="value" strokeWidth={2} dot={!isMobile} activeDot={{ r: 5 }} />
```

---

## 9. Responsive Grid Layout

```jsx
// CSS Grid auto-fill: adapts to available width automatically
const autoGridStyle = {
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(280px, 1fr))`,
  gap: 16,
}

// Explicit column count
const statGridStyle = (isMobile) => ({
  display: 'grid',
  gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
  gap: isMobile ? 10 : 16,
})
```

---

## 10. Overflow Prevention Checklist

```jsx
// Root layout
{ maxWidth: '100vw', overflowX: 'hidden' }

// Flex rows that might wrap
{ display: 'flex', flexWrap: 'wrap', gap: 12 }

// Flex children — prevent silent overflow
{ minWidth: 0 }  // on any flex child that contains text or grows

// Text truncation in flex children
{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }

// All images
{ maxWidth: '100%', height: 'auto' }

// Scrollable containers
{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }
```

---

## 11. iOS Safari Quirks Reference

| Issue | Cause | Fix |
|-------|-------|-----|
| Page zooms on input focus | `font-size < 16px` on input | Set `fontSize: 16` on all inputs |
| `100vh` overflows | Includes browser chrome | Use `100dvh` |
| Gray tap flash | Default `-webkit-tap-highlight-color` | Set to `transparent` globally |
| Fixed element jumps when keyboard opens | Virtual keyboard resizes viewport | Use `position: sticky` for top bars where possible |
| `env()` not working | Missing `viewport-fit=cover` in viewport meta | Add it |
| Momentum scroll missing | Default disabled in some containers | Add `WebkitOverflowScrolling: 'touch'` |

---

## 12. Touch Form Patterns (Mobile Survey / Rating)

For finger-friendly forms (e.g., multi-step surveys, rating scales):

```jsx
// Scale buttons (1–5, 1–10) — large tap targets
function ScaleInput({ value, onChange, min = 1, max = 5 }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {Array.from({ length: max - min + 1 }, (_, i) => i + min).map(n => (
        <button
          key={n}
          onClick={() => onChange(n)}
          style={{
            flex: 1,
            minHeight: 52,
            minWidth: 44,
            borderRadius: 10,
            border: `2px solid ${value === n ? '#009EA0' : '#D4EEEE'}`,
            background: value === n ? '#E6F7F7' : '#fff',
            color: value === n ? '#009EA0' : '#043740',
            fontWeight: value === n ? 700 : 400,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'all .15s',
          }}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

// Sticky progress bar
function ProgressBar({ current, total }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 50, background: '#F2FAFA', paddingBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
        <span>{current} / {total}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: '#D4EEEE' }}>
        <div style={{
          height: '100%', borderRadius: 2, background: '#009EA0',
          width: `${(current / total) * 100}%`,
          transition: 'width .3s',
        }} />
      </div>
    </div>
  )
}
```

---

## 13. Active States (Replace hover-only states)

On mobile, `:hover` does not work. Use `onPointerDown` / `onPointerUp` for visual feedback:

```jsx
function TouchButton({ children, onClick, style }) {
  const [active, setActive] = useState(false)
  return (
    <button
      onClick={onClick}
      onPointerDown={() => setActive(true)}
      onPointerUp={() => setActive(false)}
      onPointerLeave={() => setActive(false)}
      style={{
        ...style,
        opacity: active ? 0.75 : 1,
        transform: active ? 'scale(0.97)' : 'scale(1)',
        transition: 'opacity .1s, transform .1s',
      }}
    >
      {children}
    </button>
  )
}
```

---

## 14. Implementation Checklist

Before shipping any responsive screen:

- [ ] No horizontal scroll at 375px viewport width
- [ ] All interactive elements are >= 44 × 44 px
- [ ] Body text >= 16px on mobile (no iOS zoom)
- [ ] Input `fontSize` >= 16px
- [ ] `minHeight:'100dvh'` used (not `100vh`) in all layout shells
- [ ] Bottom bars use `env(safe-area-inset-bottom, 0px)` padding
- [ ] Content areas add `calc(navHeight + env(safe-area-inset-bottom, 0px))` bottom padding
- [ ] All charts wrapped in `<ResponsiveContainer width="100%" height="100%">`
- [ ] Tables render as stacked cards on mobile OR wrapped in `overflowX: 'auto'`
- [ ] No `hover`-only interactive states (add `onPointerDown` active state)
- [ ] Flex children have `minWidth: 0` to prevent overflow
- [ ] Drawer has backdrop, scroll-lock, and auto-close on nav

---

## 15. File Structure Recommendation

```
src/
  hooks/
    useBreakpoint.js       ← breakpoint hook
  lib/
    responsive.js          ← BP tokens, rs() helper
  components/
    ResponsiveTable.jsx    ← table/cards toggle
    ui.jsx                 ← add BP export if not present
```
