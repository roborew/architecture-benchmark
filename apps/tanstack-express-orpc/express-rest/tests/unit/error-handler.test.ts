// tests/unit/error-handler.test.ts
//
// The error handler's mapping contract: a controller's HttpError becomes its
// exact JSON envelope; a malformed JSON body becomes a 400; anything else is
// logged once and answered with the generic 500. No database, no supertest —
// the response is a fake.

import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../../src/lib/http-error.ts";
import { errorHandler } from "../../src/middleware/error-handler.ts";

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function invoke(error: unknown) {
  const res = makeResponse();
  const next = vi.fn();

  errorHandler(error, {} as never, res as never, next as never);

  return res;
}

describe("errorHandler", () => {
  it("maps a HttpError to its own status and payload, untouched", () => {
    const res = invoke(
      HttpError.validation("Missing fields. Failed to create task.", {
        title: ["Title is required."],
      }),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing fields. Failed to create task.",
      errors: { title: ["Title is required."] },
    });
  });

  it("maps a 404 HttpError to the plain envelope", () => {
    const res = invoke(HttpError.notFound("That task no longer exists."));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "That task no longer exists.",
    });
  });

  it("maps a 409 HttpError to the reference guard message", () => {
    const res = invoke(
      HttpError.conflict(
        "This project still has 1 task. Delete it before deleting the project.",
      ),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error:
        "This project still has 1 task. Delete it before deleting the project.",
    });
  });

  it("answers a malformed JSON body as a 400, not a server fault", () => {
    const parseError = Object.assign(new SyntaxError("Unexpected token"), {
      status: 400,
      type: "entity.parse.failed",
    });

    const res = invoke(parseError);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid JSON body" });
  });

  it("logs an unknown error once and answers the generic 500 envelope", () => {
    const error = new Error("db down");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = makeResponse();

    try {
      errorHandler(error, {} as never, res as never, vi.fn() as never);

      expect(log).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    } finally {
      log.mockRestore();
    }
  });
});

describe("HttpError", () => {
  it("carries the envelope's error line as its message, for logs and tests", () => {
    expect(new HttpError(404, { error: "Not found" }).message).toBe(
      "Not found",
    );
    expect(new HttpError(503, {}).message).toBe("HTTP 503");
  });
});
