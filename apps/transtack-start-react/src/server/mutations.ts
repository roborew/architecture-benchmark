// src/server/mutations.ts
//
// TanStack Start's equivalent of the Next.js Server Actions.
//
// Each function wraps its counterpart in `src/lib/actions.ts` in a
// `createServerFn`, so the database work stays on the server while the form can
// call it from the browser over a typed RPC.
//
// Two deliberate differences from the Next.js version:
//
// 1. `method: "POST"`. A server function with the default GET serialises its
//    input into the query string, which will not carry a long description
//    comfortably. POST also matches what these operations actually are.
//
// 2. No `revalidatePath`. Start has no equivalent, and the replacement is not a
//    one-liner: `router.invalidate()` re-runs the *client's* loaders, so it has
//    to happen where the router lives — in the form, after the call resolves.
//    `useServerAction` in `src/hooks/use-server-action.ts` does that, which is
//    why these functions only return the outcome.
//
// The wrappers return `ActionResult` including `redirectTo`, and do not throw a
// router redirect: the hook needs to invalidate before navigating, so it decides
// when the redirect happens.

import { createServerFn } from "@tanstack/react-start";

import {
  createComment as createCommentAction,
  createProject as createProjectAction,
  createTask as createTaskAction,
  createTaskWithComment as createTaskWithCommentAction,
  createUser as createUserAction,
  deleteProject as deleteProjectAction,
  deleteTask as deleteTaskAction,
  deleteUser as deleteUserAction,
  updateProject as updateProjectAction,
  updateTask as updateTaskAction,
  updateUser as updateUserAction,
} from "@/lib/actions";

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createProjectAction(data));

export const updateProjectFn = createServerFn({ method: "POST" })
  .validator((data: { id: number; formData: FormData }) => data)
  .handler(({ data }) => updateProjectAction(data.id, data.formData));

export const deleteProjectFn = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(({ data }) => deleteProjectAction(data.id));

export const createUserFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createUserAction(data));

export const updateUserFn = createServerFn({ method: "POST" })
  .validator((data: { id: number; formData: FormData }) => data)
  .handler(({ data }) => updateUserAction(data.id, data.formData));

export const deleteUserFn = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(({ data }) => deleteUserAction(data.id));

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createTaskAction(data));

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator((data: { id: number; formData: FormData }) => data)
  .handler(({ data }) => updateTaskAction(data.id, data.formData));

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(({ data }) => deleteTaskAction(data.id));

export const createTaskWithCommentFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createTaskWithCommentAction(data));

export const createCommentFn = createServerFn({ method: "POST" })
  .validator((data: { taskId: number; formData: FormData }) => data)
  .handler(({ data }) => createCommentAction(data.taskId, data.formData));
