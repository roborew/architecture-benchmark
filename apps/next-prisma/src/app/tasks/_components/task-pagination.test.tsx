import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TaskPagination } from "./task-pagination";
import { PAGE_SIZES } from "@/lib/pagination";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  push.mockClear();
});

describe("TaskPagination", () => {
  const defaults = {
    hasNewer: false,
    hasOlder: true,
    firstHref: "/tasks",
    nextHref: "/tasks?cursor=abc",
    size: 10,
  };

  it("disables Previous on the first page", () => {
    render(<TaskPagination {...defaults} />);

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("disables Next when the page came back short", () => {
    render(<TaskPagination {...defaults} hasOlder={false} />);

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("navigates to the cursor carried by the next page", async () => {
    const user = userEvent.setup();
    render(<TaskPagination {...defaults} />);

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(push).toHaveBeenCalledWith("/tasks?cursor=abc");
  });

  it("navigates back to the first page", async () => {
    const user = userEvent.setup();
    render(
      <TaskPagination {...defaults} hasNewer firstHref="/tasks?status=todo" />,
    );

    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(push).toHaveBeenCalledWith("/tasks?status=todo");
  });

  it("offers 10 tasks a page", () => {
    render(<TaskPagination {...defaults} />);

    const select = screen.getByRole("combobox", { name: "Tasks per page" });

    expect(
      within(select).getByRole("option", { name: "10" }),
    ).toBeInTheDocument();
  });

  it("offers every supported page size", () => {
    render(<TaskPagination {...defaults} />);

    const select = screen.getByRole("combobox", { name: "Tasks per page" });

    for (const size of PAGE_SIZES) {
      expect(within(select).getByRole("option", { name: String(size) })).toBeInTheDocument();
    }
  });

  it("shows the page size currently applied", () => {
    render(<TaskPagination {...defaults} size={25} />);

    expect(screen.getByRole("combobox", { name: "Tasks per page" })).toHaveValue(
      "25",
    );
  });

  it("navigates when a new page size is chosen", async () => {
    const user = userEvent.setup();
    render(<TaskPagination {...defaults} firstHref="/tasks?status=todo" />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Tasks per page" }),
      "25",
    );

    // Changing the size invalidates the cursor, so it goes back to the first
    // page of the same filters.
    expect(push).toHaveBeenCalledWith("/tasks?status=todo&size=25");
  });
});
