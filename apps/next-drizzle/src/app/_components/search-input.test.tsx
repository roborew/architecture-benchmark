import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SearchInput } from "./search-input";

// Mutable so a test can change the URL underneath the component, which is
// how back/forward and shared links arrive. vi.hoisted is required: the
// mock factory is lifted above these declarations, so it would otherwise
// close over them before initialisation.
//
// `router` is a single object created once, and `replace` is the same `vi.fn`
// the assertions use. That is load-bearing: `SearchInput` lists `router` in a
// useEffect dependency array, so a mock returning `{ replace: mocks.replace }`
// inline hands back a *new* identity on every render. The effect then re-runs
// after every commit, calls startTransition — which guarantees another render —
// and builds another router object, forever. The effect's
// `query === urlQuery` guard cannot break the cycle, because the mocked
// `replace` is a no-op that never updates the mocked search params, so
// `urlQuery` stays "" and the guard never fires.
//
// Under fake timers the loop never yields to the event loop, so the worker
// pinned V8 in garbage collection until it was SIGABRT'd — which is why the
// whole file reported nothing rather than timing out, and why the
// "collapses a burst of typing into a single navigation" assertion could never
// have passed.
const mocks = vi.hoisted(() => {
  const replace = vi.fn();

  return {
    replace,
    router: { replace },
    params: new URLSearchParams(),
    pathname: "/projects",
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.params,
}));

// The debounce lives in a real timer, and startTransition needs a React
// commit to flip isPending, so time only advances inside act().
async function settle(ms = 300) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

// fireEvent rather than userEvent: userEvent awaits its own inter-key
// delays, which never resolve under fake timers, so every awaited call
// hangs until the test times out. Typing is simulated directly instead.
function type(text: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });
}

describe("SearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.replace.mockClear();
    mocks.params = new URLSearchParams();
    mocks.pathname = "/projects";
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
    mocks.params = new URLSearchParams("q=alpha");

    render(<SearchInput />);

    expect(input()).toHaveValue("alpha");
  });

  it("does not navigate before the debounce elapses", async () => {
    render(<SearchInput />);

    type("alpha");
    await settle(299);

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("writes the query to the URL once the debounce elapses", async () => {
    render(<SearchInput />);

    type("alpha");
    await settle();

    expect(mocks.replace).toHaveBeenCalledWith("/projects?q=alpha", {
      scroll: false,
    });
  });

  it("collapses a burst of typing into a single navigation", async () => {
    render(<SearchInput />);

    // Each keystroke restarts the timer; only the final value survives.
    type("a");
    await settle(100);
    type("al");
    await settle(100);
    type("alpha");
    await settle();

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/projects?q=alpha", {
      scroll: false,
    });
  });

  it("keeps the trailing space while typing a second word", async () => {
    render(<SearchInput />);

    type("alpha ");
    await settle();
    type("alpha beta");
    await settle();

    // The URL is trimmed but the visible field must not be, otherwise
    // "alpha beta" collapses to "alphabeta" while it is being typed.
    expect(input()).toHaveValue("alpha beta");
    expect(mocks.replace).toHaveBeenLastCalledWith("/projects?q=alpha+beta", {
      scroll: false,
    });
  });

  it("holds off until the query is long enough to be worth a round trip", async () => {
    render(<SearchInput />);

    type("a");
    await settle();

    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("navigates to the bare path when the field is cleared", async () => {
    mocks.params = new URLSearchParams("q=alpha");
    render(<SearchInput />);

    type("");
    await settle();

    expect(mocks.replace).toHaveBeenCalledWith("/projects", { scroll: false });
  });

  it("preserves unrelated params already in the URL", async () => {
    mocks.params = new URLSearchParams("status=done");
    render(<SearchInput />);

    type("alpha");
    await settle();

    expect(mocks.replace).toHaveBeenCalledWith(
      "/projects?status=done&q=alpha",
      { scroll: false },
    );
  });

  it("adopts a query that arrives from outside, as on back/forward", () => {
    const { rerender } = render(<SearchInput />);

    mocks.params = new URLSearchParams("q=beta");
    rerender(<SearchInput />);

    expect(input()).toHaveValue("beta");
  });

  it("does not clobber typing when its own navigation echoes back", async () => {
    const { rerender } = render(<SearchInput />);

    type("alpha");
    await settle();

    // The router settles the URL with the trimmed value we sent.
    mocks.params = new URLSearchParams("q=alpha");
    rerender(<SearchInput />);

    expect(input()).toHaveValue("alpha");
  });

  it("targets its own route rather than a hardcoded one", async () => {
    mocks.pathname = "/tasks";
    render(<SearchInput />);

    type("alpha");
    await settle();

    expect(mocks.replace).toHaveBeenCalledWith("/tasks?q=alpha", {
      scroll: false,
    });
  });

  it("drives the param name it is given", async () => {
    render(<SearchInput param="name" />);

    type("alpha");
    await settle();

    expect(mocks.replace).toHaveBeenCalledWith("/projects?name=alpha", {
      scroll: false,
    });
  });
});
