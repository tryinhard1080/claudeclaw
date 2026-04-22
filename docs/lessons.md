# Lessons Learned

## 2026-04-22 — Space Agent Widget: `parent.querySelector` with compound selector returns null

### Error
```
Overview: Cannot set properties of null (setting 'textContent')
Trades: Cannot set properties of null (setting 'textContent')
```

Shown inside the Space Agent trading dashboard widget on the ClaudeClaw space.

### Root cause
The widget's `el` helper was defined as:
```javascript
const el = (s) => parent.querySelector("#tdash " + s);
```

Calling `el("#status-msg")` expands to `parent.querySelector("#tdash #status-msg")`. This compound selector requires `#tdash` to be a *descendant* of `parent`. Depending on how Space Agent mounts the widget container, `parent` can BE the `#tdash` wrapper or a sibling-level element — making the two-level selector return `null`. A detached-parent race (stale `setInterval` closure after widget re-render) compounded the issue.

Secondary issue: `/api/poly/trades` with no `status` filter returns all trades (open + closed + voided), causing a cluttered table and potential null `market_slug` fields on voided rows.

### Fix (`app/L2/user/spaces/claudeclaw/widgets/trading-dashboard.yaml`)

1. **Selector fixed** — removed `#tdash` prefix from `el`:
   ```javascript
   // Before
   const el = (s) => parent.querySelector("#tdash " + s);
   // After
   const el = (s) => parent.querySelector(s);
   ```

2. **Null-guarded writes** — introduced `set()` helper so no single missing element crashes the refresh cycle:
   ```javascript
   function set(selector, prop, value) {
     const node = el(selector);
     if (node) node[prop] = value;
   }
   ```

3. **Open-trades filter** — appended `&status=open` to the trades fetch URL.

4. **`slugToTitle` guard** — added `if (!slug) return "—"` to handle null slugs on voided trades.

5. **Interval cleanup** — `MutationObserver` watches `document.body` and calls `clearInterval` + `disconnect` when `parent` is removed from the DOM, preventing stale-closure ghost refreshes.

### Rule for future Space Agent widgets
- **Never use a compound `#parent #child` selector** in Space Agent renderer functions. Use `parent.querySelector("#child")` (single ID) or `parent.querySelector(".class")`.
- **Always guard DOM writes** through a null-safe helper — widget containers can be detached mid-interval.
- **Always add `if (!parent.isConnected) return;`** at the top of any `setInterval` callback in a widget renderer.
