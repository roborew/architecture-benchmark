// src/orpc/routers/users.ts
//
// The users domain: handlers that pass straight through to the model layer.
//
// This is the counterpart to the REST variant's users.controller.ts, and the
// two differ in one structural way worth noticing. The controller validated
// raw query params and parsed `:id` route params itself; here `implement(
// usersContract)` hands us builders whose input is already validated and typed
// by the contract, so the integer parsing the controller did is gone — a
// non-integer id now fails the contract's `.input()` shape check, which is a
// client bug rather than user error. What stays is the transport's job: the
// value rules the contract deliberately does not own (a blank name is user
// error the form renders), and deciding which model function a procedure name
// reaches.
//
// The behavioural contract is unchanged from the REST version:
//
//   * The SQL, the validation and the `try`/`catch` all live in the model
//     (src/users/users.model.ts), the only module that talks to Postgres.
//   * Value validation is not here. A blank name is user error the form
//     renders, so it is checked by the pure validator and thrown as a
//     validation error carrying the field → messages map.
//   * Refusals are ORPCErrors carrying the reference variant's message strings
//     verbatim (src/orpc/errors.ts owns the mapping).

import { implement } from "@orpc/server";

import { parseSearchTerm } from "../../lib/query.validator.ts";
import type { UsersModel } from "../../users/users.model.ts";
import { parseUserBody } from "../../users/users.validator.ts";
import { notFoundError, validationError, conflictError } from "../errors.ts";
import { usersContract } from "../contract.ts";

/**
 * `implement` locks the builder to the contract, which is what supplies each
 * procedure's input and output type. A second argument may carry a procedure
 * config; nothing is needed here because the schemas in contract.ts are the
 * ones we want enforced.
 */
const os = implement(usersContract);

export function createUsersRouter(model: UsersModel) {
  return os.router({
    list: os.list.handler(async ({ input }) => {
      const parsed = parseSearchTerm(input?.q);

      if (!parsed.ok) {
        throw validationError(parsed.error);
      }

      return model.list(parsed.term);
    }),

    byId: os.byId.handler(async ({ input }) => {
      const user = await model.get(input.id);

      if (!user) {
        throw notFoundError("Not found");
      }

      return user;
    }),

    tasks: os.tasks.handler(({ input }) => model.listTasks(input.id)),

    create: os.create.handler(async ({ input }) => {
      const parsed = parseUserBody(input);

      if (!parsed.ok) {
        throw validationError("Missing fields. Failed to create user.", parsed.errors);
      }

      const created = await model.create(parsed.data);

      return {
        ok: true as const,
        message: "User created.",
        redirectTo: `/users/${created.id}`,
      };
    }),

    update: os.update.handler(async ({ input }) => {
      const parsed = parseUserBody(input);

      if (!parsed.ok) {
        throw validationError("Missing fields. Failed to update user.", parsed.errors);
      }

      const result = await model.update(input.id, parsed.data);

      if (result.status === "missing") {
        throw notFoundError("That user no longer exists.");
      }

      return {
        ok: true as const,
        message: "User updated.",
        redirectTo: `/users/${input.id}`,
      };
    }),

    remove: os.remove.handler(async ({ input }) => {
      const result = await model.remove(input.id);

      if (result.status === "missing") {
        throw notFoundError("That user no longer exists.");
      }

      if (result.status === "restricted") {
        // A member who has authored comments cannot be removed (FK RESTRICT);
        // the reference reports why as an actionable message, which this API
        // answers as a CONFLICT with the same string.
        throw conflictError(result.message);
      }

      return {
        ok: true as const,
        message: "User deleted.",
        redirectTo: "/users",
      };
    }),
  });
}

export type UsersRouter = ReturnType<typeof createUsersRouter>;
