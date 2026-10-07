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

export function tasksCountLabel(count: number) {
	return `${count} task${count === 1 ? "" : "s"}`;
}
