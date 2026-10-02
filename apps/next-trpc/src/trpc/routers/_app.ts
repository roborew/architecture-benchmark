import { createTRPCRouter } from "../init";
import { usersRouter } from "./users";

// Migrated domain by domain. Only `users` has left Server Actions so far; the
// projects/tasks/comments routers are added as each of those moves off
// src/lib/actions.ts. Pages for the unmigrated domains keep calling @/lib/data.ts
// directly and keep their existing Server Actions, so the tree compiles and runs
// at every intermediate step of the migration.
export const appRouter = createTRPCRouter({
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
