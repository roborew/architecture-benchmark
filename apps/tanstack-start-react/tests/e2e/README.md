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

## Why axe alone was not enough

axe reports zero violations, and it is still worth running, but it
inspects the _closed_ select. It never opens the native popup, so it
cannot see the option list at all.

A separate defect lived there: `globals.css` applied `:root` colours
through an unlayered `body { color: ... }` rule. Tailwind v4 puts its
utilities in a cascade layer and unlayered rules beat layered ones
regardless of specificity, so that rule overrode the `text-slate-800`
and `bg-slate-50` classes on `<body>`. Under `prefers-color-scheme:
dark` it forced near-white text onto the page while the select kept
`bg-white`, so the options rendered at about 1.05:1 and were
unreadable. Every select now carries an explicit `text-slate-700`.

`tests/e2e/color-scheme.spec.ts` guards this in both light and dark:
body text must clear 4.5:1, select options must clear 4.5:1, and dark
mode must not repaint the page.

## Limits

axe catches mechanical, checkable defects. It does not assess whether
a screen-reader user can follow the navigation, whether the table
visuals match their header semantics, or whether focus order makes
sense. Those still need a human, ideally with a real screen reader.

The `min-w-165` tables inside horizontally scrolling containers are
also worth a look at narrow viewports, which axe will not flag.
