// The users domain: transport only.
//
// Every procedure here is a one-line pass-through. The SQL, the validation and
// the `try`/`catch` all live in src/lib/data.ts, which is the only module that
// talks to Postgres — see `createUser`, `updateUser` and `deleteUser` there.
//
// What stays here is the part that IS the transport's job:
//
//   * `.input()` checks that the caller sent the right SHAPE. A rejection here is
//     a client bug, not user error, so it surfaces as a TRPCError rather than an
//     `ActionResult`.
//   * Deciding which lib/data function a given procedure name reaches.
//
// Validation of the values themselves is NOT here. A blank name is ordinary user
// error that the form renders, so it is checked inside data.ts and comes back as
// `{ ok: false, errors }` — the same `{ fieldName: string[] }` the form already
// renders, whether it arrived over tRPC or any other transport.

import { z } from "zod";

import {
  createUser,
  deleteUser,
  getUser,
  getUserTasks,
  getUsers,
  updateUser,
} from "@/lib/data";
import { baseProcedure, createTRPCRouter } from "../init";

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
    .mutation(({ input }) => createUser(input)),

  update: baseProcedure
    .input(
      z.object({ id: z.number().int(), name: z.string(), email: z.string() }),
    )
    .mutation(({ input }) => updateUser(input)),

  delete: baseProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => deleteUser(input.id)),
});
