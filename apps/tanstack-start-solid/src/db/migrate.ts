// src/db/migrate.ts

import { sql } from "@/lib/db";

import { schemaPath } from "./spec-dir";

try {
	await sql.begin(async (tx) => {
		await tx.file(schemaPath);
	});
	console.log("Schema applied successfully");
} finally {
	await sql.end();
}
