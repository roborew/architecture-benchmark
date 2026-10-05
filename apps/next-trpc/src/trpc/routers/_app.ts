import { createTRPCRouter } from "../init";
import { projectsRouter } from "./projects";
import { usersRouter } from "./users";

// Migrated domain by domain. `users` and `projects` have left Server Actions; the
// tasks/comments routers are added as those move off src/lib/actions.ts. Pages for
// the unmigrated domains keep calling @/lib/data.ts directly and keep their
// existing Server Actions, so the tree compiles and runs at every intermediate
// step of the migration.
export const appRouter = createTRPCRouter({
  users: usersRouter,
  projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
