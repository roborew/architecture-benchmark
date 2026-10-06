import type { User } from "@/lib/types";

// Deterministic fixtures for unit tests.
//
// The sentinel ids and names are deliberately unlike the seed data. A test
// that accidentally depends on real seed values should fail loudly rather
// than quietly pass, which is what happens if these mirror the seed rows.
//
// Unit tests assert against the values they pass in, never against literals.

export function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 9201,
		name: "Fixture Person",
		email: "fixture@example.test",
		assignedTaskCount: 1,
		openTaskCount: 1,
		commentCount: 0,
		...overrides,
	};
}
