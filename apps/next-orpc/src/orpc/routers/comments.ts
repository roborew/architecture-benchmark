// The comments domain: one write, passed straight through to the data layer.
//
// The counterpart to src/trpc/routers/comments.ts. The SQL, the 1000-char bound
// and the task/author foreign-key pre-checks live in `createComment` in
// src/lib/data.ts.
//
// Comments have no standalone read here on purpose. A comment is only ever shown
// in the context of its task, and spec/queries.md bounds that read at the ten most
// recent — so `tasks.comments` is the one way to fetch them. See the contract.

import { createComment } from "@/lib/data";
import { implement } from "@orpc/server";
import { commentsContract } from "../contract";

const os = implement(commentsContract);

export const createNewComment = os.create.handler(({ input }) => createComment(input));

export const commentsRouter = os.router({
  create: createNewComment,
});
