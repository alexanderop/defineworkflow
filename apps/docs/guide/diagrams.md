# Hand-drawn diagrams

The docs render diagrams with a sketchy, Excalidraw-style look using
[rough.js](https://roughjs.com). Two layers are available:

- **`<RoughDiagram>`** — declarative `nodes` + `edges`, auto-laid-out with
  [dagre](https://github.com/dagrejs/dagre). Reach for this first.
- **`<RoughCanvas>` + primitives** — `<RoughBox>`, `<RoughArrow>`, `<RoughText>`,
  `<RoughBracket>` placed by hand when you want exact control.

Both read their colors from the theme's CSS variables, so they track the
light/dark toggle automatically. Everything renders in the browser; the SVG is
sketched on mount and re-sketched when the theme changes.

## `<RoughDiagram>`

Describe a graph; dagre places the nodes.

<RoughDiagram
  direction="LR"
  caption="a fan-out and fold-back"
  :nodes="[
    { id: 'in', label: 'input' },
    { id: 'a', label: 'agent()', accent: 'amber' },
    { id: 'b', label: 'agent()', accent: 'amber' },
    { id: 'out', label: 'merge', sub: 'collect', accent: 'cyan' },
  ]"
  :edges="[
    ['in', 'a'], ['in', 'b'], ['a', 'out'], ['b', 'out'],
  ]"
/>

```md
<RoughDiagram
  direction="LR"
  caption="a fan-out and fold-back"
  :nodes="[
    { id: 'in', label: 'input' },
    { id: 'a', label: 'agent()', accent: 'amber' },
    { id: 'b', label: 'agent()', accent: 'amber' },
    { id: 'out', label: 'merge', sub: 'collect', accent: 'cyan' },
  ]"
  :edges="[
    ['in', 'a'], ['in', 'b'], ['a', 'out'], ['b', 'out'],
  ]"
/>
```

### Props

| Prop        | Type                                   | Default | Notes                                            |
| ----------- | -------------------------------------- | ------- | ------------------------------------------------ |
| `nodes`     | `{ id, label, sub?, accent?, shape? }[]` | —       | `accent`: `amber \| cyan \| green \| red \| violet` |
| `edges`     | `[from, to][]` or `{ from, to, label?, dashed? }[]` | `[]` | accepts tuples or objects                        |
| `direction` | `'LR' \| 'TB'`                          | `'LR'`  | rank direction                                   |
| `nodesep`   | `number`                               | `26`    | gap between nodes in a rank                       |
| `ranksep`   | `number`                               | `58`    | gap between ranks                                 |
| `caption`   | `string`                               | `''`    | italic caption under the figure                   |
| `fontSize`  | `number`                               | `14`    | label size in px                                  |

A node with a `sub` renders a dimmer second line (e.g. `label: 'journal', sub: 'key → result'`).
Set `shape: 'ellipse'` for a rounded node.

## Primitives

When auto-layout isn't the right shape, place things yourself on a
`<RoughCanvas>`. Coordinates live in the canvas's `width`×`height` viewBox and
scale responsively. Children only register draw calls — they render nothing in
the DOM themselves, so order them back-to-front (arrows first, boxes on top).

<RoughCanvas :width="420" :height="140" caption="hand-placed: a bracket grouping three calls">
  <RoughArrow :from="[120, 40]" :to="[210, 70]" />
  <RoughArrow :from="[120, 70]" :to="[210, 70]" />
  <RoughArrow :from="[120, 100]" :to="[210, 70]" />
  <RoughBox :x="20" :y="52" :width="92" :height="36" label="agent()" accent="amber" />
  <RoughBox :x="20" :y="8" :width="92" :height="36" label="agent()" accent="amber" />
  <RoughBox :x="20" :y="96" :width="92" :height="36" label="agent()" accent="amber" />
  <RoughBox :x="214" :y="50" :width="120" :height="40" label="journal" sub="key → result" />
</RoughCanvas>

```md
<RoughCanvas :width="420" :height="140" caption="…">
  <RoughArrow :from="[120, 40]" :to="[210, 70]" />
  <RoughArrow :from="[120, 70]" :to="[210, 70]" />
  <RoughArrow :from="[120, 100]" :to="[210, 70]" />
  <RoughBox :x="20" :y="8"  :width="92" :height="36" label="agent()" accent="amber" />
  <RoughBox :x="20" :y="52" :width="92" :height="36" label="agent()" accent="amber" />
  <RoughBox :x="20" :y="96" :width="92" :height="36" label="agent()" accent="amber" />
  <RoughBox :x="214" :y="50" :width="120" :height="40" label="journal" sub="key → result" />
</RoughCanvas>
```

### Primitive reference

- **`<RoughBox :x :y :width :height label? sub? accent? shape?>`** — a sketchy
  rectangle (or `shape="ellipse"`) with a centered label.
- **`<RoughArrow :from :to via? accent? dashed? label? :head?>`** — a polyline
  from `from` to `to` (optional `via` bend points) with an arrowhead at the end.
- **`<RoughText :x :y text anchor? accent? muted? size? weight? italic?>`** —
  crisp label text.
- **`<RoughBracket :x :y :height side? arm? connector? accent?>`** — a square
  grouping bracket; `side="left"` points its arms right.

> Labels are real SVG `<text>` (crisp and selectable) — only the shapes and
> arrows are sketched, so diagrams stay legible at any zoom.
