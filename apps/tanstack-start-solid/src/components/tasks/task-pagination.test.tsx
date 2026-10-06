import userEvent from "@testing-library/user-event";
import { renderWithRouter, screen, within } from "@tests/helpers/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZES } from "@/lib/pagination";
import { TaskPagination } from "./task-pagination";

const navigate = vi.fn();
const mockSearchStr = { current: "" };

vi.mock("@tanstack/solid-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/solid-router")>();

	return {
		...actual,
		useRouter: () => ({ navigate }),
		useLocation: () => () => ({
			pathname: "/tasks",
			searchStr: mockSearchStr.current,
		}),
	};
});

beforeEach(() => {
	navigate.mockClear();
	mockSearchStr.current = "";
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
		renderWithRouter(() => <TaskPagination {...defaults} />);

		expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
	});

	it("disables Next when the page came back short", () => {
		renderWithRouter(() => <TaskPagination {...defaults} hasOlder={false} />);

		expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
	});

	it("navigates to the cursor carried by the next page", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => <TaskPagination {...defaults} />);

		await user.click(screen.getByRole("button", { name: "Next" }));

		expect(navigate).toHaveBeenCalledWith({
			to: "/tasks",
			search: { cursor: "abc" },
			resetScroll: false,
		});
	});

	it("navigates back to the first page", async () => {
		const user = userEvent.setup();
		renderWithRouter(() => (
			<TaskPagination {...defaults} hasNewer firstSearch={{ status: "todo" }} />
		));

		await user.click(screen.getByRole("button", { name: "Previous" }));

		expect(navigate).toHaveBeenCalledWith({
			to: "/tasks",
			search: { status: "todo" },
			resetScroll: false,
		});
	});

	it("offers 10 tasks a page", () => {
		renderWithRouter(() => <TaskPagination {...defaults} />);

		const select = screen.getByRole("combobox", { name: "Tasks per page" });

		expect(
			within(select).getByRole("option", { name: "10" }),
		).toBeInTheDocument();
	});

	it("offers every supported page size", () => {
		renderWithRouter(() => <TaskPagination {...defaults} />);

		const select = screen.getByRole("combobox", { name: "Tasks per page" });

		for (const size of PAGE_SIZES) {
			expect(
				within(select).getByRole("option", { name: String(size) }),
			).toBeInTheDocument();
		}
	});

	it("shows the page size currently applied", () => {
		renderWithRouter(() => <TaskPagination {...defaults} size={25} />);

		expect(
			screen.getByRole("combobox", { name: "Tasks per page" }),
		).toHaveValue("25");
	});

	it("navigates when a new page size is chosen", async () => {
		mockSearchStr.current = "?status=todo";
		const user = userEvent.setup();
		renderWithRouter(
			() => <TaskPagination {...defaults} firstSearch={{ status: "todo" }} />,
			{ route: "/tasks?status=todo" },
		);

		await user.selectOptions(
			screen.getByRole("combobox", { name: "Tasks per page" }),
			"25",
		);

		expect(navigate).toHaveBeenCalledWith({
			to: "/tasks",
			search: { status: "todo", size: "25" },
			resetScroll: false,
		});
	});

	it("drops the cursor when the page size changes", async () => {
		mockSearchStr.current = "?status=todo&page=3&cursor=abc";
		const user = userEvent.setup();
		renderWithRouter(() => <TaskPagination {...defaults} />, {
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
