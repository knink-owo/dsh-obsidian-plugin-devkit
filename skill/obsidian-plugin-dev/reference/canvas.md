# Extending Canvas (community plugins)

Canvas is a core plugin and its source is closed. There is **no public API** for
custom node types, renderers or node lifecycle events. Everything below is
*internal*, verified against Obsidian 1.14.4 (2026). Treat it as a last resort:
centralize access in one module, feature-detect every member, and degrade to
"no card chrome" rather than throwing. Say in the README that the plugin uses
internals.

## Data

- **Unknown fields round-trip.** The node base class collects every key that is
  not geometry/`color` in `unknownData`. `node.getData()` returns
  `{ ...unknownData, id, x, y, width, height }` (plus `color` when set), and
  `node.setData(data)` replaces `unknownData` **wholesale**. So plugin state is
  written as:

  ```ts
  node.setData({ ...node.getData(), myPlugin: nextState });
  ```

  Never pass a partial object, and never mutate `unknownData` directly.

- **Own state survives save/reload** in the `.canvas` JSON (verified 1.14.4).
  Obsidian ≤ 1.6.5 corrupted the JSON when custom fields held objects/arrays;
  1.7+ is fine, but keep the shape small and JSON-safe.
- **A custom `type` cannot work.** `Canvas.importData()` constructs only
  `file` / `text` / `link` / `group` nodes and silently skips unknown `type`
  values. There is no registration hook. Use a standard text node and store the
  extra state in a custom field (title stays in the native `text` field).
- **Saving** goes through `canvas.requestSave(requestHistory?)`; it is debounced.
  Reading the file right after a change can still return the old content —
  verify after a wait. Do not write `.canvas` yourself.
- **History.** `requestSave(true)` pushes a snapshot; `setData()` alone does
  not. Debounced autosave writes must pass `false`, and the editor should push
  one session snapshot when it closes. Otherwise Canvas undo restores a stale
  snapshot and silently reverts the autosaved data.
- `setData` takes a **single argument**; extra "requestSave" arguments in
  community snippets are ignored.

## Rendering / DOM

- Each node renders into `node.nodeEl`. The DOM has **no node id attributes**,
  so map element → node by comparing `node.nodeEl` while iterating
  `canvas.nodes` (a `Map`).
- Stable class names (verified 1.14.4): `.canvas-node`,
  `.canvas-node-container`, `.canvas-node-content`,
  `.canvas-node-content-blocker`, `.canvas-node-label`,
  `.canvas-node-placeholder`, `.canvas-node-resizer`; states `is-focused`,
  `is-selected`, `is-editing`, `is-dragging`. Never depend on minified JS
  names or internal instance classes.
- **Prefer CSS over DOM injection.** Add a class to `nodeEl` and style the
  existing containers in `styles.css`; hide body content with CSS. If one small
  control is unavoidable (e.g. a corner button), append it inside `nodeEl` and
  add `.interactive-child` so the native double-click handler ignores it.
- Nodes are rebuilt on `setViewData` / `rebuildView`, and content can be
  detached while zoomed. Re-apply from the data model after every render.
- Reapply via a `MutationObserver` on the canvas wrapper (`childList`,
  `subtree`) plus a **short `setTimeout` debounce**. Do **not** use
  `requestAnimationFrame`: when the window is hidden or backgrounded, rAF is
  paused and DOM sync silently stops.
- **Clicking:** `.canvas-node-content-blocker` swallows the first click while
  the node is unfocused; once focused, a click starts native text editing. To
  intercept cleanly, listen in the capture phase, ignore movement beyond a few
  pixels (so dragging still works), then `preventDefault()` +
  `stopPropagation()`. Suppress `dblclick` the same way if single-click opens
  your UI.
- **Pop-out windows:** one `document` listener misses them. Register listeners
  per document (`view.containerEl.ownerDocument`) and track the set.

## Events and commands

- Stable workspace events: `canvas:node-menu (menu, node)`,
  `canvas:selection-menu (menu, canvas)`, `canvas:edge-menu`. There is **no**
  `node-created` / `node-deleted` / `canvas-menu` event.
- `checkCallback` should hide commands when no relevant canvas/card is active.
  `workspace.getMostRecentLeaf()` may still point at a canvas while another
  view is active — check `activeLeaf.view instanceof CanvasView`-equivalent
  (`getViewType() === "canvas"`) instead of assuming.
- Opening/rebuilding a canvas view may be deferred (`DeferredView`); call
  `leaf.loadIfDeferred()` (or open the file and poll) before touching
  `view.canvas`.

## Driving a real app for verification

- Node rects are `0` until the view has actually rendered and the nodes are in
  the viewport. Poll `isConnected` / a non-zero `getBoundingClientRect()` before
  dispatching input; zoom-to-fit then wait.
- Over CDP the page is often hidden (`document.hidden === true`) and rAF/timers
  are throttled: `Page.bringToFront` + `Emulation.setFocusEmulationEnabled`
  first, then wait on real conditions. If synthetic element clicks are
  unreliable, dispatch `pointerdown` / `pointerup` / `click` on the element
  itself.
- Modals close on `Escape` through Obsidian's keymap scope. `window`/`document`
  capture listeners do not preempt it; push a child `Scope` with
  `app.keymap.pushScope(...)` and pop it in `onClose` if you must intercept.
- Clean up afterwards: delete temporary nodes, temp notes/exports, detached
  pop-outs, and leave the user's workspace layout as you found it.
