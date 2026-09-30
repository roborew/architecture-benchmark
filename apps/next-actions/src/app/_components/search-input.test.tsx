import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "./search-input";

const replace = vi.fn();

// Mutable so a test can change the URL underneath the component, which is
// how back/forward and shared links arrive.
let params = new URLSearchParams();
let pathname = "/projects";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => pathname,
  useSearchParams: () => params,
}));

// The debounce lives in a real timer, and startTransition needs a React
// commit to flip isPending, so time only advances inside act().
async function settle(ms = 300) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function setupUser() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

describe("SearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replace.mockClear();
    params = new URLSearchParams();
    pathname = "/projects";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const input = () => screen.getByRole("searchbox");

  it("labels the field for screen readers", () => {
    render(<SearchInput label="Search projects" />);

    expect(input()).toHaveAccessibleName("Search projects");
  });

  it("seeds the field from the q param already in the URL", () => {
    params = new URLSearchParams("q=alpha");

    render(<SearchInput />);

    expect(input()).toHaveValue("alpha");
  });

  it("does not navigate before the debounce elapses", async () => {
    const user = setupUser();
    render(<SearchInput />);

    await user.type(input(), "alpha");
    await settle(299);

    expect(replace).not.toHaveBeenCalled();
  });

  it("writes the query to the URL once the debounce elapses", async () => {
    const user = setupUser();
    render(<SearchInput />);

    await user.type(input(), "alpha");
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects?q=alpha", {
      scroll: false,
    });
  });

  it("collapses a burst of typing into a single navigation", async () => {
    const user = setupUser();
    render(<SearchInput />);

    await user.type(input(), "alpha");
    await settle();

    // The point of debouncing: one query, not one per keystroke.
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("keeps the trailing space while typing a second word", async () => {
    const user = setupUser();
    render(<SearchInput />);

    await user.type(input(), "alpha ");
    await settle();
    await user.type(input(), "beta");
    await settle();

    // The URL is trimmed but the visible field must not be, otherwise
    // "alpha beta" collapses to "alphabeta" while it is being typed.
    expect(input()).toHaveValue("alpha beta");
    expect(replace).toHaveBeenLastCalledWith("/projects?q=alpha+beta", {
      scroll: false,
    });
  });

  it("holds off until the query is long enough to be worth a round trip", async () => {
    const user = setupUser();
    render(<SearchInput />);

    await user.type(input(), "a");
    await settle();

    expect(replace).not.toHaveBeenCalled();
  });

  it("navigates to the bare path when the field is cleared", async () => {
    params = new URLSearchParams("q=alpha");
    const user = setupUser();
    render(<SearchInput />);

    await user.clear(input());
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects", { scroll: false });
  });

  it("preserves unrelated params already in the URL", async () => {
    params = new URLSearchParams("status=done");
    const user = setupUser();
    render(<SearchInput />);

    await user.type(input(), "alpha");
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects?status=done&q=alpha", {
      scroll: false,
    });
  });

  it("adopts a query that arrives from outside, as on back/forward", async () => {
    const { rerender } = render(<SearchInput />);

    params = new URLSearchParams("q=beta");
    rerender(<SearchInput />);

    expect(input()).toHaveValue("beta");
  });

  it("targets its own route rather than a hardcoded one", async () => {
    pathname = "/tasks";
    const user = setupUser();
    render(<SearchInput />);

    await user.type(input(), "alpha");
    await settle();

    expect(replace).toHaveBeenCalledWith("/tasks?q=alpha", { scroll: false });
  });

  it("drives the param name it is given", async () => {
    const user = setupUser();
    render(<SearchInput param="name" />);

    await user.type(input(), "alpha");
    await settle();

    expect(replace).toHaveBeenCalledWith("/projects?name=alpha", {
      scroll: false,
    });
  });
});
