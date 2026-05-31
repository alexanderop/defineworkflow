# Feature: Rough.js Diagram Toolkit

> Hand-drawn, Excalidraw-style SVG diagrams for the VitePress docs, authored declaratively and themed to the dark docs.

## Overview

A set of Vue components for the docs site that render diagrams with a sketchy, hand-drawn look
(via [rough.js](https://roughjs.com)). The primary API is a declarative `<RoughDiagram>` that takes
`nodes`/`edges` and auto-lays them out with [dagre](https://github.com/dagrejs/dagre). A lower-level
primitive set (`<RoughCanvas>` + `<RoughBox>`/`<RoughArrow>`/`<RoughText>`/`<RoughBracket>`) exists for
hand-placed diagrams. Colors come from the existing VitePress/`--wf-*` CSS variables so diagrams match
light/dark themes automatically.

## Goals

- Replace ASCII-art diagrams (e.g. the "mental model" block in `guide/index.md`) with real, legible diagrams.
- Author diagrams declaratively — describe nodes + edges, let dagre place them.
- Match the docs aesthetic: hand-drawn strokes, dark-first, theme-reactive.
- Provide reusable primitives so any guide page can drop in a diagram.

## Decisions (from brainstorm)

- **Authoring:** Declarative `<RoughDiagram :nodes :edges>` (primary) + primitive toolkit (escape hatch).
- **Render timing:** Runtime in the browser (rough.js + dagre run on mount). SSR renders an empty
  `<svg>` placeholder, populated imperatively in `onMounted` — no hydration mismatch.
- **Theming:** Dark-first, theme-reactive — palette read from CSS variables, redrawn on theme toggle.
- **Layout:** dagre auto-layout (`rankdir` LR/TB, configurable `nodesep`/`ranksep`).

## Implementation Details

- `useRough.ts` composable:
  - `useRoughPalette()` — reactive palette read from `getComputedStyle(documentElement)`, refreshed via
    a `MutationObserver` on the `<html>` `class` attribute (VitePress toggles `.dark`).
  - `seedFrom(string)` — deterministic seed so the sketch is stable across redraws (no flicker on toggle).
  - `measureText()` — shared canvas 2d context for label sizing.
  - arrowhead + dashed-line draw helpers.
- `RoughDiagram.vue` — measure labels → dagre layout → draw rough rects + crisp SVG `<text>` + arrows.
  Responsive via `viewBox` (scales with container, no redraw on resize). Accent colors per node.
- Primitives use `provide`/`inject`: `RoughCanvas` collects child draw ops and re-runs them on palette change.
- All components global-registered in `.vitepress/theme/index.ts`.

## Scope

### MVP

- `RoughDiagram` (dagre) + primitive toolkit + `guide/diagrams.md` usage page.
- Mental-model diagram in `guide/index.md` converted to `<RoughDiagram>`.

### Future Enhancements

- [ ] Edge labels routed along the path midpoint.
- [ ] `.excalidraw` file import.
- [ ] Optional draw-in animation on scroll-into-view.
- [ ] Build-time pre-render to inert SVG for zero client JS.

## Status

**Status:** Spec Complete / In Progress
**Created:** 2026-05-30
**Priority:** TBD
