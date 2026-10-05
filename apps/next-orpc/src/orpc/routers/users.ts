// The users domain: handlers that pass straight through to the data layer.
//
// This is the counterpart to src/trpc/routers/users.ts, and the two files differ
// in one structural way worth noticing. The tRPC router declared its own input
// schemas and let the handlers *infer* the output, so the reply type existed only
// inside TypeScript. Here `implement(usersContract)` hands us builders whose input
// and output are already fixed by the contract: each `.handler()` below is
// type-checked against the promise, so a change to `UserSchema` that data.ts
// cannot satisfy fails here rather than at runtime on the client.
//
// The behavioural contract is unchanged from the tRPC version:
//
//   * The SQL, the validation and the `try`/`catch` all live in src/lib/data.ts,
//     the only module that talks to Postgres.
//   * What stays here is the transport's job — decide which data-layer function a
//     given procedure name reaches, and nothing else.
//   * Value validation is not here. A blank name is user error the form renders,
//     so it is checked inside data.ts and returns `{ ok: false, errors }`.

import {
  createUser,
  deleteUser,
  getUser,
  getUserTasks,
  getUsers,
  updateUser,
} from "@/lib/data";
import { implement } from "@orpc/server";
import { usersContract } from "../contract";

/**
 * `implement` locks the builder to the contract, which is what supplies each
 * procedure's input and output type. A second argument may carry a procedure
 * config (e.g. `{ disableOutputValidation: true }`); nothing is needed here
 * because the schemas in contract.ts are the ones we want enforced.
 */
const os = implement(usersContract);

export const listUsers = os.list.handler(({ input }) =>
  getUsers(input?.search ?? ""),
);

export const getUserById = os.byId.handler(({ input }) => getUser(input.id));

export const listUserTasks = os.tasks.handler(({ input }) =>
  getUserTasks(input.id),
);

export const createNewUser = os.create.handler(({ input }) => createUser(input));

export const updateExistingUser = os.update.handler(({ input }) =>
  updateUser(input),
);

export const deleteExistingUser = os.delete.handler(({ input }) =>
  deleteUser(input.id),
);

/**
 * The router for this domain.
 *
 * Keys are the contract's keys. `implement` checks that at build time, so a
 * renamed contract entry fails here instead of producing a 404 at runtime.
 */
export const usersRouter = os.router({
  list: listUsers,
  byId: getUserById,
  tasks: listUserTasks,
  create: createNewUser,
  update: updateExistingUser,
  delete: deleteExistingUser,
});
