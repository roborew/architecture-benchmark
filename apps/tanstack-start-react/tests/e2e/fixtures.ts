// tests/e2e/fixtures.ts
//
// The shared test fixture.
//
// Specs import `test`/`expect` from here rather than from "@playwright/test",
// and call `goto` instead of `page.goto`. That is the only change the port
// required of them, and it keeps the reason for the wait in one file — see
// ./hydration.ts.

import { expect, test as base, type Page } from "@playwright/test";

import { goto } from "./hydration";

export const test = base;

export { expect, goto, type Page };
