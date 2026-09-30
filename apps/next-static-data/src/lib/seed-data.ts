import type {
  Comment,
  DashboardProject,
  DashboardStats,
  DashboardTask,
  Project,
  Task,
  TaskWithProject,
  User,
} from "@/types";

export const projects: Project[] = [
  {
    id: 1,
    name: "Website redesign",
    description: "Refresh the public website and onboarding experience.",
    taskCount: 3,
    openTaskCount: 2,
    createdAt: "2026-09-27",
  },
  {
    id: 2,
    name: "Mobile application",
    description:
      "Ship the first mobile experience for existing workspace members.",
    taskCount: 2,
    openTaskCount: 2,
    createdAt: "2026-09-21",
  },
  {
    id: 3,
    name: "Platform migration",
    description:
      "Move the service and supporting processes to the new platform.",
    taskCount: 1,
    openTaskCount: 1,
    createdAt: "2026-09-12",
  },
];

export const projectTasks: Record<number, Task[]> = {
  1: [
    {
      id: 101,
      projectId: 1,
      title: "Draft navigation model",
      description:
        "Map the navigation structure for the public and authenticated product areas.",
      status: "in progress",
      assigneeName: "Robin Andrew",
      commentCount: 2,
      updatedAt: "Today",
    },
    {
      id: 102,
      projectId: 1,
      title: "Confirm breakpoint rules",
      description:
        "Agree the breakpoints the shared layout tokens are generated from.",
      status: "todo",
      assigneeName: "Alex Morgan",
      commentCount: 0,
      updatedAt: "Today",
    },
    {
      id: 103,
      projectId: 1,
      title: "Prepare content inventory",
      description:
        "Collect the copy and imagery currently live across the public pages.",
      status: "done",
      assigneeName: "Sam Taylor",
      commentCount: 0,
      updatedAt: "Yesterday",
    },
  ],
  2: [
    {
      id: 104,
      projectId: 2,
      title: "Review API response shapes",
      description:
        "Check the client expectations against the shapes the service returns.",
      status: "todo",
      assigneeName: "Alex Morgan",
      commentCount: 1,
      updatedAt: "Yesterday",
    },
    {
      id: 105,
      projectId: 2,
      title: "Build profile screen",
      description:
        "Implement the profile screen for existing workspace members.",
      status: "in progress",
      assigneeName: "Robin Andrew",
      commentCount: 0,
      updatedAt: "2 days ago",
    },
  ],
  3: [
    {
      id: 106,
      projectId: 3,
      title: "Write migration checklist",
      description: "List the steps and owners for moving to the new platform.",
      status: "todo",
      assigneeName: "Sam Taylor",
      commentCount: 0,
      updatedAt: "3 days ago",
    },
  ],
};

export const taskComments: Comment[] = [
  {
    id: 1,
    taskId: 101,
    authorName: "Alex Morgan",
    body: "I have added the initial content grouping for review.",
    createdAt: "Today, 09:42",
  },
  {
    id: 2,
    taskId: 101,
    authorName: "Robin Andrew",
    body: "Thanks — I will use that to confirm the signed-in navigation.",
    createdAt: "Today, 10:18",
  },
  {
    id: 3,
    taskId: 104,
    authorName: "Alex Morgan",
    body: "The list endpoint drops the total count, worth confirming.",
    createdAt: "Yesterday, 15:05",
  },
];

export const dashboardStats: DashboardStats = {
  projectCount: 3,
  totalTasks: 6,
  openTasks: 5,
  peopleCount: 3,
  todoTasks: 3,
  inProgressTasks: 2,
  doneTasks: 1,
};

export const dashboardRecentTasks: DashboardTask[] = [
  {
    id: 101,
    title: "Draft navigation model",
    projectName: "Website redesign",
    status: "in progress",
    assigneeName: "Robin Andrew",
    updatedAt: "Today",
  },
  {
    id: 102,
    title: "Confirm breakpoint rules",
    projectName: "Website redesign",
    status: "todo",
    assigneeName: "Alex Morgan",
    updatedAt: "Today",
  },
  {
    id: 104,
    title: "Review API response shapes",
    projectName: "Mobile application",
    status: "todo",
    assigneeName: "Alex Morgan",
    updatedAt: "Yesterday",
  },
];

export const dashboardProjects: DashboardProject[] = [
  {
    id: 1,
    name: "Website redesign",
    description: "Refresh the public website and onboarding experience.",
    taskCount: 3,
    openTaskCount: 2,
    peopleCount: 3,
  },
  {
    id: 2,
    name: "Mobile application",
    description: "Ship the first mobile experience for workspace members.",
    taskCount: 2,
    openTaskCount: 2,
    peopleCount: 2,
  },
];

export const people: User[] = [
  {
    id: 1,
    name: "Robin Andrew",
    email: "robin@example.test",
    assignedTaskCount: 2,
    openTaskCount: 2,
    commentCount: 1,
  },
  {
    id: 2,
    name: "Alex Morgan",
    email: "alex@example.test",
    assignedTaskCount: 2,
    openTaskCount: 2,
    commentCount: 1,
  },
  {
    id: 3,
    name: "Sam Taylor",
    email: "sam@example.test",
    assignedTaskCount: 2,
    openTaskCount: 1,
    commentCount: 0,
  },
];

// Derived from projectTasks so the workspace-wide list cannot drift
// from the per-project seed data.
export const allTasks: TaskWithProject[] = Object.entries(projectTasks).flatMap(
  ([projectId, tasks]) => {
    const projectName =
      projects.find((project) => project.id === Number(projectId))?.name ?? "";

    return tasks.map((task) => ({ ...task, projectName }));
  },
);
