// src/lib/api.ts
//
// The fetch client for the Express backend. Every call goes through here so
// the base URL, the error envelope ({ error }), and the JSON handling are
// decided in exactly one place.

import type { User } from "@/lib/types";

/** Where the Express API lives. Overridable per environment (e2e points it at its own server). */
export const API_URL: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);

  if (!response.ok) {
    // The API's error envelope is { error }, but a proxy or a crash can
    // hand back anything; the status is the only guaranteed fact.
    let message = `Request failed with ${response.status}`;

    try {
      const body = (await response.json()) as { error?: string };
      if (body && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // Not JSON — keep the status-based message.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/**
 * The People listing rows. An empty term returns every member; a term filters
 * server-side (ILIKE on name and email).
 */
export function getUsers(term = ""): Promise<User[]> {
  const params = new URLSearchParams();

  if (term) {
    params.set("q", term);
  }

  const query = params.toString();

  return requestJson<User[]>(`/api/users${query ? `?${query}` : ""}`);
}

export function getTasks(term = ""): Promise<User[]> {
  const params = new URLSearchParams();

  if (term) {
    params.set("q", term);
  }

  const query = params.toString();

  return requestJson<User[]>(`/api/tasks${query ? `?${query}` : ""}`);
}
