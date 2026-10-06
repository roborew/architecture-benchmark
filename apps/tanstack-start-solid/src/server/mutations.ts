// src/server/mutations.ts
//
// TanStack Start's equivalent of the Next.js Server Actions.
//
// Each function wraps its counterpart in `src/lib/actions.ts` in a
// `createServerFn`, so the database work stays on the server while the form can
// call it from the browser over a typed RPC.
//
// Three deliberate differences from the Next.js version:
//
// 1. `method: "POST"`. A server function with the default GET serialises its
//    input into the query string, which will not carry a long description
//    comfortably. POST also matches what these operations actually are.
//
// 2. **FormData is the whole payload, never a field of one.** Start type-checks
//    a validator's input for serialisability, and FormData clears that check
//    only as the top-level value of a POST body — `{ id, formData }` does not,
//    because the serialiser walks the object and FormData is not a registered
//    type inside it. So a bound id travels as an ordinary form field alongside
//    the form's own, which is also what a plain form POST would have done.
//
// 3. No `revalidatePath`. Start has no equivalent, and the replacement is not a
//    one-liner: `router.invalidate()` re-runs the *client's* loaders, so it has
//    to happen where the router lives — in the form, after the call resolves.
//    `useServerAction` in `src/hooks/use-server-action.ts` does that, which is
//    why these functions only return the outcome.
//
// The wrappers return `ActionResult` including `redirectTo`, and do not throw a
// router redirect: the hook needs to invalidate before navigating, so it decides
// when the redirect happens.

import { createServerFn } from "@tanstack/solid-start";

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

/**
 * Form fields carrying a bound id.
 *
 * Kept in one place so the form that appends them and the handler that reads
 * them cannot disagree about the name.
 */
export const ID_FIELD = {
  project: "projectId",
  task: "taskId",
  user: "userId",
} as const;

function readId(formData: FormData, field: string): number {
  return Number(formData.get(field));
}

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createProjectAction(data));

export const updateProjectFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) =>
    updateProjectAction(readId(data, ID_FIELD.project), data),
  );

export const deleteProjectFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => deleteProjectAction(readId(data, ID_FIELD.project)));

export const createUserFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createUserAction(data));

export const updateUserFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => updateUserAction(readId(data, ID_FIELD.user), data));

export const deleteUserFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => deleteUserAction(readId(data, ID_FIELD.user)));

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createTaskAction(data));

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => updateTaskAction(readId(data, ID_FIELD.task), data));

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => deleteTaskAction(readId(data, ID_FIELD.task)));

export const createTaskWithCommentFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) => createTaskWithCommentAction(data));

export const createCommentFn = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(({ data }) =>
    createCommentAction(readId(data, ID_FIELD.task), data),
  );
