// tests/e2e/query.ts
//
// The `pg` (node-postgres) handle the integration tests use for their own setup
// and assertions.
//
// Deliberately separate from the app's `db`: these tests need to write rows the
// app would never write (a member with no tasks, two members sharing a name)
// and to assert on raw table state. That is test scaffolding, not query-layer
// behaviour, so it does not belong in `src/`.
//
// It keeps the tagged-template shape the suites were written against. That is
// ergonomics, not a second driver: everything below ends in `pg`'s `Client`.

import { Client, escapeIdentifier, type QueryResultRow } from "pg";

import { connectionString } from "@/lib/connection";

let client: Client | undefined;
let connecting: Promise<Client> | undefined;

/**
 * The connected client, created once.
 *
 * `pg` does not connect implicitly the way postgres.js did, so `connect()` is
 * awaited explicitly. The *promise* is cached rather than the client inspected
 * with `client.active`: that flag drops to false whenever the socket sits idle
 * between statements, and re-connecting an already-connected Client throws
 * "Client has already been connected".
 */
async function db(): Promise<Client> {
  connecting ??= (async () => {
    client = new Client({ connectionString });

    await client.connect();

    return client;
  })();

  try {
    return await connecting;
  } catch (error) {
    // A failed handshake must not poison every later query in the file.
    connecting = undefined;
    client = undefined;

    throw error;
  }
}

/** A sentinel so an escaped identifier can never be mistaken for a bound value. */
const IDENTIFIER = Symbol("identifier");

/** Marks a table or column name for splicing into the statement. */
export interface Identifier {
  readonly [IDENTIFIER]: string;
}

/**
 * Marks an identifier rather than a value.
 *
 * Identifiers cannot be bind parameters in Postgres, so a name has to be
 * spliced into the statement text — the one place injection could happen.
 * Requiring a deliberate call is what keeps it safe, and it cannot be inferred
 * from the value's type: these suites write `WHERE display_name = ${name}`
 * dozens of times, and treating that string as an identifier would quote it
 * into a column reference.
 */
export function identifier(name: string): Identifier {
  return { [IDENTIFIER]: name };
}

/** An interpolated expression expanded into SQL text plus bind parameters. */
type Expansion = { text: string; values: unknown[] };

/**
 * Expands one interpolated expression: an `identifier()` is escaped into the
 * text, anything else is a bind parameter.
 */
function fragment(value: unknown, taken: number): Expansion {
  if (typeof value === "object" && value !== null && IDENTIFIER in value) {
    return {
      text: escapeIdentifier((value as Identifier)[IDENTIFIER]),
      values: [],
    };
  }

  return { text: `$${taken + 1}`, values: [value] };
}

/**
 * Joins a template into one statement and its parameter array.
 *
 * Bind numbering is not per-chunk: an identifier consumes no placeholder, so the
 * counter is carried across the whole statement to keep placeholders in step
 * with values. `params.length` is that counter.
 */
function buildQuery(
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; params: unknown[] } {
  let text = strings[0];
  const params: unknown[] = [];

  strings.slice(1).forEach((chunk, position) => {
    const expanded = fragment(values[position], params.length);

    params.push(...expanded.values);
    text += expanded.text + chunk;
  });

  return { text, params };
}

type Runner = (text: string, params: unknown[]) => Promise<QueryResultRow[]>;

/** Unwraps `T[]` to `T`, leaving anything else alone. */
type ArrayElement<T> = T extends readonly (infer Element)[] ? Element : T;

function makeQuery(run: Runner) {
  return async <Row = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<ArrayElement<Row>[]> => {
    const { text, params } = buildQuery(strings, values);

    return (await run(text, params)) as ArrayElement<Row>[];
  };
}

/**
 * The generic names the *row* type, as it did with postgres.js:
 * `sql<{ id: number }[]>` asks for rows shaped like `{ id: number }`. The
 * `ArrayElement` unwrap accepts both that and a bare `{ id: number }`, and is
 * left unconstrained so a test can name a row type that does not structurally
 * satisfy `QueryResultRow`.
 */
export interface TestQuery {
  <Row = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<ArrayElement<Row>[]>;

  /** Run `fn` in a transaction, rolling back if it throws. */
  begin<T>(fn: (tx: TestQuery) => Promise<T>): Promise<T>;

  /** Close the connection. Called from each file's `afterAll`. */
  end(): Promise<void>;
}

const runOnClient: Runner = async (text, params) => {
  const connection = await db();

  return (await connection.query(text, params)).rows;
};

export const sql: TestQuery = Object.assign(makeQuery(runOnClient), {
  async begin<T>(fn: (tx: TestQuery) => Promise<T>): Promise<T> {
    const connection = await db();

    await connection.query("BEGIN");

    // The transaction shares the client's one connection, so a statement
    // issued inside it is genuinely inside it — there is no second pool for it
    // to escape onto.
    const tx = makeQuery(runOnClient) as TestQuery;

    try {
      const result = await fn(tx);

      await connection.query("COMMIT");

      return result;
    } catch (error) {
      // Several tests use a transaction to reach a state — an empty workspace,
      // rows inserted then removed — and must not leave it behind.
      await connection.query("ROLLBACK").catch(() => {});

      throw error;
    }
  },

  async end(): Promise<void> {
    if (!client) return;

    const open = client;
    client = undefined;
    connecting = undefined;

    await open.end();
  },
});
