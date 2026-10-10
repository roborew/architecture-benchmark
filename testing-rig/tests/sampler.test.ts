import { describe, expect, it } from "vitest";
import {
  capsForRole,
  coresInUse,
  generatorCpuPercent,
  parseCliStats,
  parseComposePs,
  parseMemString,
  parseRawStats,
  percentOfEnvelope,
  resolveDockerEndpoint,
  ResourceSampler,
  summariseSamples,
  workingSetBytes,
  type SamplerFetcher,
  type TickReading,
} from "../src/controller/sampler.js";

// Docker-free tests over fixture Engine-API JSON (plan U2/§5). No daemon touches.

describe("counter math (plan U2)", () => {
  it("computes cores in use from the raw cpu deltas", () => {
    // 1e9 ns of container CPU over 2e9 ns of host CPU, on a 4-core host → 2 cores.
    expect(
      coresInUse(
        { totalUsage: 3e9, systemUsage: 4e9, onlineCpus: 4 },
        { totalUsage: 2e9, systemUsage: 2e9, onlineCpus: 4 },
      ),
    ).toBe(2);
  });

  it("returns null on a zero-delta first sample (never a fake 0)", () => {
    expect(
      coresInUse(
        { totalUsage: 100, systemUsage: 50, onlineCpus: 4 },
        { totalUsage: 100, systemUsage: 50, onlineCpus: 4 },
      ),
    ).toBeNull();
    expect(
      coresInUse(
        { totalUsage: 100, systemUsage: null, onlineCpus: 4 },
        { totalUsage: 0, systemUsage: 0, onlineCpus: 4 },
      ),
    ).toBeNull();
  });

  it("computes the working set for cgroup v2 (inactive_file) and v1 (total_inactive_file)", () => {
    expect(
      workingSetBytes({
        usage: 100 * 1024 ** 2,
        inactiveFile: 40 * 1024 ** 2,
        limit: null,
        oomKill: null,
      }),
    ).toBe(60 * 1024 ** 2);
    const v1 = parseRawStats({
      memory_stats: {
        usage: 100 * 1024 ** 2,
        stats: { total_inactive_file: 10 * 1024 ** 2 },
      },
    });
    expect(workingSetBytes(v1!.mem)).toBe(90 * 1024 ** 2);
  });

  it("never returns a negative working set", () => {
    expect(
      workingSetBytes({
        usage: 10,
        inactiveFile: 100,
        limit: null,
        oomKill: null,
      }),
    ).toBe(0);
  });

  it("computes percent of envelope, blank when uncapped", () => {
    expect(percentOfEnvelope(2, 2)).toBe(100);
    expect(percentOfEnvelope(1, 8)).toBe(12.5);
    expect(percentOfEnvelope(1, null)).toBeNull();
    expect(percentOfEnvelope(null, 2)).toBeNull();
    expect(percentOfEnvelope(1, 0)).toBeNull();
  });

  it("reads OOM kills from memory_stats.events.oom_kill", () => {
    const stats = parseRawStats({
      cpu_stats: {
        cpu_usage: { total_usage: 1 },
        system_cpu_usage: 2,
        online_cpus: 4,
      },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 1 },
      memory_stats: {
        usage: 1000,
        limit: 2000,
        stats: { inactive_file: 100 },
        events: { oom_kill: 3 },
      },
    });
    expect(stats).not.toBeNull();
    expect(stats!.mem.oomKill).toBe(3);
    expect(stats!.mem.inactiveFile).toBe(100);
    expect(stats!.mem.limit).toBe(2000);
  });

  it("maps roles to their effective envelope caps", () => {
    const caps = { appCpus: 2, appMemoryMb: 2048, dbCpus: 1, dbMemoryMb: 1024 };
    expect(capsForRole("app", caps)).toEqual({ cpus: 2, memoryMb: 2048 });
    expect(capsForRole("api", caps)).toEqual({ cpus: 2, memoryMb: 2048 });
    expect(capsForRole("spa", caps)).toEqual({ cpus: 2, memoryMb: 2048 });
    expect(capsForRole("db", caps)).toEqual({ cpus: 1, memoryMb: 1024 });
    expect(capsForRole("generator", caps)).toBeNull();
  });
});

describe("folding samples into aggregates", () => {
  it("folds per-service maxima/averages and carries the OOM delta", () => {
    const summary = summariseSamples(
      [
        {
          t: 0,
          service: "app",
          cores: 1,
          cpuPctOfEnv: 50,
          memWorkingSetMb: 100,
          memPctOfEnv: 25,
        },
        {
          t: 1000,
          service: "app",
          cores: 2,
          cpuPctOfEnv: 100,
          memWorkingSetMb: 300,
          memPctOfEnv: 75,
        },
        {
          t: 1000,
          service: "db",
          cores: 0.5,
          cpuPctOfEnv: 25,
          memWorkingSetMb: 50,
          memPctOfEnv: 10,
        },
      ],
      2,
      "api",
    );
    expect(summary.source).toBe("api");
    expect(summary.oomKills).toBe(2);
    expect(summary.services.app).toEqual({
      maxCpuPctOfEnv: 100,
      avgCpuPctOfEnv: 75,
      maxMemMb: 300,
      maxMemPctOfEnv: 75,
    });
    expect(summary.services.db!.maxCpuPctOfEnv).toBe(25);
  });

  it("keeps a service with no usable values blank, never zero", () => {
    const summary = summariseSamples(
      [
        {
          t: 0,
          service: "app",
          cores: null,
          cpuPctOfEnv: null,
          memWorkingSetMb: null,
          memPctOfEnv: null,
        },
      ],
      null,
      "cli",
    );
    expect(summary.services.app).toEqual({
      maxCpuPctOfEnv: null,
      avgCpuPctOfEnv: null,
      maxMemMb: null,
      maxMemPctOfEnv: null,
    });
    expect(summary.oomKills).toBeNull();
  });
});

describe("ResourceSampler loop", () => {
  it("samples each tick, folds the series, and deltas the OOM counter", async () => {
    let tick = 0;
    const fetcher: SamplerFetcher = {
      source: "api",
      async fetch(): Promise<TickReading[]> {
        tick += 1;
        return [
          {
            role: "app",
            cores: tick * 0.5,
            memWorkingSetBytes: tick * 100 * 1024 ** 2,
            oomKill: tick === 1 ? 0 : 2,
          },
          {
            role: "generator",
            cores: 0.25,
            memWorkingSetBytes: null,
            oomKill: null,
          },
        ];
      },
    };
    const sampler = new ResourceSampler({
      fetcher,
      targets: [
        { role: "app", id: "abc" },
        { role: "generator", name: "bench-k6-x" },
      ],
      caps: { appCpus: 2, appMemoryMb: 2048, dbCpus: 2, dbMemoryMb: 2048 },
      intervalMs: 1_000_000,
    });
    await sampler.start();
    const capture = await sampler.stop();

    // start() ticks once, stop() closes with one more → two samples per target.
    expect(capture.source).toBe("api");
    expect(capture.intervalMs).toBe(1_000_000);
    expect(capture.samples).toHaveLength(4);
    // app: 0.5 core and 1.0 core on a 2-CPU envelope → 25% then 50%.
    expect(capture.summary.services.app!.maxCpuPctOfEnv).toBe(50);
    expect(capture.summary.services.app!.avgCpuPctOfEnv).toBe(37.5);
    // OOM 0 → 2 across the window.
    expect(capture.summary.oomKills).toBe(2);
    // The generator is uncapped: cores recorded, no envelope percentage.
    const generatorSample = capture.samples.find(
      (s) => s.service === "generator",
    )!;
    expect(generatorSample.cpuPctOfEnv).toBeNull();
    expect(generatorSample.cores).toBe(0.25);
    // Generator CPU is cores × 100 (the Docker CLI convention).
    expect(generatorCpuPercent(capture)).toBe(25);
  });

  it("returns null generator CPU when the generator was never observed", async () => {
    const fetcher: SamplerFetcher = {
      source: "cli",
      async fetch() {
        return [];
      },
    };
    const sampler = new ResourceSampler({
      fetcher,
      targets: [{ role: "app", id: "abc" }],
      caps: { appCpus: 2, appMemoryMb: 2048, dbCpus: 2, dbMemoryMb: 2048 },
      intervalMs: 1_000_000,
    });
    await sampler.start();
    const capture = await sampler.stop();
    expect(capture.samples).toHaveLength(0);
    expect(generatorCpuPercent(capture)).toBeNull();
  });
});

describe("artefact parsing", () => {
  it("parses compose ps output as JSONL or a single array", () => {
    const jsonl = [
      '{"ID":"aaa","Name":"p-app-1","Service":"app"}',
      '{"ID":"bbb","Name":"p-db-1","Service":"db"}',
    ].join("\n");
    expect(parseComposePs(jsonl).map((e) => e.service)).toEqual(["app", "db"]);
    const array = '[{"ID":"ccc","Service":"api"}]';
    expect(parseComposePs(array)).toEqual([{ id: "ccc", service: "api" }]);
    expect(parseComposePs("")).toEqual([]);
  });

  it("parses docker stats CLI JSON, including MemUsage units", () => {
    const stdout = [
      '{"ID":"abc123","Name":"p-app-1","CPUPerc":"12.50%","MemUsage":"64MiB / 2GiB"}',
    ].join("\n");
    const stats = parseCliStats(stdout);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.cpuPercent).toBe(12.5);
    expect(stats[0]!.memMb).toBe(64);
    expect(parseMemString("1.5GiB")).toBe(1536);
    expect(parseMemString(undefined)).toBeNull();
  });

  it("discovers the socket endpoint from DOCKER_HOST or defaults", () => {
    expect(
      resolveDockerEndpoint({ DOCKER_HOST: "unix:///tmp/docker.sock" }),
    ).toEqual({ source: "api", socketPath: "/tmp/docker.sock" });
    expect(
      resolveDockerEndpoint({ DOCKER_HOST: "tcp://1.2.3.4:2376" }),
    ).toEqual({ source: "api", host: "1.2.3.4", port: 2376 });
    // A remote daemon over ssh cannot be reached over a plain socket → CLI.
    expect(
      resolveDockerEndpoint({ DOCKER_HOST: "ssh://user@host" }).source,
    ).toBe("cli");
  });
});
