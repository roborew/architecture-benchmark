"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";

import prisma from "./prisma";

/**
 * Whether a write was refused because a foreign key still points at the row.
 *
 * Prisma reports the RESTRICT and NO ACTION failures the old `sql` branch
 * matched on Postgres codes `23001`/`23503` as a single code, `P2003`, with the
 * original SQLSTATE kept under `meta.driverAdapterError.cause.originalCode`.
 * Both mean the same thing to a user — rows still reference this one — so the
 * caller turns this into a readable message rather than an error it cannot act
 * on.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  );
}

/**
 * Coerces an id that arrived from the UI into the `BigInt` the schema declares.
 *
 * Every pk is a `BigInt`, but ids cross the server-action boundary as `number`
 * (the type the routes and tables use). Callers only reach this after the id has
 * been checked to be an integer, so `BigInt` cannot throw here.
 */
function toId(value: number): bigint {
  return BigInt(value);
}

const ProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    // The schema puts no limit on projects.name, but tasks.title caps at 200.
    .max(200, "Project name must be 200 characters or fewer."),
  description: z.string().trim(),
});

/**
 * `users.email` has no UNIQUE constraint (spec/schema.sql) and
 * spec/contract.md requires none, so no uniqueness rule is imposed here — two
 * members may legitimately share an address. The address is still shape-checked
 * because the form declares `type="email"` and the server should agree.
 */
const UserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "User name is required.")
    .max(200, "User name must be 200 characters or fewer."),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
});

/**
 * The task fields a create or update form submits.
 *
 * `assigneeId` is optional on purpose: the schema's `assignee_id` is nullable
 * and spec/contract.md gives exactly one way to unassign — an explicit empty
 * choice — so an absent or empty value means "unassigned" rather than invalid.
 *
 * `projectId` is coerced to a number so the schema can check the reference, but
 * the raw string is kept for the field-level error: a non-numeric value must be
 * reported against the select the user actually filled in.
 */
const TaskSchema = z.object({
  title: z
    .string()
    .trim()
    // Matches the CHECK (char_length BETWEEN 1 AND 200) in spec/schema.sql, so
    // the same bound is enforced in the form and the database.
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  // `formData.get` returns null for a field the form did not submit at all,
  // which `z.string().default("")` would not catch — `.default` only fills in
  // `undefined`. An omitted description is legal (the column defaults to ''),
  // so null is normalised here rather than reported as a validation failure.
  description: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z.string().trim(),
  ),
  status: z.enum(["todo", "in progress", "done"], {
    message: "Choose a valid status.",
  }),
});

/**
 * A comment submitted on its own, or as the first comment of a new task.
 *
 * The 1000-character bound matches the CHECK on `comments.body` in
 * spec/schema.sql, so the form and the database enforce the same limit. The
 * author is coerced because it arrives from a `<select>` as a string.
 */
const CommentSchema = z.object({
  commentBody: z.preprocess(
    (value) => (value === null || value === undefined ? "" : value),
    z
      .string()
      .trim()
      .min(1, "Comment is required.")
      .max(1000, "Comment must be 1000 characters or fewer."),
  ),
  commentAuthorId: z.coerce.number().int().positive(),
});

/** Selects that must resolve to a real row before a task can reference them. */
async function resolveRefs(fields: {
  projectId?: FormDataEntryValue | null;
  assigneeId?: FormDataEntryValue | null;
}) {
  const projectId = Number(fields.projectId);
  const assigneeRaw = fields.assigneeId;
  const assigneeId =
    assigneeRaw === null || assigneeRaw === undefined || assigneeRaw === ""
      ? null
      : Number(assigneeRaw);

  const errors: NonNullable<State["errors"]> = {};

  if (!Number.isInteger(projectId)) {
    errors.projectId = ["Choose a project."];
  } else {
    // Selecting only the pk is enough: the question is whether the row exists,
    // not what it holds.
    const row = await prisma.projects.findUnique({
      where: { id: toId(projectId) },
      select: { id: true },
    });

    if (!row) {
      errors.projectId = ["That project no longer exists."];
    }
  }

  if (assigneeId !== null) {
    if (!Number.isInteger(assigneeId)) {
      errors.assigneeId = ["Choose a valid assignee."];
    } else {
      const row = await prisma.users.findUnique({
        where: { id: toId(assigneeId) },
        select: { id: true },
      });

      if (!row) {
        errors.assigneeId = ["That assignee no longer exists."];
      }
    }
  }

  return { projectId, assigneeId, errors };
}

export type State = {
  errors?: {
    name?: string[];
    email?: string[];
    description?: string[];
    title?: string[];
    projectId?: string[];
    assigneeId?: string[];
    status?: string[];
    commentBody?: string[];
    commentAuthorId?: string[];
  };
  message?: string | null;
};

export async function createProject(
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = ProjectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create project.",
    };
  }

  const { name, description } = validatedFields.data;

  try {
    // created_at is NOT NULL with no default, so the server sets it.
    await prisma.projects.create({
      data: { name, description, created_at: new Date() },
    });
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create project." };
  }

  revalidatePath("/");
  revalidatePath("/projects");
  redirect("/projects");
}

export async function updateProject(
  id: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = ProjectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to update project.",
    };
  }

  const { name, description } = validatedFields.data;

  try {
    // `updateMany` rather than `update` because it reports a count instead of
    // throwing when nothing matched, which distinguishes "no such row" from
    // "row updated" so a stale form cannot report success for a project that is
    // already gone.
    const { count } = await prisma.projects.updateMany({
      where: { id: toId(id) },
      data: { name, description },
    });

    if (count === 0) {
      return { message: "That project no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to update project." };
  }

  revalidatePath("/");
  revalidatePath("/projects");
  redirect("/projects");
}

export async function deleteProject(
  id: number,
  _prevState: State,
  _formData: FormData,
): Promise<State> {
  try {
    // Same reasoning as the update above: a count, not a throw, so "already
    // gone" is reported rather than mistaken for a database failure.
    const { count } = await prisma.projects.deleteMany({
      where: { id: toId(id) },
    });

    if (count === 0) {
      return { message: "That project no longer exists." };
    }
  } catch (error) {
    // tasks.project_id is ON DELETE RESTRICT, so a project that still has
    // tasks cannot be removed. This is a rule the user can act on, so it is
    // reported rather than thrown.
    if (isForeignKeyViolation(error)) {
      const count = await prisma.tasks.count({
        where: { project_id: toId(id) },
      });

      return {
        message:
          count === 1
            ? "This project still has 1 task. Delete it before deleting the project."
            : `This project still has ${count} tasks. Delete them before deleting the project.`,
      };
    }

    console.error("Database Error:", error);
    return { message: "Database Error: Failed to delete project." };
  }

  revalidatePath("/");
  revalidatePath("/projects");
  redirect("/projects");
}

export async function createUser(
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = UserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create user.",
    };
  }

  const { name, email } = validatedFields.data;

  try {
    await prisma.users.create({
      data: { display_name: name, email },
    });
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create user." };
  }

  revalidatePath("/");
  revalidatePath("/users");
  redirect("/users");
}

export async function updateUser(
  id: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = UserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to update user.",
    };
  }

  const { name, email } = validatedFields.data;

  try {
    // A count rather than a throw, so a stale form cannot report success for a
    // member who is already gone.
    const { count } = await prisma.users.updateMany({
      where: { id: toId(id) },
      data: { display_name: name, email },
    });

    if (count === 0) {
      return { message: "That user no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to update user." };
  }

  revalidatePath("/");
  revalidatePath("/users");
  // Back to the detail page rather than the list: the edit control lives there,
  // so the user keeps the context they navigated from.
  redirect(`/users/${id}`);
}

export async function deleteUser(
  id: number,
  _prevState: State,
  _formData: FormData,
): Promise<State> {
  try {
    const { count } = await prisma.users.deleteMany({
      where: { id: toId(id) },
    });

    if (count === 0) {
      return { message: "That user no longer exists." };
    }
  } catch (error) {
    // Two different FKs behave differently here, and the difference is the
    // whole point of the message:
    //
    //   comments.author_id  ON DELETE RESTRICT — the delete is refused and
    //                                          nothing changes.
    //   tasks.assignee_id   ON DELETE SET NULL — the delete succeeds and the
    //                                          tasks become unassigned.
    //
    // So a failure here is always the comments restriction. This is a rule the
    // user can act on, so it is reported rather than thrown.
    if (isForeignKeyViolation(error)) {
      const [commentCount, taskCount] = await Promise.all([
        prisma.comments.count({ where: { author_id: toId(id) } }),
        prisma.tasks.count({ where: { assignee_id: toId(id) } }),
      ]);

      return {
        message:
          `This person still has ${commentCount} ` +
          `${commentCount === 1 ? "comment" : "comments"} and ${taskCount} ` +
          `${taskCount === 1 ? "task" : "tasks"}. Remove ` +
          `${commentCount === 1 ? "the comment" : "the comments"} before deleting.`,
      };
    }

    console.error("Database Error:", error);
    return { message: "Database Error: Failed to delete user." };
  }

  revalidatePath("/");
  revalidatePath("/users");
  redirect("/users");
}

/**
 * spec/queries.md — "Create task": insert one row, with the server setting
 * `created_at` and `updated_at` explicitly and equal. Both columns are NOT NULL
 * with no default, so a statement that omits them fails at the database; setting
 * them here also keeps the two identical, which is what the contract means by
 * "both equal at insert".
 */
export async function createTask(
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = TaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create task.",
    };
  }

  const { projectId, assigneeId, errors } = await resolveRefs({
    projectId: formData.get("projectId"),
    assigneeId: formData.get("assigneeId"),
  });

  if (Object.keys(errors).length > 0) {
    return { errors, message: "Missing fields. Failed to create task." };
  }

  const { title, description, status } = validatedFields.data;

  try {
    // One `now` for both columns so they are equal by construction, which is
    // what the contract means by "both equal at insert".
    const now = new Date();

    await prisma.tasks.create({
      data: {
        project_id: toId(projectId),
        assignee_id: assigneeId === null ? null : toId(assigneeId),
        title,
        description,
        status,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/projects/${projectId}`);
  redirect("/tasks");
}

/**
 * spec/queries.md — "Update task" by primary key, with `updated_at` set in the
 * statement rather than by a DB default or an ORM side effect. An update counts
 * as successful only if the intended row now holds the intended value, which
 * the matched-row count confirms.
 */
export async function updateTask(
  id: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = TaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to update task.",
    };
  }

  // The project is deliberately not resolved here. spec/contract.md lists the
  // update form's fields as title, status, assignee and description — a task
  // belongs to its project for its lifetime, and requiring a project field the
  // form does not render would make every edit fail validation.

  const { title, description, status } = validatedFields.data;

  const assigneeRaw = formData.get("assigneeId");
  const assigneeId =
    assigneeRaw === null || assigneeRaw === undefined || assigneeRaw === ""
      ? null
      : Number(assigneeRaw);

  if (assigneeId !== null) {
    const assignee = await prisma.users.findUnique({
      where: { id: toId(assigneeId) },
      select: { id: true },
    });

    if (!assignee) {
      return {
        errors: { assigneeId: ["That assignee no longer exists."] },
        message: "Missing fields. Failed to update task.",
      };
    }
  }

  // Read the project first so the redirect can revalidate the board the task
  // is leaving, or joining.
  const existing = await prisma.tasks.findUnique({
    where: { id: toId(id) },
    select: { project_id: true },
  });

  if (!existing) {
    return { message: "That task no longer exists." };
  }

  try {
    // updated_at is set here rather than by a DB default or an ORM side effect,
    // and the count confirms the intended row really was the one updated.
    const { count } = await prisma.tasks.updateMany({
      where: { id: toId(id) },
      data: {
        title,
        description,
        status,
        assignee_id: assigneeId === null ? null : toId(assigneeId),
        updated_at: new Date(),
      },
    });

    if (count === 0) {
      return { message: "That task no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to update task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${id}`);
  // `project_id` is a BigInt in the schema, so it is rendered from the row
  // rather than interpolated as one.
  revalidatePath(`/projects/${Number(existing.project_id)}`);

  redirect(`/tasks/${id}`);
}

/**
 * spec/queries.md — "Delete task" under the documented cascade: the task's
 * comments go with it via `comments.task_id` ON DELETE CASCADE.
 */
export async function deleteTask(
  id: number,
  _prevState: State,
  _formData: FormData,
): Promise<State> {
  // Read the project first, both to revalidate its board and because the
  // contract redirects there after a delete.
  const existing = await prisma.tasks.findUnique({
    where: { id: toId(id) },
    select: { project_id: true },
  });

  if (!existing) {
    return { message: "That task no longer exists." };
  }

  const projectId = Number(existing.project_id);

  try {
    const { count } = await prisma.tasks.deleteMany({
      where: { id: toId(id) },
    });

    if (count === 0) {
      return { message: "That task no longer exists." };
    }
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to delete task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/projects/${projectId}`);

  // Straight to the board: the detail page for this id is now not-found, so
  // redirecting there would land the user on a dead URL.
  redirect(`/projects/${projectId}`);
}

/**
 * spec/queries.md — "Create with initial comment": one transaction inserting the
 * task then its comment, with any failure rolling back both.
 *
 * The transaction matters because the task insert alone would otherwise
 * succeed and leave a task whose first comment was never written — a partial
 * state the contract says must never be observable.
 */
export async function createTaskWithComment(
  prevState: State,
  formData: FormData,
): Promise<State> {
  const validatedFields = TaskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status"),
  });

  // The comment has its own bound (char_length BETWEEN 1 AND 1000), enforced by
  // its own schema so the message lands on the comment field.
  const commentFields = CommentSchema.safeParse({
    commentBody: formData.get("commentBody"),
    commentAuthorId: formData.get("commentAuthorId"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create the task.",
    };
  }

  if (!commentFields.success) {
    return {
      errors: commentFields.error.flatten().fieldErrors,
      message: "Missing fields. Failed to create the task.",
    };
  }

  // Only once the shape of the fields is known to be good does it make sense to
  // ask the database whether the referenced rows exist.
  const { projectId, assigneeId, errors } = await resolveRefs({
    projectId: formData.get("projectId"),
    assigneeId: formData.get("assigneeId"),
  });

  if (Object.keys(errors).length > 0) {
    return { errors, message: "Missing fields. Failed to create the task." };
  }

  const { title, description, status } = validatedFields.data;
  const commentBody = commentFields.data.commentBody.trim();
  const commentAuthorId = commentFields.data.commentAuthorId;

  // The author is a FK like the assignee, so an id that matches no row fails the
  // insert. Checking first turns that into a field error rather than a thrown
  // Postgres error the user cannot act on.
  const author = await prisma.users.findUnique({
    where: { id: toId(commentAuthorId) },
    select: { id: true },
  });

  if (!author) {
    return {
      errors: { assigneeId: ["That comment author no longer exists."] },
      message: "Missing fields. Failed to create the task.",
    };
  }

  try {
    // One `now` for both timestamps, so the task's created_at and updated_at are
    // equal by construction, as a plain create makes them.
    const now = new Date();

    // An interactive transaction, so the comment insert can reference the task
    // the insert above just produced. Any throw rolls both back together.
    await prisma.$transaction(async (tx) => {
      const row = await tx.tasks.create({
        data: {
          project_id: toId(projectId),
          assignee_id: assigneeId === null ? null : toId(assigneeId),
          title,
          description,
          status,
          created_at: now,
          updated_at: now,
        },
        select: { id: true },
      });

      await tx.comments.create({
        data: {
          task_id: row.id,
          author_id: toId(commentAuthorId),
          body: commentBody,
          created_at: now,
        },
      });
    });
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to create the task." };
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath(`/projects/${projectId}`);
  redirect("/tasks");
}

/**
 * Adds a comment to an existing task.
 *
 * Separate from `createTaskWithComment` because a comment on an existing task
 * is a single insert — the atomicity that form needs comes from being one
 * transaction with the task insert, which this path has no part in.
 */
export async function createComment(
  taskId: number,
  prevState: State,
  formData: FormData,
): Promise<State> {
  const parsed = CommentSchema.safeParse({
    commentBody: formData.get("commentBody"),
    commentAuthorId: formData.get("commentAuthorId"),
  });

  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      message: "Missing fields. Failed to add the comment.",
    };
  }

  const commentBody = parsed.data.commentBody;
  const commentAuthorId = parsed.data.commentAuthorId;

  // The task and the author are both foreign keys. Checking first turns an
  // unknown id into a field error the user can act on, rather than a thrown
  // Postgres error. The task is selected with its project so the board can be
  // revalidated below without a second round trip.
  const [task, author] = await Promise.all([
    prisma.tasks.findUnique({
      where: { id: toId(taskId) },
      select: { id: true, project_id: true },
    }),
    prisma.users.findUnique({
      where: { id: toId(commentAuthorId) },
      select: { id: true },
    }),
  ]);

  if (!task) {
    return { message: "That task no longer exists." };
  }

  if (!author) {
    return {
      errors: { commentAuthorId: ["That comment author no longer exists."] },
      message: "Missing fields. Failed to add the comment.",
    };
  }

  try {
    await prisma.comments.create({
      data: {
        task_id: toId(taskId),
        author_id: toId(commentAuthorId),
        body: commentBody,
        created_at: new Date(),
      },
    });
  } catch (error) {
    console.error("Database Error:", error);
    return { message: "Database Error: Failed to add the comment." };
  }

  // The count on the task list changed, so both the detail page and the list
  // are now stale.
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
  revalidatePath(`/projects/${Number(task.project_id)}`);

  // No redirect: the user stays on the task detail page and sees the comment
  // they just wrote in the list above the form.
  return {};
}
