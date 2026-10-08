// E2E specs assert against real rendered data, so unlike the unit tests they
// need concrete values from the shared fixture. They live here, in one place,
// so a fixture change is a one-file edit rather than a spec rewrite.

export const E2E_FIXTURE = {
	person: {
		name: "Robin Andrew",
		email: "robin@example.test",
		href: "/users/1",
	},
	people: {
		sam: "Sam Taylor",
		robin: "Robin Andrew",
		alex: "Alex Morgan",
	},
	task: {
		title: "Draft navigation model",
		href: "/tasks/101",
		projectName: "Website redesign",
	},
	tasks: {
		// The task directly below the fixture's newest in the workspace-wide
		// order (updated_at DESC, id DESC): 101, 102, 105, 103, 104, 106.
		nextByUpdate: "Confirm breakpoint rules",
	},
	counts: {
		people: 3,
		tasks: 6,
	},
} as const;

export function peopleCountLabel(count: number) {
	return `${count} people`;
}

/**
 * The tasks page's summary line (lib/pagination.ts `formatRange`) for a result
 * set that fits a single page: the fixture's task totals are all below the
 * default page size, so the first page spans the whole set, `to` equals the
 * total, and `from` is always 1.
 */
export function tasksSummaryLabel(
	total: number,
	{ filtered = false }: { filtered?: boolean } = {},
) {
	const noun = total === 1 ? "task" : "tasks";

	return (
		`Showing 1-${total} of ${total} ${noun}` +
		(filtered ? " matching your filters" : "")
	);
}
