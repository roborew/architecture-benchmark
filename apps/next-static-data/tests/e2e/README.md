# Accessibility

`tests/e2e/a11y.spec.ts` runs [axe-core](https://github.com/dequelabs/axe-core)
against all ten routes via `@axe-core/playwright`, and asserts no
violations are present.

```sh
pnpm test:e2e --project=chromium tests/e2e/a11y.spec.ts
```

## Current result

All ten routes pass. When a violation is introduced the spec fails
with the rule id, impact, node count and an example selector, so a
regression is actionable without opening the full axe payload.

## What was fixed

The app inherited three contrast failures from the style reference
HTML. All were foreground-token darkenings rather than background
lightenings, so the layout and the visual weight are unchanged.

| Pair                                | Before | After                    | Change                                                    |
| ----------------------------------- | ------ | ------------------------ | --------------------------------------------------------- |
| `text-slate-400` on white           | 2.56:1 | `text-slate-500` 4.76:1  | breadcrumbs, table descriptions, stat hints, panel counts |
| `text-slate-500` on `bg-slate-100`  | 4.34:1 | `text-slate-600` 6.92:1  | the "Static example" header badge                         |
| `text-indigo-500` on `bg-indigo-50` | 3.99:1 | `text-indigo-600` 5.62:1 | the avatar initials                                       |
| `text-white` on `bg-indigo-400`     | 2.98:1 | `bg-indigo-600` 6.29:1   | the "RA" avatar                                           |

That took the app from 95 failing nodes to zero.

## One deliberate exception

`text-slate-400` in `navigation.tsx` is **not** changed. It sits on the
navy sidebar, so it is light-on-dark and already passes at 6.14:1.
Darkening it to `slate-500` would drop it to 3.31:1 and _introduce_ a
failure. Any future bulk change to `slate-400` must skip that file.

## Limits

axe catches mechanical, checkable defects. It does not assess whether
a screen-reader user can follow the navigation, whether the table
visuals match their header semantics, or whether focus order makes
sense. Those still need a human, ideally with a real screen reader.

The `min-w-165` tables inside horizontally scrolling containers are
also worth a look at narrow viewports, which axe will not flag.
