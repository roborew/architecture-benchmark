// The comments domain: one write, migrated from the createComment Server Action.
//
// Comments have no standalone page, so there is nothing to read here beyond what
// tasks.comments returns for a task. That is deliberate: a comment is only ever
// shown in the context of its task, and spec/queries.md bounds that read at the
// ten most recent.
//
// Like the other routers, a refused write returns `{ ok: false }` rather than
// throwing — a blank body or an author who no longer exists is user error the
// form renders, not an exceptional condition.

import { z } from "zod";

import { sql } from "@/lib/db";
import { baseProcedure, createTRPCRouter } from "../init";
import type { ActionResult } from "../result";

/**
 * The 1000-character bound matches the CHECK on `comments.body` in
 * spec/schema.sql, so the form and the database enforce the same limit.
 */
const CommentSchema = z.object({
  commentBody: z
    .string()
    .trim()
    .min(1, "Comment is required.")
    .max(1000, "Comment must be 1000 characters or fewer."),
  commentAuthorId: z.number().int().positive(),
});

export const commentsRouter = createTRPCRouter({
  create: baseProcedure
    .input(
      z.object({
        taskId: z.number().int(),
        commentBody: z.string(),
        commentAuthorId: z.number().int(),
      }),
    )
    .mutation(async ({ input }): Promise<ActionResult> => {
      const { taskId } = input;
      const parsed = CommentSchema.safeParse(input);

      if (!parsed.success) {
        return {
          ok: false,
          errors: parsed.error.flatten().fieldErrors,
          message: "Missing fields. Failed to add the comment.",
        };
      }

      const { commentBody, commentAuthorId } = parsed.data;

      // The task and the author are both foreign keys. Checking first turns an
      // unknown id into a field error the user can act on, rather than a thrown
      // Postgres error.
      const [[task], [author]] = await Promise.all([
        sql<{ id: number }[]>`SELECT id::int FROM tasks WHERE id = ${taskId}`,
        sql<
          { id: number }[]
        >`SELECT id::int FROM users WHERE id = ${commentAuthorId}`,
      ]);

      if (!task) {
        return { ok: false, message: "That task no longer exists." };
      }

      if (!author) {
        return {
          ok: false,
          errors: { commentAuthorId: ["That comment author no longer exists."] },
          message: "Missing fields. Failed to add the comment.",
        };
      }

      try {
        const [row] = await sql<{ id: number }[]>`
          INSERT INTO comments (task_id, author_id, body, created_at)
          VALUES (${taskId}, ${commentAuthorId}, ${commentBody}, now())
          RETURNING id::int AS id
        `;

        return { ok: true, id: row.id };
      } catch (error) {
        console.error("Database Error:", error);
        return {
          ok: false,
          message: "Database Error: Failed to add the comment.",
        };
      }
    }),
});
