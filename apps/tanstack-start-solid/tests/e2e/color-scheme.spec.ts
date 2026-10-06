import { expect, goto, test, type Page } from "./fixtures";

// The app is light-only by design: every surface is an explicit slate
// or white utility class, copied from the static style reference.
//
// globals.css used to define :root colours plus a prefers-color-scheme
// block, and apply them through an unlayered `body { color: ... }`
// rule. Tailwind v4 puts its utilities in a cascade layer, and
// unlayered rules beat layered ones regardless of specificity, so that
// body rule silently overrode the text-slate-800 and bg-slate-50
// classes on <body>.
//
// In dark mode the override forced near-white text onto a near-black
// page while the select kept bg-white, so the dropdown options
// rendered at roughly 1.05:1 and were unreadable. axe cannot see this:
// it inspects the closed select, never the native popup.

const ROUTES = ["/", "/projects", "/tasks", "/users", "/tasks/new"];

type Colours = { color: string; background: string };

async function bodyColours(page: Page): Promise<Colours> {
  // Read through a canvas so the values come back as plain rgb().
  // getComputedStyle returns lab() in modern Chrome, which no simple
  // regex can parse back into channels.
  return page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const toRgb = (value: string) => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return value;
      ctx.fillStyle = "#000";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    return {
      color: toRgb(style.color),
      background: toRgb(style.backgroundColor),
    };
  });
}

async function selectColours(page: Page) {
  return page.evaluate(() => {
    const toRgb = (value: string) => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return value;
      ctx.fillStyle = "#000";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };

    return Array.from(document.querySelectorAll("select")).map((select) => {
      const option = select.querySelector("option");
      return {
        id: select.getAttribute("aria-label") ?? select.id,
        color: toRgb(getComputedStyle(option ?? select).color),
        background: toRgb(getComputedStyle(select).backgroundColor),
      };
    });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`colour scheme: ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const route of ROUTES) {
      test(`${route} keeps body text legible on its background`, async ({
        page,
      }) => {
        await goto(page, route);

        const { color, background } = await bodyColours(page);
        const ratio = contrast(color, background);

        expect(
          ratio,
          `body text ${color} on ${background} is only ${ratio}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    test("select options are legible against the select background", async ({
      page,
    }) => {
      await goto(page, "/tasks");

      const results = await selectColours(page);

      expect(results.length).toBeGreaterThan(0);

      for (const result of results) {
        const ratio = contrast(result.color, result.background);
        expect(
          ratio,
          `select "${result.id}" text ${result.color} on ${result.background} is ${ratio}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}

test("dark mode does not repaint the page", async ({ browser }) => {
  const read = async (scheme: "light" | "dark") => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await goto(page, "/");
    const colours = await bodyColours(page);
    await context.close();
    return colours;
  };

  // A light-only design must render the same in both schemes. If this
  // fails, something is reading prefers-color-scheme and overriding
  // the utility classes on <body>.
  expect(await read("dark")).toEqual(await read("light"));
});

function parseRgb(value: string): [number, number, number] {
  const match = value.match(/[\d.]+/g);
  if (!match) return [0, 0, 0];
  return [Number(match[0]), Number(match[1]), Number(match[2])];
}

function luminance(rgb: [number, number, number]) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string) {
  const l1 = luminance(parseRgb(fg));
  const l2 = luminance(parseRgb(bg));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
