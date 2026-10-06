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
	counts: {
		people: 3,
	},
} as const;

export function peopleCountLabel(count: number) {
	return `${count} people`;
}
