// src/lib/db.ts
//
// The SQL escape hatch, used by the test suites and by the schema/seed scripts.
//
// The application itself does not query through here: `src/lib/data.ts` and
// `src/lib/actions.ts` both go through Prisma. This module exists for the
// statements an ORM should not be asked to express — `DROP DATABASE`, `COPY`,
// applying `spec/schema.sql` verbatim, and the ad-hoc fixtures the integration
// tests build and tear down around each assertion.
//
// It is built on `pg`, the driver Prisma's own adapter uses, so the project has
// one Postgres client rather than two. When `pg`'s support for Postgres changes,
// the application's behaviour changes with it.
//
// The surface deliberately mirrors the tagged-template style the tests were
// written against:
//
//     const [row] = await sql<{ count: number }[]>`SELECT COUNT(*) FROM tasks`;
//     await sql.begin(async (tx) => { await tx`...`; });
//     await sql.end();
//
// `pg` is a callback/promise API rather than a tagged template, so `sql` is a
// small adapter: it interpolates values as bind parameters ($1, $2, …) and
// routes raw identifiers through `sql.identifier()`.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

// `pg` returns BIGINT (int8) and NUMERIC as strings to avoid precision loss.
// Every count in this schema fits comfortably in a JS number, and the tests
// compare against plain numbers, so parse them here rather than making each
// caller remember.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

// Resolves the connection string when the pool is first needed, not at import.
//
// Import order decides which database this module talks to. The Vitest
// integration suite points this process at the `_e2e` database from a
// `setupFiles` entry, which runs before any test module is imported — but a
// module that merely *references* `sql` can still be hoisted and evaluated
// earlier than that. Reading the environment at import time therefore froze
// whatever was set then, and the suite's own `sql` ended up on the developer's
// database while Prisma (which resolves per client) sat on `_e2e`. The two
// layers then disagreed about which rows existed.
//
// Resolving lazily means the first query is what matters, by which time the
// setup file has run. A real `pg` pool also opens its connections lazily, so
// nothing is dialled before then either.
function resolveConnectionString(): string {
  // Next.js loads `.env` automatically, but standalone scripts (migrate, seed)
  // and the integration suite's setupFiles entry do not. Load it here for the
  // same reason `prisma.ts` does, so both query layers resolve the same
  // connection string from the same place — and so they agree on which
  // database, which is what the integration suite depends on.
  const envPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".env",
  );

  if (existsSync(envPath) && !process.env.POSTGRES_URL) {
    process.loadEnvFile(envPath);
  }

  const connectionString = process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error(
      "Missing database connection string: set POSTGRES_URL in .env",
    );
  }

  return connectionString;
}

/**
 * Drops the Prisma-only `?schema=public` from the connection string.
 *
 * Prisma requires the `schema` parameter and this project shares its
 * connection string with `prisma.ts`. `pg` has no such concept and, left alone,
 * would pass the unknown parameter through to the server as a startup GUC,
 * which Postgres rejects with
 * `unrecognized configuration parameter "schema"` (42704). The schema is
 * `public` either way, so removing the parameter changes nothing about which
 * rows are reachable — it only stops the connection being refused.
 */
function withoutSchemaParam(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete("schema");

  return url.toString();
}

/** A value that is spliced into the statement verbatim, never bound. */
export type RawSql = { readonly __raw: string };

/** Quotes an identifier so a table name can be interpolated safely. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};

/**
 * Turns a tagged template into a `pg` call.
 *
 * Interpolated values become bind parameters. A `RawSql` is inlined as-is —
 * that is how `sql.identifier(...)` reaches the statement without being quoted
 * as a literal.
 *
 * Arrays are expanded into `ARRAY[…]` rather than bound as a single value,
 * which is what the suites rely on when they write `${ids}::bigint[]`.
 * `postgres.js` did this implicitly; a JS array handed straight to `pg` would
 * otherwise become one opaque parameter and fail the cast.
 *
 * `ARRAY[…]` specifically, not `(…)`: a parenthesised comma list is a *record*
 * in Postgres, and `($1,$2)::bigint[]` fails with "cannot cast type record to
 * bigint[]". Emitting `ARRAY[…]` also leaves the surrounding text free to append
 * its own cast, which is exactly the shape those assertions use. Each element is
 * still bound, so no value is concatenated into the statement. An empty array
 * becomes `ARRAY[]::bigint[]`-compatible empty, matching `= ANY(ARRAY[])` —
 * false for every row, i.e. "nothing is in the set", which is what diffing
 * against no previous ids means.
 */
function buildQuery(
  runnable: Queryable,
  strings: TemplateStringsArray,
  values: unknown[],
): Promise<unknown[]> {
  let index = 0;
  const parameters: unknown[] = [];

  const text = strings.reduce((acc, part, position) => {
    if (position === strings.length - 1) return acc + part;

    const value = values[index++];

    if (isRawSql(value)) return acc + part + value.__raw;

    if (Array.isArray(value)) {
      if (value.length === 0) return `${acc}${part}ARRAY[]`;

      const slots = value.map((element) => {
        parameters.push(element);
        return `$${parameters.length}`;
      });

      return `${acc}${part}ARRAY[${slots.join(", ")}]`;
    }

    parameters.push(value);
    return `${acc}${part}$${parameters.length}`;
  }, "");

  return runnable.query(text, parameters).then((result) => result.rows);
}

function isRawSql(value: unknown): value is RawSql {
  return (
    typeof value === "object" &&
    value !== null &&
    "__raw" in value &&
    typeof (value as RawSql).__raw === "string"
  );
}

export type QueryFn = {
  /**
   * Runs a statement; resolves to its rows.
   *
   * The type parameter is the *row* type — the suites write
   * `sql<{ id: number }[]>` — so it is spread into the resolved array.
   */
  <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  /** Runs raw SQL with no bind parameters — used for multi-statement scripts. */
  unsafe(text: string): Promise<unknown[]>;
  /** Applies a .sql file verbatim, e.g. the normative `spec/schema.sql`. */
  file(filePath: string): Promise<unknown[]>;
  /** Runs `fn` inside a transaction, committing on return and rolling back on throw. */
  begin<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T>;
  /**
   * Runs a statement with explicit bind parameters, resolving to `{ rows }`.
   *
   * Needed where the shape of the statement is built at runtime — a multi-row
   * INSERT with a column list per row, say — and so cannot be a fixed template.
   */
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  /** Identifies a table/column name for interpolation (quoted, never bound). */
  identifier(name: string | readonly string[]): RawSql;
  /** Closes the pool. Safe to call more than once. */
  end(): Promise<void>;
};

export type TransactionSql = {
  /**
   * Runs a statement; resolves to its rows.
   *
   * As on `QueryFn`, the type parameter is the row type, so it is spread into
   * the resolved array.
   */
  <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  /**
   * Runs a statement with explicit bind parameters.
   *
   * Needed where the *shape* of the statement is built at runtime — a
   * multi-row INSERT with a column list per row, for instance — and so cannot
   * be written as a fixed template. Values are still bound, never concatenated.
   */
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  /** Identifies a table/column name for interpolation (quoted, never bound). */
  identifier(name: string | readonly string[]): RawSql;
  /** Applies a .sql file verbatim, e.g. the normative `spec/schema.sql`. */
  file(filePath: string): Promise<unknown[]>;
};

function asQueryFn(runnable: Queryable): TransactionSql {
  const tagged = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    buildQuery(runnable, strings, values)) as TransactionSql;

  tagged.query = (text: string, values?: unknown[]) =>
    runnable.query(text, values);

  tagged.file = (filePath: string) =>
    runnable.query(readFileSync(filePath, "utf8")).then((r) => r.rows);

  tagged.identifier = (name: string | readonly string[]) => {
    const names = Array.isArray(name) ? name : [name as string];
    return { __raw: names.map(quoteIdentifier).join(", ") };
  };

  return tagged;
}

/**
 * The shared pool, created on first use.
 *
 * Lazy so the connection string is read after any `setupFiles` entry has had a
 * chance to repoint `POSTGRES_URL` at the e2e database (see
 * `resolveConnectionString`). Once built it is kept, so every statement in a
 * run shares one pool.
 */
let pool: pg.Pool | undefined;

function sharedPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: withoutSchemaParam(resolveConnectionString()),
    // `ssl: false` matches the local-development default this project uses.
    ssl: false,
    // `pg` parses timestamptz into a Date in the *server's* zone. Pinning the
    // session to UTC keeps a stored instant reading the same on every machine,
    // which is what `src/lib/prisma.ts` does for the application's own queries.
    options: "-c timezone=UTC",
  });

  return pool;
}

const query: QueryFn = Object.assign(
  ((strings: TemplateStringsArray, ...values: unknown[]) =>
    buildQuery(sharedPool(), strings, values)) as QueryFn,
  {
    unsafe: async (text: string) => (await sharedPool().query(text)).rows,
    file: (filePath: string) =>
      sharedPool()
        .query(readFileSync(filePath, "utf8"))
        .then((r) => r.rows),
    async begin<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
      const client = await sharedPool().connect();

      try {
        await client.query("BEGIN");
        const result = await fn(asQueryFn(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {
          // The connection may already be unusable; the original error is the
          // one worth surfacing.
        });
        throw error;
      } finally {
        client.release();
      }
    },
    identifier(name: string | readonly string[]) {
      const names = Array.isArray(name) ? name : [name as string];
      return { __raw: names.map(quoteIdentifier).join(", ") };
    },
    async end() {
      // Tolerates being called before anything ever queried, and more than
      // once — the suites call it from `afterAll` without tracking usage.
      await pool?.end();
      pool = undefined;
    },
  },
);

export const sql = query;

/**
 * Builds an independent client against a different database on the same server.
 *
 * The test harness needs this: it creates and drops the `_e2e` database and
 * connects to the `postgres` maintenance database, neither of which is the
 * database `sql` above is bound to. Sharing the implementation (rather than
 * reaching for a second driver) keeps one connection string normaliser, one
 * timezone setting and one identifier-escaping rule in the project.
 *
 * The caller owns the returned client and must call `end()` on it.
 */
export function createClient(connectionString: string): QueryFn {
  const ownPool = new pg.Pool({
    connectionString: withoutSchemaParam(connectionString),
    ssl: false,
    options: "-c timezone=UTC",
  });

  return Object.assign(
    ((strings: TemplateStringsArray, ...values: unknown[]) =>
      buildQuery(ownPool, strings, values)) as QueryFn,
    {
      unsafe: async (text: string) => (await ownPool.query(text)).rows,
      file: (filePath: string) =>
        ownPool.query(readFileSync(filePath, "utf8")).then((r) => r.rows),
      async begin<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
        const client = await ownPool.connect();

        try {
          await client.query("BEGIN");
          const result = await fn(asQueryFn(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {
            // The connection may already be unusable; the original error is the
            // one worth surfacing.
          });
          throw error;
        } finally {
          client.release();
        }
      },
      identifier(name: string | readonly string[]) {
        const names = Array.isArray(name) ? name : [name as string];
        return { __raw: names.map(quoteIdentifier).join(", ") };
      },
      async end() {
        await ownPool.end();
      },
    },
  );
}
