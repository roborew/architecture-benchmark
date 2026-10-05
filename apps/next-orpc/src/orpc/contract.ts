// The users contract: what the transport promises, with no implementation in it.
//
// This is the v2 shape and it is the reason oRPC's contract-first style is worth
// the extra file. src/trpc/routers/users.ts could not declare its output: a
// tRPC router infers everything from its handlers, so the response type is only
// visible to TypeScript, never to the wire. An `oc` contract is separate from
// the handler and every `.output()` is both
//
//   * the schema the server validates its reply against at runtime, and
//   * the type the client sees.
//
// The `ActionResult` union is deliberately NOT an oRPC error. A blank name or a
// foreign key blocking a delete is ordinary user error that the form already
// renders, and `src/lib/result.ts` explains why that is a value rather than a
// thrown error. Declaring `.errors({ INVALID: ... })` here would push the same
// `{ fieldName: string[] }` back through the error channel and force the form to
// re-derive it. See that file before "fixing" this.
//
// `.meta(openapi(...))` is v2's replacement for the removed `.route` / `.prefix`
// builder methods. The RPC path is derived from the router shape, so the OpenAPI
// path is metadata on top of it rather than the only routing story.

import { openapi } from "@orpc/openapi";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** Mirrors `User` in src/lib/types.ts, which the SQL in lib/data.ts selects. */
const UserSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  assignedTaskCount: z.number().int(),
  openTaskCount: z.number().int(),
  commentCount: z.number().int(),
});

/** Mirrors `TaskStatus`. A bare string here would let a typo reach the badge. */
const TaskStatusSchema = z.enum(["todo", "in progress", "done"]);

/**
 * Mirrors `TaskWithProject` — the row `users.tasks` returns.
 *
 * `assigneeId` is nullable because a task may be unassigned; `updatedAt` is a
 * string because lib/data.ts already stringifies timestamps so plain JSON
 * round-trips every value.
 */
const UserTaskSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  projectName: z.string(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  assigneeId: z.number().int().nullable(),
  assigneeName: z.string(),
  commentCount: z.number().int(),
  updatedAt: z.string(),
});

/**
 * Mirrors `FieldErrors` in src/lib/result.ts, which is
 * `Record<string, string[] | undefined>` — the shape `zod`'s
 * `.flatten().fieldErrors` produces.
 *
 * The `.optional()` on the value is load-bearing, not defensive. zod's flattened
 * fieldErrors include keys whose value is `undefined`, so a stricter schema
 * (`Record<string, string[]>`) makes every write's output fail validation at
 * runtime and rejects the whole union at compile time against `ActionResult`.
 */
const FieldErrorsSchema = z.record(z.string(), z.array(z.string()).optional());

/**
 * Mirrors `ActionResult` in src/lib/result.ts.
 *
 * `.nullable()` rather than `.optional()` because data.ts may return an object
 * with the key present and undefined; this asserts what crosses the wire.
 */
const ActionResultSchema = z.union([
  z.object({ ok: z.literal(true), id: z.number().int() }),
  z.object({
    ok: z.literal(false),
    errors: FieldErrorsSchema.optional(),
    message: z.string().optional(),
  }),
]);

export const usersContract = {
  list: oc
    .meta(openapi({ method: "GET", path: "/users", summary: "List people" }))
    // Optional search, matching `getUsers`' own default of no term.
    .input(z.object({ search: z.string().optional() }).optional())
    .output(z.array(UserSchema)),

  byId: oc
    .meta(
      openapi({ method: "GET", path: "/users/{id}", summary: "One person" }),
    )
    .input(z.object({ id: z.number().int() }))
    // `null` when no row matches, which is a successful read of a missing row.
    .output(UserSchema.nullable()),

  /** The tasks assigned to one member, scoped by assignee_id rather than name. */
  tasks: oc
    .meta(
      openapi({
        method: "GET",
        path: "/users/{id}/tasks",
        summary: "Tasks assigned to a person",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(z.array(UserTaskSchema)),

  // Value validation of name/email is NOT here: a blank name is user error that
  // the form renders, so it is checked inside data.ts and returns
  // `{ ok: false, errors }`. This `.input()` only checks the SHAPE the caller
  // was supposed to send — the same division of labour src/trpc/routers/users.ts
  // documented.
  create: oc
    .meta(
      openapi({ method: "POST", path: "/users", summary: "Create a person" }),
    )
    .input(z.object({ name: z.string(), email: z.string() }))
    .output(ActionResultSchema),

  update: oc
    .meta(
      openapi({
        method: "PUT",
        path: "/users/{id}",
        summary: "Update a person",
      }),
    )
    .input(
      z.object({ id: z.number().int(), name: z.string(), email: z.string() }),
    )
    .output(ActionResultSchema),

  delete: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/users/{id}",
        summary: "Delete a person",
      }),
    )
    .input(z.object({ id: z.number().int() }))
    .output(ActionResultSchema),
};
