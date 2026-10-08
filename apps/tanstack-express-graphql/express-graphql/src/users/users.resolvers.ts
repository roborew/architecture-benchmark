// src/users/users.resolvers.ts
//
// The resolver layer for users: the REST controller's validation logic and
// message strings, ported verbatim onto GraphQL operations. The reads build
// the string bag the pure validators expect (src/graphql/args.ts); the writes
// pass the mutation arguments — the form's field bag of strings — straight
// through to src/users/users.validator.ts, which owns every coercion rule.

import { requireIdArg, stringArg } from "../graphql/args.ts";
import {
  badInputError,
  conflictError,
  notFoundError,
  validationError,
} from "../graphql/graphql-error.ts";
import { parseSearchTerm } from "../lib/query.validator.ts";
import type { UsersModel } from "./users.model.ts";
import { parseUserBody } from "./users.validator.ts";

type UserBodyArgs = {
  name?: string | null;
  email?: string | null;
};

export function createUsersResolvers(model: UsersModel) {
  return {
    Query: {
      /** The People listing page's rows. */
      async users(_parent: unknown, args: { q?: string | null }) {
        const parsed = parseSearchTerm(stringArg(args.q));

        if (!parsed.ok) {
          throw badInputError(parsed.error);
        }

        return model.list(parsed.term);
      },

      /** One member, with the same shape the listing returns. */
      async user(_parent: unknown, args: { id: number }) {
        const id = requireIdArg(args.id);
        const user = await model.get(id);

        if (!user) {
          throw notFoundError("Not found");
        }

        return user;
      },

      /** The tasks assigned to one member. */
      async userTasks(_parent: unknown, args: { userId: number }) {
        const userId = requireIdArg(args.userId);

        return model.listTasks(userId);
      },
    },

    Mutation: {
      /** Insert one member; the SPA navigates to their page next. */
      async createUser(_parent: unknown, args: UserBodyArgs) {
        const parsed = parseUserBody(args);

        if (!parsed.ok) {
          throw validationError(
            "Missing fields. Failed to create user.",
            parsed.errors,
          );
        }

        const created = await model.create(parsed.data);

        return {
          ok: true as const,
          message: "User created.",
          redirectTo: `/users/${created.id}`,
        };
      },

      /** Update one member by primary key. */
      async updateUser(_parent: unknown, args: UserBodyArgs & { id: number }) {
        const id = requireIdArg(args.id);
        const parsed = parseUserBody(args);

        if (!parsed.ok) {
          throw validationError(
            "Missing fields. Failed to update user.",
            parsed.errors,
          );
        }

        const result = await model.update(id, parsed.data);

        if (result.status === "missing") {
          throw notFoundError("That user no longer exists.");
        }

        return {
          ok: true as const,
          message: "User updated.",
          redirectTo: `/users/${id}`,
        };
      },

      /** Delete one member, or a conflict while they authored comments. */
      async deleteUser(_parent: unknown, args: { id: number }) {
        const id = requireIdArg(args.id);
        const result = await model.remove(id);

        if (result.status === "missing") {
          throw notFoundError("That user no longer exists.");
        }

        if (result.status === "restricted") {
          // A member who has authored comments cannot be removed (FK RESTRICT);
          // the reference reports why as an actionable message, which this API
          // answers with the same string as a conflict.
          throw conflictError(result.message);
        }

        return {
          ok: true as const,
          message: "User deleted.",
          redirectTo: "/users",
        };
      },
    },
  };
}
