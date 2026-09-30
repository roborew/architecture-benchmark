# Accessibility

`tests/e2e/a11y.spec.ts` runs [axe-core](https://github.com/dequelabs/axe-core)
against all ten routes via `@axe-core/playwright`.

## Current result

Every route reports exactly one violation type, and it is the same
one everywhere:

```
[serious] color-contrast — Elements must meet minimum color contrast ratio thresholds
```

No structural problems were found: no missing form labels, no missing
landmarks, no broken heading order. The visually hidden labels and
heading hierarchy added through the stages are doing their job.

## Why the spec reports instead of asserting

The spec logs violations and passes. It does **not** assert
`expect(violations).toEqual([])`.

All three failing colour pairs are inherited from the style reference
HTML rather than introduced here, so whether the app should match the
reference exactly, or diverge from it to meet WCAG AA, is a product
decision. Asserting would encode one answer to that question as if it
were the only one, and would have turned 10 green tests red.

## The three pairs

Ratios computed from the resolved Tailwind v4 tokens:

| Pair | Ratio | AA needs | Where |
|---|---|---|---|
| `text-slate-400` on white | 2.56:1 | 4.5:1 | breadcrumbs, table descriptions, stat hints, panel counts |
| `text-slate-500` on `bg-slate-100` | 4.34:1 | 4.5:1 | the "Static example" header badge |
| `text-white` on `bg-indigo-400` | 2.98:1 | 4.5:1 | the "RA" avatar in the header |

For reference, `text-slate-500` on white is 4.76:1 and passes, so the
boundary is narrow. `slate-400` is the main offender: it is used for
supporting text at 10–11px, which is the smallest and hardest-to-read
text on every page.

## Fixing them

If the app should pass AA, the smallest change is to darken the
foreground tokens rather than lighten the backgrounds:

- `text-slate-400` → `text-slate-500` (4.76:1 on white)
- the header badge → `text-slate-600` on `bg-slate-100`
- the avatar → `bg-indigo-600`, which lifts white text clear of 4.5:1

This is a deliberate visual divergence from the reference, so it
should be an explicit choice rather than a drive-by fix.

## Once the policy is settled

Replace the summary assertion in `a11y.spec.ts` with:

```ts
expect(violations).toEqual([]);
```

## Limits

axe catches mechanical, checkable defects. It does not assess whether
a screen-reader user can follow the navigation, whether the table
visuals match their header semantics, or whether the focus order makes
sense. Those still need a human, ideally with a real screen reader.
