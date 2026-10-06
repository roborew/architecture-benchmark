// tests/unit/users.controller.test.ts
//
// The controller's HTTP contract with the model stubbed: what it sends to the
// model, what it writes to the response, and what it does when the model
// fails. No database, no supertest — the model is a fake.

import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import { createUsersController } from "../../src/users/users.controller.ts";
import type { UsersModel } from "../../src/users/users.model.ts";

function makeModel(list: UsersModel["list"]): UsersModel {
  return { list };
}

function makeRequest(query: Record<string, unknown> = {}): Request {
  return { query } as unknown as Request;
}

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

type MockResponse = ReturnType<typeof makeResponse>;

function asExpressResponse(res: MockResponse): Response {
  return res as unknown as Response;
}

describe("UsersController.list", () => {
  it("responds 200 with the model's rows as JSON", async () => {
    const users = [
      {
        id: 1,
        name: "Unit Person",
        email: "unit@example.test",
        assignedTaskCount: 0,
        openTaskCount: 0,
        commentCount: 0,
      },
    ];
    const model = makeModel(vi.fn().mockResolvedValue(users));
    const res = makeResponse();

    await createUsersController(model).list(
      makeRequest(),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(users);
  });

  it("passes a trimmed q to the model", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel(list);

    await createUsersController(model).list(
      makeRequest({ q: "  robin  " }),
      asExpressResponse(makeResponse()),
    );

    expect(list).toHaveBeenCalledWith("robin");
  });

  it("treats a missing q as an empty term", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel(list);

    await createUsersController(model).list(
      makeRequest(),
      asExpressResponse(makeResponse()),
    );

    expect(list).toHaveBeenCalledWith("");
  });

  it("rejects when the model rejects, so Express forwards to the error handler", async () => {
    const model = makeModel(vi.fn().mockRejectedValue(new Error("db down")));

    // Express 5 treats a rejected async handler as next(err); the controller
    // must not swallow the rejection into a bogus 200.
    await expect(
      createUsersController(model).list(
        makeRequest(),
        asExpressResponse(makeResponse()),
      ),
    ).rejects.toThrow("db down");
  });

  it("responds 400 with the error envelope when q is an array", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel(list);
    const res = makeResponse();

    await createUsersController(model).list(
      makeRequest({ q: ["robin", "sam"] }),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "q must be a single value",
    });
    // No query may run for a request the API refused.
    expect(list).not.toHaveBeenCalled();
  });

  it("responds 400 when q exceeds 100 characters", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel(list);
    const res = makeResponse();

    await createUsersController(model).list(
      makeRequest({ q: "a".repeat(101) }),
      asExpressResponse(res),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "q must be at most 100 characters",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("passes a 100-character q through as valid", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const model = makeModel(list);

    await createUsersController(model).list(
      makeRequest({ q: "a".repeat(100) }),
      asExpressResponse(makeResponse()),
    );

    expect(list).toHaveBeenCalledWith("a".repeat(100));
  });
});
