import { createTRPCRouter } from "../init";
import { commentsRouter } from "./comments";
import { projectsRouter } from "./projects";
import { tasksRouter } from "./tasks";
import { usersRouter } from "./users";

// Every domain has now left src/lib/actions.ts, so this is the whole application
// surface: the Server Action module is gone and every page reaches Postgres
// through one of these routers.
export const appRouter = createTRPCRouter({
  users: usersRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  comments: commentsRouter,
});

export type AppRouter = typeof appRouter;
