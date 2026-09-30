import postgres from "postgres";

const connectionString = process.env.POSTGRES_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "Missing database connection string: set POSTGRES_URL (or POSTGRES_URL) in .env",
  );
}

export const sql = postgres(connectionString, { ssl: false });
