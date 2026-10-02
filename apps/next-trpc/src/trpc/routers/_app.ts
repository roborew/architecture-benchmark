import { createTRPCRouter } from "../init";
import { projectsRouter } from "./projects";
import { tasksRouter } from "./tasks";
import { usersRouter } from "./users";
import { commentsRouter } from "./comments";

export const appRouter = createTRPCRouter({
  projects: projectsRouter,
  tasks: tasksRouter,
  users: usersRouter,
  comments: commentsRouter,
});

export type AppRouter = typeof appRouter;
