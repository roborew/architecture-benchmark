import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL, ApiError, getTasks, getUsers } from "./api";

// The fetch client is exercised against a stubbed global fetch: what URL it
// builds for every read, what it returns, how it surfaces the API's JSON error
// envelope — and, for the mutations, the method, path and JSON body each one
// sends. The client is the SPA's only copy of the REST contract, so this file
// is where that contract is pinned.

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function nonJsonResponse(status: number): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.reject(new Error("Unexpected token in JSON")),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/** The URL and request init of the first call. */
function firstCall(): [url: string, init: RequestInit | undefined] {
  return fetchMock.mock.calls[0] as [string, RequestInit | undefined];
}

/** The query params of the first call's URL. */
function firstParams(): URLSearchParams {
  const [url] = firstCall();

  return new URL(url as string).searchParams;
}

/** The parsed JSON body of the first call. */
function firstBody(): Record<string, unknown> {
  const [, init] = firstCall();

  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("getUsers", () => {
  it("requests the users endpoint with no query for an empty term", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await getUsers("");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/api/users`);
  });

  it("encodes the search term as the q param", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await getUsers("Robin Andrew");

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/users");
    expect(parsed.searchParams.get("q")).toBe("Robin Andrew");
  });

  it("returns the parsed rows", async () => {
    const people = [
      {
        id: 1,
        name: "Robin Andrew",
        email: "robin@example.test",
        assignedTaskCount: 2,
        openTaskCount: 2,
        commentCount: 1,
      },
    ];
    fetchMock.mockResolvedValue(jsonResponse(people));

    await expect(getUsers()).resolves.toEqual(people);
  });

  it("throws the server's error message on a failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "q must be a single value" }, 400),
    );

    await expect(getUsers("robin")).rejects.toThrow("q must be a single value");
  });

  it("falls back to the status when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(nonJsonResponse(500));

    await expect(getUsers()).rejects.toThrow("Request failed with 500");
  });
});

describe("read endpoints", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse([]));
  });

  it("lists projects with the search term as q", async () => {
    const { getProjects } = await import("./api");

    await getProjects("redesign");

    const [url] = firstCall();
    expect(new URL(url).pathname).toBe("/api/projects");
    expect(firstParams().get("q")).toBe("redesign");
  });

  it("omits the query entirely for an empty project term", async () => {
    const { getProjects } = await import("./api");

    await getProjects("");

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/projects`);
  });

  it("fetches one project by id", async () => {
    const { getProject } = await import("./api");

    await getProject(3);

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/projects/3`);
  });

  it("fetches a project's board tasks with status, cursor and limit", async () => {
    const { getProjectTasks } = await import("./api");

    await getProjectTasks(3, {
      status: "in progress",
      cursor: "Y3Vyc29y",
      limit: 6,
    });

    const [url] = firstCall();
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/projects/3/tasks");
    expect(parsed.searchParams.get("status")).toBe("in progress");
    expect(parsed.searchParams.get("cursor")).toBe("Y3Vyc29y");
    expect(parsed.searchParams.get("limit")).toBe("6");
  });

  it("omits absent board filters rather than sending empties", async () => {
    const { getProjectTasks } = await import("./api");

    await getProjectTasks(3);

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/projects/3/tasks`);
  });

  it("lists tasks with every filter the workspace route offers", async () => {
    await getTasks({
      q: "navigation",
      status: "todo",
      projectId: 2,
      assigneeId: 4,
      cursor: "Y3Vyc29y",
      limit: 6,
    });

    const [url] = firstCall();
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/tasks");
    expect(parsed.searchParams.get("q")).toBe("navigation");
    expect(parsed.searchParams.get("status")).toBe("todo");
    expect(parsed.searchParams.get("projectId")).toBe("2");
    expect(parsed.searchParams.get("assigneeId")).toBe("4");
    expect(parsed.searchParams.get("cursor")).toBe("Y3Vyc29y");
    expect(parsed.searchParams.get("limit")).toBe("6");
  });

  it("omits absent task filters rather than sending empties", async () => {
    await getTasks();

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks`);
  });

  it("encodes a status with a space without hand-encoding it", async () => {
    await getTasks({ status: "in progress" });

    expect(firstParams().get("status")).toBe("in progress");
  });

  it("counts tasks through the count endpoint", async () => {
    const { getTaskCount } = await import("./api");

    fetchMock.mockResolvedValue(jsonResponse({ count: 7 }));

    await expect(getTaskCount({ q: "draft", status: "todo" })).resolves.toBe(7);

    const [url] = firstCall();
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/tasks/count");
    expect(parsed.searchParams.get("q")).toBe("draft");
    expect(parsed.searchParams.get("status")).toBe("todo");
  });

  it("fetches one task by id", async () => {
    const { getTask } = await import("./api");

    await getTask(9);

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks/9`);
  });

  it("fetches a task's comments by id", async () => {
    const { getComments } = await import("./api");

    await getComments(9);

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks/9/comments`);
  });

  it("fetches one user by id", async () => {
    const { getUser } = await import("./api");

    await getUser(4);

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/users/4`);
  });

  it("fetches a user's assigned tasks by id", async () => {
    const { getUserTasks } = await import("./api");

    await getUserTasks(4);

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/users/4/tasks`);
  });

  it("fetches the dashboard aggregate", async () => {
    const { getDashboard } = await import("./api");

    const dashboard = {
      stats: {},
      recentTasks: [],
      projects: [],
    };
    fetchMock.mockResolvedValue(jsonResponse(dashboard));

    await expect(getDashboard()).resolves.toEqual(dashboard);

    const [url] = firstCall();
    expect(url).toBe(`${API_URL}/api/dashboard`);
  });
});

describe("ApiError", () => {
  it("carries the status and the field → messages map from the 400 body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: "Missing fields. Failed to create task.",
          errors: { title: ["Title is required."] },
        },
        400,
      ),
    );

    const rejection = getTasks();
    await expect(rejection).rejects.toBeInstanceOf(ApiError);

    try {
      await getTasks();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      if (error instanceof ApiError) {
        expect(error.status).toBe(400);
        expect(error.message).toBe("Missing fields. Failed to create task.");
        expect(error.errors).toEqual({ title: ["Title is required."] });
      }
    }
  });

  it("keeps an empty errors map when the body carries none", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "That task no longer exists." }, 404),
    );

    try {
      await getTasks();
      expect.unreachable("the request must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      if (error instanceof ApiError) {
        expect(error.status).toBe(404);
        expect(error.errors).toEqual({});
      }
    }
  });
});

describe("mutations", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, message: "Saved.", redirectTo: "/tasks/9" }),
    );
  });

  it("creates a project with a POST and a JSON body", async () => {
    const { createProject } = await import("./api");

    await createProject({ name: "Website redesign", description: "Refresh" });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/projects`);
    expect(init?.method).toBe("POST");
    expect(firstBody()).toEqual({
      name: "Website redesign",
      description: "Refresh",
    });
  });

  it("updates a project with a PATCH to its id", async () => {
    const { updateProject } = await import("./api");

    await updateProject(3, { name: "Renamed", description: "" });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/projects/3`);
    expect(init?.method).toBe("PATCH");
  });

  it("deletes a project with a DELETE to its id", async () => {
    const { deleteProject } = await import("./api");

    await deleteProject(3);

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/projects/3`);
    expect(init?.method).toBe("DELETE");
  });

  it("creates a user with a POST", async () => {
    const { createUser } = await import("./api");

    await createUser({ name: "Robin", email: "robin@example.test" });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/users`);
    expect(init?.method).toBe("POST");
  });

  it("updates a user with a PATCH to its id", async () => {
    const { updateUser } = await import("./api");

    await updateUser(4, { name: "Robin", email: "robin@example.test" });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/users/4`);
    expect(init?.method).toBe("PATCH");
  });

  it("deletes a user with a DELETE to its id", async () => {
    const { deleteUser } = await import("./api");

    await deleteUser(4);

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/users/4`);
    expect(init?.method).toBe("DELETE");
  });

  it("creates a task with the form's fields passed through", async () => {
    const { createTask } = await import("./api");

    await createTask({
      projectId: "2",
      assigneeId: "",
      title: "Draft the model",
      description: "",
      status: "todo",
    });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks`);
    expect(init?.method).toBe("POST");
    // The empty assignee travels as the form submitted it — the server owns
    // the one normalisation rule ("" means unassigned), so the client cannot
    // disagree with itself about it.
    expect(firstBody()).toEqual({
      projectId: "2",
      assigneeId: "",
      title: "Draft the model",
      description: "",
      status: "todo",
    });
  });

  it("updates a task with a PATCH to its id", async () => {
    const { updateTask } = await import("./api");

    await updateTask(9, {
      title: "Draft the model",
      description: "",
      status: "in progress",
      assigneeId: "4",
    });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks/9`);
    expect(init?.method).toBe("PATCH");
  });

  it("deletes a task with a DELETE to its id", async () => {
    const { deleteTask } = await import("./api");

    await deleteTask(9);

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks/9`);
    expect(init?.method).toBe("DELETE");
  });

  it("creates a task with its first comment atomically", async () => {
    const { createTaskWithComment } = await import("./api");

    await createTaskWithComment({
      projectId: "2",
      assigneeId: "",
      title: "Draft the model",
      description: "",
      status: "todo",
      commentBody: "Kicking this off.",
      commentAuthorId: "4",
    });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks/with-comment`);
    expect(init?.method).toBe("POST");
  });

  it("adds a comment with the endpoint's own field names", async () => {
    const { createComment } = await import("./api");

    await createComment(9, { body: "Notes here.", authorId: "4" });

    const [url, init] = firstCall();
    expect(url).toBe(`${API_URL}/api/tasks/9/comments`);
    expect(init?.method).toBe("POST");
    expect(firstBody()).toEqual({ body: "Notes here.", authorId: "4" });
  });

  it("resolves the API's outcome envelope", async () => {
    const { createTask } = await import("./api");

    await expect(createTask({ title: "Draft" })).resolves.toEqual({
      ok: true,
      message: "Saved.",
      redirectTo: "/tasks/9",
    });
  });

  it("rejects with an ApiError carrying the guard message on a 409", async () => {
    const { deleteProject } = await import("./api");

    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Delete the project's tasks first." }, 409),
    );

    try {
      await deleteProject(3);
      expect.unreachable("the request must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      if (error instanceof ApiError) {
        expect(error.status).toBe(409);
        expect(error.message).toBe("Delete the project's tasks first.");
      }
    }
  });
});
