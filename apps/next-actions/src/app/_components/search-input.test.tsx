import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "./search-input";

const replace = vi.fn();

// Mutable so a test can simulate the URL changing underneath the
// component — the back/forward button, or an arriving shared link.
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => params,
}));

/** Advance past the debounce inside act so effects flush. */
async function settle(ms = 300) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("SearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replace.mockClear();
    params = new URLSearchParams();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const input = () => screen.getByRole("searchbox");

  it("seeds the field from the q param already in the URL", () => {
    params = new URLSearchParams("q=alpha");

    render(<SearchInput placeholder={""} label={""} />);

    expect(input()).toHaveValue("alpha");
  });

  it("does not navigate before the debounce elapses", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.type(input(), "alpha");
    await settle(299);

    expect(replace).not.toHaveBeenCalled();
  });

  it("writes the query to the URL once the debounce elapses", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.type(input(), "alpha");
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects?q=alpha", {
      scroll: false,
    });
  });

  it("collapses a burst of typing into a single navigation", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.type(input(), "alpha");
    await settle();

    // The whole point of debouncing: one query, not one per keystroke.
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("navigates to the bare path when the field is cleared", async () => {
    params = new URLSearchParams("q=alpha");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.clear(input());
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects", { scroll: false });
  });

  it("keeps the trailing space while typing a second word", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.type(input(), "alpha ");
    await settle();
    await user.type(input(), "beta");
    await settle();

    // The URL is trimmed, but the visible field must not be — otherwise
    // "alpha beta" collapses to "alphabeta" as you type.
    expect(input()).toHaveValue("alpha beta");
    expect(replace).toHaveBeenLastCalledWith("/projects?q=alpha+beta", {
      scroll: false,
    });
  });

  it("holds off until the query is long enough to be worth a round trip", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.type(input(), "a");
    await settle();

    expect(replace).not.toHaveBeenCalled();
  });

  it("preserves unrelated params already in the URL", async () => {
    params = new URLSearchParams("status=done");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.type(input(), "alpha");
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects?status=done&q=alpha", {
      scroll: false,
    });
  });

  it("adopts a query that arrives from outside, as on back/forward", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<SearchInput placeholder={""} label={""} />);

    params = new URLSearchParams("q=beta");
    rerender(<SearchInput placeholder={""} label={""} />);

    expect(input()).toHaveValue("beta");

    await user.clear(input());
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects", { scroll: false });
  });

  it("targets its own route rather than a hardcoded one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchInput placeholder={""} label={""} />);

    await user.type(input(), "alpha");
    await settle();

    expect(replace).toHaveBeenCalledWith(expect.stringContaining("/tasks"), {
      scroll: false,
    });
  });
});
