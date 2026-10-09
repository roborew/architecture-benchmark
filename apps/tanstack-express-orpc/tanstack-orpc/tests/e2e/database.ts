// tests/e2e/database.ts
//
// Lifecycle for the e2e database.
//
// The browser suite runs against its OWN database —
// `architecture_tanstack_express_orpc_e2e` on the same Postgres server —
// created, migrated, seeded and dropped around the run. The developer's
// database (and the Express app's dev database) is never read or written.
//
// It is the same database the Express integration suite uses: both tiers
// assert against the same shared fixture rows, and the two suites run
// sequentially, so the name is shared deliberately.
//
// Self-contained on purpose: the spec directory is located by walking up to
// the repo root (the same way every app variant's db scripts do), so nothing
// here imports from the sibling express-orpc package.

import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";

import postgres from "postgres";

export const E2E_DATABASE = "architecture_tanstack_express_orpc_e2e";
export const E2E_API_PORT = 4200;
export const E2E_WEB_PORT = 3300;

// The shared, normative fixture (spec/snapshots/correctness), in
// foreign-key-safe insertion order.
const FIXTURE_PROFILE = "correctness";
const FIXTURE_TABLES = ["users", "projects", "tasks", "comments"] as const;

function findSpecRoot(): string {
	let directory = path.dirname(fileURLToPath(import.meta.url));

	for (;;) {
		if (existsSync(path.join(directory, "spec", "schema.sql"))) {
			return directory;
		}

		const parent = path.dirname(directory);
		if (parent === directory) {
			throw new Error("Could not locate the spec directory above this app");
		}
		directory = parent;
	}
}

const specDirectory = path.join(findSpecRoot(), "spec");
const schemaPath = path.join(specDirectory, "schema.sql");
const fixtureDirectory = path.join(specDirectory, "snapshots", FIXTURE_PROFILE);

/**
 * Connection string for the e2e database.
 *
 * Derived from the Express app's `POSTGRES_URL` (its `.env`) by swapping only
 * the database name, so host and credentials come from the one place the
 * backend already reads them.
 */
export function e2eConnectionString(): string {
	const envPath = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../../express-orpc/.env",
	);

	if (!process.env.POSTGRES_URL && existsSync(envPath)) {
		process.loadEnvFile(envPath);
	}

	const base = process.env.POSTGRES_URL;

	if (!base) {
		throw new Error(
			"Missing POSTGRES_URL: set it in express-orpc/.env so the e2e database can be created.",
		);
	}

	const url = new NodeURL(base);
	url.pathname = `/${E2E_DATABASE}`;

	return url.toString();
}

/** Connection string for the maintenance database, used to CREATE/DROP DATABASE. */
function adminConnectionString(): string {
	const url = new NodeURL(e2eConnectionString());
	url.pathname = "/postgres";

	return url.toString();
}

/**
 * Drop and recreate the e2e database, then apply the schema.
 *
 * DROP rather than TRUNCATE so a previous run's schema can never leak through.
 * `FORCE` also terminates stragglers if a previous dev server is still
 * connected.
 */
export async function resetDatabase(): Promise<void> {
	const admin = postgres(adminConnectionString(), { ssl: false });

	try {
		await admin.unsafe(`
      drop database if exists ${E2E_DATABASE} with (force)
    `);
		await admin.unsafe(`create database ${E2E_DATABASE}`);
	} finally {
		await admin.end();
	}

	const sql = postgres(e2eConnectionString(), { ssl: false });

	try {
		await sql.file(schemaPath);
	} finally {
		await sql.end();
	}
}

/** Load the shared fixture into the e2e database. */
export async function seedDatabase(): Promise<void> {
	const sql = postgres(e2eConnectionString(), { ssl: false });

	try {
		// `COPY ... FROM STDIN` streams the fixture CSVs straight in — the same
		// path `express-orpc/src/db/seed.ts` uses, so the two seeders cannot
		// diverge in behaviour.
		await sql.begin(async (tx) => {
			for (const table of FIXTURE_TABLES) {
				const writable =
					await tx`copy ${tx(table)} from stdin with (format csv, header true)`.writable();
				await pipeline(
					createReadStream(path.join(fixtureDirectory, `${table}.csv`)),
					writable,
				);
			}

			// The fixture carries explicit ids, which bypass the identity sequences.
			// Advance them past the loaded rows or the next live insert collides.
			for (const table of FIXTURE_TABLES) {
				await tx`select setval(pg_get_serial_sequence(${table}, 'id'), coalesce((select max(id) from ${tx(table)}), 1))`;
			}
		});
	} finally {
		await sql.end();
	}
}

/** Remove the e2e database entirely. Best-effort: never fails the run. */
export async function dropDatabase(): Promise<void> {
	const admin = postgres(adminConnectionString(), { ssl: false });

	try {
		await admin.unsafe(`drop database if exists ${E2E_DATABASE} with (force)`);
	} catch (error) {
		console.warn(
			`[e2e] could not drop ${E2E_DATABASE}: ${
				error instanceof Error ? error.message : error
			}`,
		);
	} finally {
		await admin.end();
	}
}
