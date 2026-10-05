// The comments domain: transport only.
//
// One write, and it is a pass-through like every other: the SQL, the 1000-char
// bound and the task/author foreign-key pre-checks live in `createComment` in
// src/lib/data.ts.
//
// Comments have no standalone read here on purpose. A comment is only ever shown
// in the context of its task, and spec/queries.md bounds that read at the ten most
// recent — so `tasks.comments` is the one way to fetch them.

import { z } from "zod";

import { createComment } from "@/lib/data";
import { baseProcedure, createTRPCRouter } from "../init";

export const commentsRouter = createTRPCRouter({
  create: baseProcedure
    .input(
      z.object({
        taskId: z.number().int(),
        commentBody: z.string(),
        commentAuthorId: z.number().int(),
      }),
    )
    .mutation(({ input }) => createComment(input)),
});
