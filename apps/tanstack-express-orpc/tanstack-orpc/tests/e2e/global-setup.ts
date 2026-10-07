// Runs once before the suite: creates the isolated e2e database, applies the
// schema, and loads the shared fixture. The developer's database is untouched.

import {
	E2E_DATABASE,
	e2eConnectionString,
	resetDatabase,
	seedDatabase,
} from "./database";

export default async function globalSetup() {
	const connectionString = e2eConnectionString();

	console.log(`[e2e] resetting ${E2E_DATABASE}`);
	await resetDatabase();
	await seedDatabase();

	console.log(
		`[e2e] seeded ${E2E_DATABASE} from spec/snapshots/correctness (${connectionString})`,
	);
}
