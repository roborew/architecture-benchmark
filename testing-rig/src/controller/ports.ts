// Host-port allocation (plan §5). Ports are allocated once per (run, variant)
// and are stable across that variant's trials so image digests stay comparable.

import net from "node:net";

/**
 * Ask the kernel for `count` free TCP ports by binding listeners to port 0.
 *
 * All listeners are held open until every port is known, so the kernel cannot
 * hand the same port to two calls in the same batch. The listeners are then
 * closed; the window between close and Compose binding is the usual (small)
 * TOCTOU race inherent to ephemeral-port allocation.
 */
export async function allocateDistinctHostPorts(count: number): Promise<number[]> {
  if (count < 0 || !Number.isInteger(count)) {
    throw new Error(`port count must be a non-negative integer (got ${count})`);
  }

  const servers: net.Server[] = [];
  const ports: number[] = [];
  try {
    for (let i = 0; i < count; i += 1) {
      const server = net.createServer();
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("could not read the allocated port from the listener");
      }
      ports.push(address.port);
    }
    return ports;
  } finally {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  }
}

/** Allocate one port per env name, in the given order. */
export async function allocateHostPorts(envNames: readonly string[]): Promise<Record<string, number>> {
  const ports = await allocateDistinctHostPorts(envNames.length);
  return Object.fromEntries(envNames.map((name, i) => [name, ports[i]!]));
}
