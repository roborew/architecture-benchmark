// src/graphql/type-defs.ts
//
// The GraphQL surface, in one place — what the REST variant spelled out across
// its four routers is spelled out here as one schema document. Every read the
// SPA renders and every write its forms submit has exactly one operation, with
// the same field names the model rows already carry (the SQL projections alias
// to camelCase), so a resolver can return a model row as-is and GraphQL's
// default field resolvers do the mapping.
//
// Deliberate decisions, mirroring the REST contract this replaces:
//
//   - `task`/`project`/`user` are NON-NULL and throw for a missing row. The
//     REST API answered 404 for an unknown id, and the SPA's routes branch on
//     `ApiError.status === 404` to render their inline not-found states — so a
//     missing row must surface as an error, not as a null field, or the SPA
//     would crash on data it expects to exist.
//
//   - Every mutation returns `MutationOutcome` — the REST `{ ok, message,
//     redirectTo }` envelope verbatim, because the SPA's `useApiAction` reads
//     exactly those three fields to decide what to render and where to
//     navigate next.
//
//   - The task/user/project *mutation* arguments are all `String` (nullable),
//     not `Int`/enums. The SPA's forms submit field bags of strings — an empty
//     assignee means "unassigned", a numeric string is a row id — and the
//     contract is that the server owns every coercion rule (the validators
//     ported from the reference's zod schemas, which accept the form's spelling
//     verbatim). Strong-typing the arguments here would move that authority
//     into the schema and split it from the validators, where the reference's
//     message strings live. The read-side filter arguments, by contrast, are
//     typed (`Int`, `String`) because no coercion contract exists there — the
//     REST layer stringified them into query params and back.

export const typeDefs = /* GraphQL */ `
  # -------------------------------------------------------------------------
  # Reads
  # -------------------------------------------------------------------------

  type Query {
    "The dashboard aggregate: stats, the 3 most recent tasks, the 2 busiest projects."
    dashboard: Dashboard!

    "Every project with its aggregate counts, ordered created_at DESC, id DESC."
    projects(q: String): [Project!]!

    "One project by id; a missing row is an error (the SPA renders it as not-found)."
    project(id: Int!): Project!

    "One keyset page of a project's board, newest first (created_at DESC, id DESC)."
    projectTasks(
      projectId: Int!
      status: String
      cursor: String
      limit: Int
    ): [ProjectTaskRow!]!

    "The workspace-wide task list, newest updated first, one keyset page."
    tasks(
      q: String
      status: String
      projectId: Int
      assigneeId: Int
      cursor: String
      limit: Int
    ): [TaskRow!]!

    "How many tasks match the list's filters (the summary line's aggregate)."
    taskCount(q: String, status: String, projectId: Int, assigneeId: Int): Int!

    "One task by id, with its project name; a missing row is an error."
    task(id: Int!): Task!

    "The 10 most recent comments on one task, newest first."
    taskComments(taskId: Int!): [Comment!]!

    "The People listing, ordered display_name DESC, id DESC."
    users(q: String): [User!]!

    "One member by id, with the same shape the listing returns."
    user(id: Int!): User!

    "The tasks assigned to one member, newest updated first."
    userTasks(userId: Int!): [Task!]!
  }

  # -------------------------------------------------------------------------
  # Types — the model rows' shapes, field for field
  # -------------------------------------------------------------------------

  type User {
    id: Int!
    name: String!
    email: String!
    assignedTaskCount: Int!
    openTaskCount: Int!
    commentCount: Int!
  }

  "A task joined with its project name, as every task read returns it."
  type Task {
    id: Int!
    projectId: Int!
    projectName: String!
    title: String!
    description: String!
    status: String!
    assigneeName: String!
    commentCount: Int!
    updatedAt: String!
  }

  "A workspace-list row: the task plus the raw (updated_at, id) cursor parts."
  type TaskRow {
    id: Int!
    projectId: Int!
    projectName: String!
    title: String!
    description: String!
    status: String!
    assigneeName: String!
    commentCount: Int!
    updatedAt: String!
    updatedAtRaw: String!
    cursorFor: String!
  }

  "A project-board row: the board pages over (created_at, id) instead."
  type ProjectTaskRow {
    id: Int!
    projectId: Int!
    projectName: String!
    title: String!
    description: String!
    status: String!
    assigneeName: String!
    commentCount: Int!
    updatedAt: String!
    createdAtRaw: String!
    cursorFor: String!
  }

  type Comment {
    id: Int!
    taskId: Int!
    authorName: String!
    body: String!
    createdAt: String!
  }

  type Project {
    id: Int!
    name: String!
    description: String!
    taskCount: Int!
    openTaskCount: Int!
    peopleCount: Int!
    createdAt: String!
  }

  type DashboardStats {
    projectCount: Int!
    totalTasks: Int!
    openTasks: Int!
    peopleCount: Int!
    todoTasks: Int!
    inProgressTasks: Int!
    doneTasks: Int!
  }

  "The recent-tasks table's row: a task without its project id, description or comment count."
  type DashboardTask {
    id: Int!
    title: String!
    projectName: String!
    status: String!
    assigneeName: String!
    updatedAt: String!
  }

  "The dashboard card's project: the listing row without the creation date."
  type DashboardProject {
    id: Int!
    name: String!
    description: String!
    taskCount: Int!
    openTaskCount: Int!
    peopleCount: Int!
  }

  type Dashboard {
    stats: DashboardStats!
    recentTasks: [DashboardTask!]!
    projects: [DashboardProject!]!
  }

  # -------------------------------------------------------------------------
  # Writes
  # -------------------------------------------------------------------------

  "The REST write envelope verbatim: where the SPA navigates next, and what it shows."
  type MutationOutcome {
    ok: Boolean!
    message: String
    redirectTo: String
  }

  type Mutation {
    createProject(name: String, description: String): MutationOutcome!
    updateProject(id: Int!, name: String, description: String): MutationOutcome!
    deleteProject(id: Int!): MutationOutcome!

    createUser(name: String, email: String): MutationOutcome!
    updateUser(id: Int!, name: String, email: String): MutationOutcome!
    deleteUser(id: Int!): MutationOutcome!

    createTask(
      projectId: String
      assigneeId: String
      title: String
      description: String
      status: String
    ): MutationOutcome!

    "ONE transaction: the task and its first comment are written together, or neither is."
    createTaskWithComment(
      projectId: String
      assigneeId: String
      title: String
      description: String
      status: String
      commentBody: String
      commentAuthorId: String
    ): MutationOutcome!

    updateTask(
      id: Int!
      title: String
      description: String
      status: String
      assigneeId: String
    ): MutationOutcome!

    deleteTask(id: Int!): MutationOutcome!

    "Adds a comment to an existing task. The reply is \`{ ok }\` alone: the user stays on the page."
    addTaskComment(taskId: Int!, body: String, authorId: String): MutationOutcome!
  }
`;
