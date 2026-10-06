// E2E specs assert against real rendered data, so unlike the unit
// tests they need concrete values. They live here, in one place, so
// moving to a database means loading this fixture into the database
// rather than rewriting every spec.
//
// Keep in sync with the app's seed data until the data layer moves.

export const E2E_FIXTURE = {
  project: {
    name: "Website redesign",
    href: "/projects/1",
    secondName: "Mobile application",
  },
  task: {
    title: "Draft navigation model",
    href: "/tasks/101",
    projectName: "Website redesign",
    // Newest updated first, so page one is tasks 101, 102, 105 and 103.
    // "Build profile screen" is the task from a second project that page one
    // contains; 104 is the oldest and lands on page two.
    crossProjectTitle: "Build profile screen",
    crossProjectName: "Mobile application",
    description:
      "Map the navigation structure for the public and authenticated product areas.",
    commentCount: 2,
  },
  person: {
    name: "Robin Andrew",
    email: "robin@example.test",
    href: "/users/1",
    assignedTaskTitles: ["Draft navigation model", "Build profile screen"],
  },
  counts: {
    people: 3,
    projects: 3,
    totalTasks: 6,
  },
  // Page size and row count are both implementation details, so the
  // shape is asserted rather than the exact figures.
  pagination: {
    summary: /Showing 1-\d+ of \d+/,
    hasMore: true,
  },
} as const;

export function projectCountLabel(count: number) {
  return `${count} project${count === 1 ? "" : "s"}`;
}

export function peopleCountLabel(count: number) {
  return `${count} people`;
}
