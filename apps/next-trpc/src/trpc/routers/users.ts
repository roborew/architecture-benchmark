// The users domain: reads wrapped from src/lib/data.ts, writes migrated from the
// createUser/updateUser/deleteUser Server Actions.
//
// Every mutation returns an `ActionResult` instead of throwing, because a
// validation failure here is ordinary user error rather than an exceptional one,
// and the contract requires it to be rendered in the form (spec/contract.md).
//
// Note `.input()` below validates SHAPE only. `UserSchema` does the real work
// inside the resolver, because a `.input()` rejection surfaces as a TRPCError
// whose `zodError` payload the form would have to re-parse to recover the same
// `{ fieldName: string[] }` the UI already renders. Validating inside keeps the
// error contract identical to the Server Action version and costs one extra
// safeParse on a path that is already doing a database round-trip.

import { z } from "zod";

import { sql } from "@/lib/db";
import { getUser, getUserTasks, getUsers } from "@/lib/data";
import { baseProcedure, createTRPCRouter } from "../init";
import type { ActionResult, FieldErrors } from "../result";

/**
 * `users.email` has no UNIQUE constraint (spec/schema.sql) and
 * spec/contract.md requires none, so no uniqueness rule is imposed here — two
 * members may legitimately share an address. The address is still shape-checked
 * because the form declares `type="email"` and the server should agree.
 */
const UserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "User name is required.")
    .max(200, "User name must be 200 characters or fewer."),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
});

function fieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors;
}

export const usersRouter = createTRPCRouter({
  list: baseProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(({ input }) => getUsers(input?.search ?? "")),

  byId: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ input }) => getUser(input.id)),

  /** The tasks assigned to one member, scoped by assignee_id rather than name. */
  tasks: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .query(({ input }) => getUserTasks(input.id)),

  create: baseProcedure
    .input(z.object({ name: z.string(), email: z.string() }))
    .mutation(async ({ input }): Promise<ActionResult> => {
      const parsed = UserSchema.safeParse(input);

      if (!parsed.success) {
        return {
          ok: false,
          errors: fieldErrors(parsed.error),
          message: "Missing fields. Failed to create user.",
        };
      }

      const { name, email } = parsed.data;

      try {
        // RETURNING id so the client can navigate to the row it just created and
        // so a persisted id is provably allocated (spec/contract.md).
        const [row] = await sql<{ id: number }[]>`
          INSERT INTO users (display_name, email)
          VALUES (${name}, ${email})
          RETURNING id::int AS id
        `;

        return { ok: true, id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        return { ok: false, message: "Database Error: Failed to create user." };
      }
    }),

  update: baseProcedure
    .input(z.object({ id: z.number().int(), name: z.string(), email: z.string() }))
    .mutation(async ({ input }): Promise<ActionResult> => {
      const { id } = input;
      const parsed = UserSchema.safeParse(input);

      if (!parsed.success) {
        return {
          ok: false,
          errors: fieldErrors(parsed.error),
          message: "Missing fields. Failed to update user.",
        };
      }

      const { name, email } = parsed.data;

      try {
        // RETURNING distinguishes "no such row" from "row updated", so a stale
        // form cannot report success for a member who is already gone.
        const updated = await sql<{ id: number }[]>`
          UPDATE users
          SET display_name = ${name}, email = ${email}
          WHERE id = ${id}
          RETURNING id
        `;

        if (updated.length === 0) {
          return { ok: false, message: "That user no longer exists." };
        }
      } catch (error) {
        console.error("Database Error:", error);
        return { ok: false, message: "Database Error: Failed to update user." };
      }

      return { ok: true, id };
    }),

  delete: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }): Promise<ActionResult> => {
      const { id } = input;

      try {
        const deleted = await sql<{ id: number }[]>`
          DELETE FROM users WHERE id = ${id} RETURNING id
        `;

        if (deleted.length === 0) {
          return { ok: false, message: "That user no longer exists." };
        }
      } catch (error) {
        // Two different FKs behave differently here, and the difference is the
        // whole point of the message:
        //
        //   comments.author_id  ON DELETE RESTRICT — the delete is refused and
        //                                          nothing changes.
        //   tasks.assignee_id   ON DELETE SET NULL — the delete succeeds and the
        //                                          tasks become unassigned.
        //
        // So a failure here is always the comments restriction: 23001 is
        // restrict_violation and 23503 is what NO ACTION raises. This is a rule the
        // user can act on, so it is reported rather than thrown.
        const code = (error as { code?: string }).code;

        if (code === "23001" || code === "23503") {
          const [commentRows, taskRows] = await Promise.all([
            sql<{ count: number }[]>`
              SELECT COUNT(*)::int AS count FROM comments WHERE author_id = ${id}
            `,
            sql<{ count: number }[]>`
              SELECT COUNT(*)::int AS count FROM tasks WHERE assignee_id = ${id}
            `,
          ]);

          const commentCount = commentRows[0]?.count ?? 0;
          const taskCount = taskRows[0]?.count ?? 0;

          return {
            ok: false,
            message:
              `This person still has ${commentCount} ` +
              `${commentCount === 1 ? "comment" : "comments"} and ${taskCount} ` +
              `${taskCount === 1 ? "task" : "tasks"}. Remove ` +
              `${commentCount === 1 ? "the comment" : "the comments"} before deleting.`,
          };
        }

        console.error("Database Error:", error);
        return { ok: false, message: "Database Error: Failed to delete user." };
      }

      return { ok: true, id };
    }),
});
