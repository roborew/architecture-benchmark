// tests/helpers/orpc-harness.test.tsx
//
// Tests for the test helper. The harness is load-bearing for every users test:
// if it silently stopped recording calls, or started rejecting a refused write
// instead of resolving it, the component tests would go green while asserting
// nothing. A helper that quietly degrades is worse than no helper.
//
// The probes import `orpc` from "@/orpc/client" — the same module the real
// components import. That is deliberate: it is the only way to prove the mock is
// actually intercepting, which a probe holding its own utils would not.

import { useMutation } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { orpc } from "@/orpc/client";
import { accepted, renderWithOrpc, rejected } from "./orpc-harness";

// Declared HERE, not in the helper: see the note at the top of orpc-harness.tsx.
//
// The factory is inlined rather than referencing an imported `orpcMock`, because
// vi.mock is hoisted above the imports and would hit a temporal dead zone. It
// duplicates orpcMock() on purpose — the two must stay in step, and the helper's
// own test asserts they agree.
vi.mock("@/orpc/client", () => ({
  get orpc() {
    const utils = (globalThis as { __orpcTestUtils?: unknown }).__orpcTestUtils;

    if (!utils) {
      throw new Error(
        "orpc was read before renderWithOrpc ran. Render through the harness so the client is terminated.",
      );
    }

    return utils;
  },
}));

/**
 * A probe that runs `users.delete` and reports the outcome through a callback.
 *
 * A component rather than a direct client call, so the harness is exercised
 * through the same `mutationOptions()` + `useMutation` path the real components
 * use.
 */
function makeProbe(hooks: {
  onSuccess?: (result: unknown) => void;
  onError?: (error: Error) => void;
}) {
  return function Probe() {
    const mutation = useMutation(
      orpc.users.delete.mutationOptions({
        onSuccess: (result) => hooks.onSuccess?.(result),
        onError: (error) => hooks.onError?.(error as Error),
      }),
    );

    return (
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ id: 7 })}
      >
        {mutation.isPending ? "working" : "go"}
      </button>
    );
  };
}

describe("orpc-harness", () => {
  it("records the procedure path and input a component calls", async () => {
    const user = userEvent.setup();
    const Probe = makeProbe({});
    const { calls } = renderWithOrpc(<Probe />);

    await user.click(screen.getByRole("button", { name: "go" }));

    await waitFor(() =>
      expect(calls).toContainEqual({ path: "users.delete", input: { id: 7 } }),
    );
  });

  it("resolves the responder's value through the real mutationOptions builder", async () => {
    const user = userEvent.setup();
    let seen: unknown;

    const Probe = makeProbe({
      onSuccess: (result) => {
        seen = result;
      },
    });

    renderWithOrpc(<Probe />, () => accepted(99));
    await user.click(screen.getByRole("button", { name: "go" }));

    await waitFor(() => expect(seen).toEqual({ ok: true, id: 99 }));
  });

  it("delivers a refusal as a resolved value, not a thrown error", async () => {
    // The property the components depend on: src/lib/result.ts returns
    // { ok: false } so the form can render it. If the harness rejected instead,
    // every "shows the field error" test would fail for the wrong reason.
    const user = userEvent.setup();
    let seen: unknown;

    const Probe = makeProbe({
      onSuccess: (result) => {
        seen = result;
      },
    });

    renderWithOrpc(<Probe />, () =>
      rejected({ name: ["User name is required."] }, "nope"),
    );
    await user.click(screen.getByRole("button", { name: "go" }));

    await waitFor(() =>
      expect(seen).toEqual({
        ok: false,
        errors: { name: ["User name is required."] },
        message: "nope",
      }),
    );
  });

  it("surfaces a thrown failure as a rejected mutation", async () => {
    // The counterpart to the case above: a real fault must still reject, so the
    // component's onError branch stays reachable.
    const user = userEvent.setup();
    let seen: string | undefined;

    const Probe = makeProbe({
      onError: (error) => {
        seen = error.message;
      },
    });

    renderWithOrpc(<Probe />, () => {
      throw new Error("boom");
    });
    await user.click(screen.getByRole("button", { name: "go" }));

    await waitFor(() => expect(seen).toBe("boom"));
  });

  it("holds a mutation in flight until the responder resolves", async () => {
    // isPending drives the button's disabled state, which delete-user-button
    // asserts on.
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};

    const Probe = makeProbe({});

    renderWithOrpc(
      <Probe />,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    await user.click(screen.getByRole("button", { name: "go" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "working" })).toBeDisabled(),
    );

    release(accepted());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "go" })).toBeEnabled(),
    );
  });

  it("fails loudly if a component reads orpc without the harness", () => {
    // Guards the failure mode that would otherwise be invisible: a component
    // rendered outside renderWithOrpc silently falling back to the real
    // network-backed client.
    const Probe = makeProbe({});
    (globalThis as { __orpcTestUtils?: unknown }).__orpcTestUtils = undefined;

    expect(() => render(<Probe />)).toThrow(/renderWithOrpc/);
  });
});
