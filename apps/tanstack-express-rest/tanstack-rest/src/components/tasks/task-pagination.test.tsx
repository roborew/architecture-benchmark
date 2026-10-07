import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import userEvent from "@testing-library/user-event";

import { TaskPagination } from "./task-pagination";
import { PAGE_SIZES } from "@/lib/pagination";

const navigate = vi.fn();

// Only useRouter is stubbed; the rest of TanStack's module stays real, because
// the rendered tree still uses its exports.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();

  return {
    ...actual,
    useRouter: () => ({ navigate }),
  };
});

beforeEach(() => {
  navigate.mockClear();
});

describe("TaskPagination", () => {
  const defaults = {
    hasNewer: false,
    hasOlder: true,
    firstSearch: {},
    nextSearch: { cursor: "abc" },
    size: 10,
  };

  it("disables Previous on the first page", () => {
    renderWithRouter(<TaskPagination {...defaults} />);

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("disables Next when the page came back short", () => {
    renderWithRouter(<TaskPagination {...defaults} hasOlder={false} />);

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("navigates to the cursor carried by the next page", async () => {
    const user = userEvent.setup();
    renderWithRouter(<TaskPagination {...defaults} />);

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/tasks",
      search: { cursor: "abc" },
      resetScroll: false,
    });
  });

  it("navigates back to the first page", async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <TaskPagination
        {...defaults}
        hasNewer
        firstSearch={{ status: "todo" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/tasks",
      search: { status: "todo" },
      resetScroll: false,
    });
  });

  it("offers 10 tasks a page", () => {
    renderWithRouter(<TaskPagination {...defaults} />);

    const select = screen.getByRole("combobox", { name: "Tasks per page" });

    expect(
      within(select).getByRole("option", { name: "10" }),
    ).toBeInTheDocument();
  });

  it("offers every supported page size", () => {
    renderWithRouter(<TaskPagination {...defaults} />);

    const select = screen.getByRole("combobox", { name: "Tasks per page" });

    for (const size of PAGE_SIZES) {
      expect(
        within(select).getByRole("option", { name: String(size) }),
      ).toBeInTheDocument();
    }
  });

  it("shows the page size currently applied", () => {
    renderWithRouter(<TaskPagination {...defaults} size={25} />);

    expect(
      screen.getByRole("combobox", { name: "Tasks per page" }),
    ).toHaveValue("25");
  });

  it("navigates when a new page size is chosen", async () => {
    const user = userEvent.setup();
    // The control reads the filters it preserves from the live URL rather than
    // from `firstSearch`, so the router is started at a URL that carries them.
    renderWithRouter(
      <TaskPagination {...defaults} firstSearch={{ status: "todo" }} />,
      { route: "/tasks?status=todo" },
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Tasks per page" }),
      "25",
    );

    // Changing the size invalidates the cursor, so it goes back to the first
    // page of the same filters — and any page/cursor already in the URL is
    // dropped rather than carried into a result set it no longer matches.
    expect(navigate).toHaveBeenCalledWith({
      to: "/tasks",
      search: { status: "todo", size: "25" },
      resetScroll: false,
    });
  });

  it("drops the cursor when the page size changes", async () => {
    const user = userEvent.setup();
    renderWithRouter(<TaskPagination {...defaults} />, {
      route: "/tasks?status=todo&page=3&cursor=abc",
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Tasks per page" }),
      "5",
    );

    const call = (navigate as ReturnType<typeof vi.fn>).mock.calls.at(
      -1,
    )?.[0] as { search: Record<string, string> } | undefined;

    expect(call?.search).not.toHaveProperty("cursor");
    expect(call?.search).not.toHaveProperty("page");
    expect(call?.search).toMatchObject({ status: "todo", size: "5" });
  });
});
