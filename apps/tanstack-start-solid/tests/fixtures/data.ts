// GENERATED FILE — do not edit by hand.

import type {
  Comment,
  DashboardProject,
  DashboardStats,
  DashboardTask,
  Project,
  Task,
  TaskWithProject,
  User,
} from "@/lib/types";

export const projects: Project[] = [
  {
    "id": 1,
    "name": "Website redesign",
    "description": "Refresh the public website and onboarding experience.",
    "taskCount": 3,
    "openTaskCount": 2,
    "peopleCount": 3,
    "createdAt": "2026-09-27"
  },
  {
    "id": 2,
    "name": "Mobile application",
    "description": "Ship the first mobile experience for existing workspace members.",
    "taskCount": 2,
    "openTaskCount": 2,
    "peopleCount": 2,
    "createdAt": "2026-09-21"
  },
  {
    "id": 3,
    "name": "Platform migration",
    "description": "Move the service and supporting processes to the new platform.",
    "taskCount": 1,
    "openTaskCount": 1,
    "peopleCount": 1,
    "createdAt": "2026-09-12"
  }
];

export const projectTasks: Record<number, Task[]> = {
  "1": [
    {
      "id": 101,
      "projectId": 1,
      "title": "Draft navigation model",
      "description": "Map the navigation structure for the public and authenticated product areas.",
      "status": "in progress",
      "assigneeName": "Robin Andrew",
      "commentCount": 2,
      "updatedAt": "2026-09-29T08:00:00Z"
    },
    {
      "id": 102,
      "projectId": 1,
      "title": "Confirm breakpoint rules",
      "description": "Agree the breakpoints the shared layout tokens are generated from.",
      "status": "todo",
      "assigneeName": "Alex Morgan",
      "commentCount": 0,
      "updatedAt": "2026-09-28T11:20:00Z"
    },
    {
      "id": 103,
      "projectId": 1,
      "title": "Prepare content inventory",
      "description": "Collect the copy and imagery currently live across the public pages.",
      "status": "done",
      "assigneeName": "Sam Taylor",
      "commentCount": 0,
      "updatedAt": "2026-09-27T16:45:00Z"
    }
  ],
  "2": [
    {
      "id": 104,
      "projectId": 2,
      "title": "Review API response shapes",
      "description": "Check the client expectations against the shapes the service returns.",
      "status": "todo",
      "assigneeName": "Alex Morgan",
      "commentCount": 1,
      "updatedAt": "2026-09-26T10:00:00Z"
    },
    {
      "id": 105,
      "projectId": 2,
      "title": "Build profile screen",
      "description": "Implement the profile screen for existing workspace members.",
      "status": "in progress",
      "assigneeName": "Robin Andrew",
      "commentCount": 0,
      "updatedAt": "2026-09-28T09:30:00Z"
    }
  ],
  "3": [
    {
      "id": 106,
      "projectId": 3,
      "title": "Write migration checklist",
      "description": "List the steps and owners for moving to the new platform.",
      "status": "todo",
      "assigneeName": "Sam Taylor",
      "commentCount": 0,
      "updatedAt": "2026-09-23T11:20:00Z"
    }
  ]
};

export const taskComments: Comment[] = [
  {
    "id": 1,
    "taskId": 101,
    "authorName": "Alex Morgan",
    "body": "I have added the initial content grouping for review.",
    "createdAt": "2026-09-29T09:42:00Z"
  },
  {
    "id": 2,
    "taskId": 101,
    "authorName": "Robin Andrew",
    "body": "Thanks - I will use that to confirm the signed-in navigation.",
    "createdAt": "2026-09-29T10:18:00Z"
  },
  {
    "id": 3,
    "taskId": 104,
    "authorName": "Alex Morgan",
    "body": "The list endpoint drops the total count which is worth confirming.",
    "createdAt": "2026-09-28T15:05:00Z"
  }
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
    "id": 101,
    "title": "Draft navigation model",
    "projectName": "Website redesign",
    "status": "in progress",
    "assigneeName": "Robin Andrew",
    "updatedAt": "2026-09-29T08:00:00Z"
  },
  {
    "id": 102,
    "title": "Confirm breakpoint rules",
    "projectName": "Website redesign",
    "status": "todo",
    "assigneeName": "Alex Morgan",
    "updatedAt": "2026-09-28T11:20:00Z"
  },
  {
    "id": 105,
    "title": "Build profile screen",
    "projectName": "Mobile application",
    "status": "in progress",
    "assigneeName": "Robin Andrew",
    "updatedAt": "2026-09-28T09:30:00Z"
  }
];

export const dashboardProjects: DashboardProject[] = [
  {
    "id": 1,
    "name": "Website redesign",
    "description": "Refresh the public website and onboarding experience.",
    "taskCount": 3,
    "openTaskCount": 2,
    "peopleCount": 3
  },
  {
    "id": 2,
    "name": "Mobile application",
    "description": "Ship the first mobile experience for existing workspace members.",
    "taskCount": 2,
    "openTaskCount": 2,
    "peopleCount": 2
  }
];

export const people: User[] = [
  {
    "id": 1,
    "name": "Robin Andrew",
    "email": "robin@example.test",
    "assignedTaskCount": 2,
    "openTaskCount": 2,
    "commentCount": 1
  },
  {
    "id": 2,
    "name": "Alex Morgan",
    "email": "alex@example.test",
    "assignedTaskCount": 2,
    "openTaskCount": 2,
    "commentCount": 2
  },
  {
    "id": 3,
    "name": "Sam Taylor",
    "email": "sam@example.test",
    "assignedTaskCount": 2,
    "openTaskCount": 1,
    "commentCount": 0
  }
];

export const allTasks: TaskWithProject[] = Object.entries(projectTasks).flatMap(
  ([projectId, projectTaskList]) => {
    const name =
      projects.find((project) => project.id === Number(projectId))?.name ?? "";
    return projectTaskList.map((task) => ({ ...task, projectName: name }));
  },
);
