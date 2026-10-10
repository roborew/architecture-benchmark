// Container CPU/RAM sampler (container-resource-usage-tracking plan).
//
// Points the rig's existing once-per-second sampling mechanism at the *containers
// under test* — a variant's app/api/spa/db services and the `bench-k6-*`
// generator — so a load leg records "did the variant max out its envelope, or eat
// all its RAM" alongside throughput and latency.
//
// Source: the Docker Engine API's one-shot stats endpoint
// (`GET /containers/{id}/stats?stream=false`), which returns *raw cumulative
// counters* (`cpu_usage.total_usage`, `precpu_stats`, `system_cpu_usage`,
// `online_cpus`, `memory_stats.usage/limit`, `inactive_file`). We compute usage
// ourselves from raw counters, so the number does not depend on a Docker CLI's
// version-dependent CPU% normalization. When the socket is unreachable (a remote
// daemon, an odd Desktop install) we fall back to `docker stats --no-stream
// --format json` once per tick and record `source: "cli"` with its caveat.
//
// The rig measures; it does not gate. A container pinned at ~100 % of its
// envelope is a *result*, not a validity failure. Blank means not measured, never
// zero.

import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { runCommand, type Compose } from "./docker.js";
import type { ResourceCaps } from "./types.js";

// ---------------------------------------------------------------------------
// Public data shapes

export type ResourceSource = "api" | "cli";

/** One raw 1 Hz reading. `t` is milliseconds since the sampler started. */
export interface ResourceSample {
  t: number;
  /** Service role: app | api | spa | db | generator (compose service name). */
  service: string;
  /** Cores in use (fraction of a host core). Null on a zero-delta first sample. */
  cores: number | null;
  /** Percent of the service's effective `resources:` CPU cap (null when uncapped). */
  cpuPctOfEnv: number | null;
  memWorkingSetMb: number | null;
  /** Percent of the service's effective `resources:` memory cap. */
  memPctOfEnv: number | null;
}

/** Per-service maxima/averages folded from a leg's samples. */
export interface ResourceUsage {
  maxCpuPctOfEnv: number | null;
  avgCpuPctOfEnv: number | null;
  maxMemMb: number | null;
  maxMemPctOfEnv: number | null;
}

/** The per-leg aggregate record folded into a report (plan §3.3). */
export interface ResourceSummary {
  source: ResourceSource;
  services: Record<string, ResourceUsage>;
  /** Delta of `memory_stats.events.oom_kill` across the leg (sum over services). */
  oomKills: number | null;
}

/** A sampler run's output: the aggregate plus the raw series. */
export interface SamplerCapture {
  source: ResourceSource;
  intervalMs: number;
  samples: ResourceSample[];
  summary: ResourceSummary;
}

// ---------------------------------------------------------------------------
// Raw counter math (pure — the unit-test surface, plan U2/§5)

export interface RawCpuStats {
  totalUsage: number | null;
  systemUsage: number | null;
  onlineCpus: number | null;
}

export interface RawMemStats {
  usage: number | null;
  /** `inactive_file` (cgroup v2) or `total_inactive_file` (v1). */
  inactiveFile: number | null;
  limit: number | null;
  oomKill: number | null;
}

export interface RawStats {
  cpu: RawCpuStats;
  precpu: RawCpuStats;
  mem: RawMemStats;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Cores in use = `(cpu.total − precpu.total) / (system − precpu.system) × online`.
 * Multiply by 100 for the Docker CLI's CPUPerc convention (percent of one core).
 * Null when there is no positive system delta (a fresh container's first sample).
 */
export function coresInUse(cur: RawCpuStats, prev: RawCpuStats): number | null {
  if (cur.systemUsage === null || prev.systemUsage === null) return null;
  const systemDelta = cur.systemUsage - prev.systemUsage;
  if (!(systemDelta > 0)) return null;
  const cpuDelta = (cur.totalUsage ?? 0) - (prev.totalUsage ?? 0);
  if (cpuDelta < 0) return null;
  const online =
    cur.onlineCpus && cur.onlineCpus > 0
      ? cur.onlineCpus
      : (prev.onlineCpus ?? 0);
  if (!(online > 0)) return null;
  return (cpuDelta / systemDelta) * online;
}

/**
 * Working set ≈ `usage − inactive_file` — the same approximation `docker stats`
 * makes. Page cache otherwise flatters RAM numbers. Null when usage is unknown.
 */
export function workingSetBytes(mem: RawMemStats): number | null {
  if (mem.usage === null) return null;
  return Math.max(0, mem.usage - (mem.inactiveFile ?? 0));
}

/** Percent of a resource envelope; null when either side is unknown/uncapped. */
export function percentOfEnvelope(
  value: number | null,
  cap: number | null | undefined,
): number | null {
  if (value === null || cap === null || cap === undefined || cap <= 0)
    return null;
  return (value / cap) * 100;
}

/** Parse the Engine API's raw stats body into the counters we compute from. */
export function parseRawStats(json: unknown): RawStats | null {
  const root = asRecord(json);
  if (!root) return null;
  const cpu = asRecord(root.cpu_stats) ?? {};
  const precpu = asRecord(root.precpu_stats) ?? {};
  const cpuUsage = asRecord(cpu.cpu_usage) ?? {};
  const preCpuUsage = asRecord(precpu.cpu_usage) ?? {};
  const memory = asRecord(root.memory_stats) ?? {};
  const memStats = asRecord(memory.stats) ?? {};
  const events = asRecord(memory.events) ?? {};

  return {
    cpu: {
      totalUsage: num(cpuUsage.total_usage),
      systemUsage: num(cpu.system_cpu_usage),
      onlineCpus: num(cpu.online_cpus),
    },
    precpu: {
      totalUsage: num(preCpuUsage.total_usage),
      systemUsage: num(precpu.system_cpu_usage),
      onlineCpus: num(precpu.online_cpus),
    },
    mem: {
      usage: num(memory.usage),
      // cgroup v2 reports `inactive_file`; v1 `total_inactive_file`.
      inactiveFile:
        num(memStats.inactive_file) ?? num(memStats.total_inactive_file),
      limit: num(memory.limit),
      // The OOM-kill counter lives in `memory.events` on cgroup v2 *when the
      // daemon exposes it*; keep defensive fallbacks. Docker Desktop 29.x omits
      // it entirely, so `createApiFetcher` also falls back to `State.OOMKilled`.
      oomKill:
        num(events.oom_kill) ?? num(memStats.oom_kill) ?? num(memory.oom_kill),
    },
  };
}

// ---------------------------------------------------------------------------
// The CPU/RAM envelope a service role is capped at

export interface RoleCaps {
  cpus: number;
  memoryMb: number;
}

/** app/api/spa share the app envelope; db has its own; the generator is uncapped. */
export function capsForRole(role: string, caps: ResourceCaps): RoleCaps | null {
  if (role === "db") return { cpus: caps.dbCpus, memoryMb: caps.dbMemoryMb };
  if (role === "app" || role === "api" || role === "spa")
    return { cpus: caps.appCpus, memoryMb: caps.appMemoryMb };
  return null;
}

// ---------------------------------------------------------------------------
// Folding samples into aggregates

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function maxOf(values: Array<number | null>): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (value === null) continue;
    max = max === null ? value : Math.max(max, value);
  }
  return max === null ? null : round(max);
}

function avgOf(values: Array<number | null>): number | null {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (value === null) continue;
    sum += value;
    count += 1;
  }
  return count === 0 ? null : round(sum / count);
}

/** Fold a leg's samples into per-service max/avg + the OOM-kill delta. */
export function summariseSamples(
  samples: ResourceSample[],
  oomKills: number | null,
  source: ResourceSource,
): ResourceSummary {
  const grouped = new Map<string, ResourceSample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.service);
    if (list) list.push(sample);
    else grouped.set(sample.service, [sample]);
  }
  const services: Record<string, ResourceUsage> = {};
  for (const [service, list] of grouped) {
    services[service] = {
      maxCpuPctOfEnv: maxOf(list.map((s) => s.cpuPctOfEnv)),
      avgCpuPctOfEnv: avgOf(list.map((s) => s.cpuPctOfEnv)),
      maxMemMb: maxOf(list.map((s) => s.memWorkingSetMb)),
      maxMemPctOfEnv: maxOf(list.map((s) => s.memPctOfEnv)),
    };
  }
  return { source, services, oomKills };
}

/**
 * The generator's own CPU as the Docker CLI's CPUPerc convention (percent of one
 * core = cores × 100), derived from the shared series so the historical
 * `generatorMaxCpuPercentObserved` metric is unchanged. Null when unmeasured.
 */
export function generatorCpuPercent(
  capture: SamplerCapture | null,
): number | null {
  if (!capture) return null;
  const cores = capture.samples
    .filter((s) => s.service === "generator")
    .map((s) => s.cores)
    .filter((c): c is number => c !== null);
  if (cores.length === 0) return null;
  return round(Math.max(...cores) * 100);
}

// ---------------------------------------------------------------------------
// Docker endpoint discovery

export interface DockerEndpoint {
  source: ResourceSource;
  socketPath?: string;
  host?: string;
  port?: number;
}

/**
 * Best-effort endpoint discovery (plan U1): `DOCKER_HOST` first, else the well
 * known local sockets. `ssh://`/`npipe://` daemons cannot be reached over a plain
 * socket, so they fall through to the CLI. This is only a *candidate* — `probe`
 * confirms it answers `/_ping` before the API path is trusted.
 */
export function resolveDockerEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): DockerEndpoint {
  const dockerHost = env.DOCKER_HOST?.trim();
  if (dockerHost) {
    if (dockerHost.startsWith("unix://"))
      return { source: "api", socketPath: dockerHost.slice("unix://".length) };
    if (dockerHost.startsWith("tcp://") || dockerHost.startsWith("http://")) {
      try {
        const url = new URL(dockerHost.replace(/^tcp:\/\//, "http://"));
        return {
          source: "api",
          host: url.hostname,
          port: Number(url.port || 2375),
        };
      } catch {
        return { source: "cli" };
      }
    }
    return { source: "cli" };
  }
  const home = env.HOME;
  const candidates = [
    "/var/run/docker.sock",
    home ? path.join(home, ".docker", "run", "docker.sock") : "",
    home
      ? path.join(
          home,
          "Library",
          "Containers",
          "com.docker.docker",
          "Data",
          "docker.raw.sock",
        )
      : "",
  ].filter(Boolean);
  for (const socketPath of candidates) {
    if (existsSync(socketPath)) return { source: "api", socketPath };
  }
  return { source: "cli" };
}

/** Confirm the candidate answers; downgrade to the CLI on any failure. */
export async function probeDockerEndpoint(
  endpoint: DockerEndpoint,
): Promise<DockerEndpoint> {
  if (endpoint.source !== "api") return endpoint;
  try {
    const status = await requestRaw(endpoint, "/_ping");
    return status === 200 ? endpoint : { source: "cli" };
  } catch {
    return { source: "cli" };
  }
}

function requestOptions(endpoint: DockerEndpoint): http.RequestOptions {
  if (endpoint.socketPath) return { socketPath: endpoint.socketPath };
  return { host: endpoint.host, port: endpoint.port };
}

/** A bare GET returning the status code (used for `/_ping`). */
function requestRaw(
  endpoint: DockerEndpoint,
  urlPath: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...requestOptions(endpoint), path: urlPath, method: "GET" },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("docker API timed out")));
    req.end();
  });
}

/** GET a JSON body from the daemon over the socket/tcp endpoint. */
function requestJson(
  endpoint: DockerEndpoint,
  urlPath: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...requestOptions(endpoint), path: urlPath, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (
            !res.statusCode ||
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            reject(
              new Error(
                `docker API ${urlPath} -> HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
              ),
            );
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("docker API timed out")));
    req.end();
  });
}

/** `requestJson`, but a failed/absent response is `null` (best-effort sampling). */
async function tryRequestJson(
  endpoint: DockerEndpoint,
  urlPath: string,
): Promise<unknown> {
  try {
    return await requestJson(endpoint, urlPath);
  } catch {
    return null;
  }
}

/**
 * The container's `State.OOMKilled` flag, as a 0/1 counter. The Engine API's
 * stats body omits the cgroup-v2 `memory.events.oom_kill` counter on some
 * daemons (Docker Desktop 29.x), so a true flag is the fallback "hit the RAM
 * ceiling" signal. Delta across the leg = "was OOM-killed during this leg".
 */
async function inspectOomKilled(
  endpoint: DockerEndpoint,
  ref: string,
): Promise<number | null> {
  const json = await tryRequestJson(
    endpoint,
    `/containers/${encodeURIComponent(ref)}/json`,
  );
  const root = asRecord(json);
  const state = asRecord(root?.State);
  return typeof state?.OOMKilled === "boolean"
    ? state.OOMKilled
      ? 1
      : 0
    : null;
}

// ---------------------------------------------------------------------------
// Targets, fetchers, and the sampler loop

export interface SamplerTarget {
  /** compose service name (app/api/spa/db) or "generator". */
  role: string;
  /** Full container id, when known (compose ps). */
  id?: string;
  /** Container name (compose `<project>-<service>-1`, or `bench-k6-<id>`). */
  name?: string;
}

/** One normalised reading for one container; the fetcher owns source specifics. */
export interface TickReading {
  role: string;
  cores: number | null;
  memWorkingSetBytes: number | null;
  oomKill: number | null;
}

/** A tick source: API or CLI. The loop, folding, and OOM delta are shared. */
export interface SamplerFetcher {
  readonly source: ResourceSource;
  fetch(targets: SamplerTarget[]): Promise<TickReading[]>;
}

/** Engine-API fetcher: one one-shot request per container, raw counters. */
export function createApiFetcher(endpoint: DockerEndpoint): SamplerFetcher {
  return {
    source: "api",
    async fetch(targets) {
      const readings: TickReading[] = [];
      for (const target of targets) {
        const ref = target.id ?? target.name;
        if (!ref) continue;
        let cores: number | null = null;
        let memWorkingSetBytes: number | null = null;
        let oomKill: number | null = null;
        const json = await tryRequestJson(
          endpoint,
          `/containers/${encodeURIComponent(ref)}/stats?stream=false`,
        );
        if (json) {
          const stats = parseRawStats(json);
          if (stats) {
            cores = coresInUse(stats.cpu, stats.precpu);
            memWorkingSetBytes = workingSetBytes(stats.mem);
            oomKill = stats.mem.oomKill;
          }
        }
        // Fall back to the inspect flag when the stats body has no OOM counter
        // (and still works after an OOM-killed container has exited).
        if (oomKill === null) oomKill = await inspectOomKilled(endpoint, ref);
        if (cores === null && memWorkingSetBytes === null && oomKill === null)
          continue;
        readings.push({
          role: target.role,
          cores,
          memWorkingSetBytes,
          oomKill,
        });
      }
      return readings;
    },
  };
}

const BINARY_UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  PiB: 1024 ** 5,
  kB: 1000,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
};

/** `"12.34MiB"` → MiB as a number. */
export function parseMemString(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([\d.]+)\s*([KMGTP]i?B|B)/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || !unit) return null;
  const bytes = BINARY_UNITS[unit];
  return bytes === undefined ? null : (amount * bytes) / 1024 ** 2;
}

interface CliStat {
  id: string;
  name: string;
  cpuPercent: number;
  memMb: number | null;
}

/** Parse `docker stats --format json` JSONL into per-container readings. */
export function parseCliStats(stdout: string): CliStat[] {
  const stats: CliStat[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const cpu = Number.parseFloat(String(entry.CPUPerc ?? "").replace("%", ""));
    const memUsage = String(entry.MemUsage ?? "");
    stats.push({
      id: typeof entry.ID === "string" ? entry.ID : "",
      name: typeof entry.Name === "string" ? entry.Name : "",
      cpuPercent: Number.isFinite(cpu) ? cpu : 0,
      memMb: parseMemString(memUsage.split("/")[0]),
    });
  }
  return stats;
}

function matchCliStat(
  stats: CliStat[],
  target: SamplerTarget,
): CliStat | undefined {
  if (target.name) {
    const byName = stats.find((s) => s.name === target.name);
    if (byName) return byName;
  }
  if (target.id) {
    // The CLI reports a 12-char short id; the compose id is the full 64.
    return stats.find((s) => s.id && target.id!.startsWith(s.id));
  }
  return undefined;
}

/**
 * CLI fetcher (plan §2 fallback): one `docker stats --no-stream --format json`
 * per tick covers every container. CPU% normalization is version-dependent
 * (percent-of-host vs percent-of-limit), so the artefact records `source: "cli"`
 * and the number is read with appropriate suspicion. No OOM counter here.
 */
export function createCliFetcher(): SamplerFetcher {
  return {
    source: "cli",
    async fetch(targets) {
      const result = await runCommand(
        "docker",
        ["stats", "--no-stream", "--format", "json"],
        { allowFailure: true },
      );
      if (result.code !== 0) return [];
      const stats = parseCliStats(result.stdout);
      const readings: TickReading[] = [];
      for (const target of targets) {
        const stat = matchCliStat(stats, target);
        if (!stat) continue;
        readings.push({
          role: target.role,
          // The Docker CLI's CPU% is cores × 100 on the percent-of-one-core
          // convention (its documented max is 100 % × number of host cores).
          cores: stat.cpuPercent / 100,
          memWorkingSetBytes:
            stat.memMb === null ? null : stat.memMb * 1024 ** 2,
          oomKill: null,
        });
      }
      return readings;
    },
  };
}

export interface ResourceSamplerOptions {
  fetcher: SamplerFetcher;
  targets: SamplerTarget[];
  caps: ResourceCaps;
  intervalMs?: number;
}

/**
 * A 1 Hz sampling loop over one load leg. `start()` takes an immediate reading
 * then ticks every `intervalMs`; `stop()` closes the window with a final reading
 * and returns the series + aggregate. Best-effort: a failed tick is skipped,
 * never fatal (the rig measures, it does not gate).
 */
export class ResourceSampler {
  private readonly samples: ResourceSample[] = [];
  private readonly oomFirst = new Map<string, number>();
  private readonly oomLast = new Map<string, number>();
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private busy = false;

  constructor(private readonly options: ResourceSamplerOptions) {
    this.intervalMs = options.intervalMs ?? 1000;
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<SamplerCapture> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.tick(); // final reading closes the CPU delta + OOM window
    return {
      source: this.options.fetcher.source,
      intervalMs: this.intervalMs,
      samples: this.samples,
      summary: summariseSamples(
        this.samples,
        this.oomDelta(),
        this.options.fetcher.source,
      ),
    };
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const readings = await this.options.fetcher.fetch(this.options.targets);
      const t = Date.now() - this.startedAt;
      for (const reading of readings) {
        const caps = capsForRole(reading.role, this.options.caps);
        const memMb =
          reading.memWorkingSetBytes === null
            ? null
            : reading.memWorkingSetBytes / 1024 ** 2;
        this.samples.push({
          t,
          service: reading.role,
          cores: reading.cores,
          cpuPctOfEnv: percentOfEnvelope(reading.cores, caps?.cpus),
          memWorkingSetMb: memMb,
          memPctOfEnv: percentOfEnvelope(memMb, caps?.memoryMb),
        });
        if (reading.oomKill !== null) {
          if (!this.oomFirst.has(reading.role))
            this.oomFirst.set(reading.role, reading.oomKill);
          this.oomLast.set(reading.role, reading.oomKill);
        }
      }
    } catch {
      // A failed tick is skipped, never fatal.
    } finally {
      this.busy = false;
    }
  }

  private oomDelta(): number | null {
    let total = 0;
    let measured = false;
    for (const [role, last] of this.oomLast) {
      measured = true;
      total += last - (this.oomFirst.get(role) ?? last);
    }
    return measured ? total : null;
  }
}

/**
 * Resolve the stack's own services (app/api/spa/db — the seeder is a one-shot
 * and is excluded) from `compose ps --format json`. Handles both the JSONL and
 * single-array output shapes.
 */
export async function resolveComposeTargets(
  compose: Compose,
): Promise<SamplerTarget[]> {
  const result = await compose.ps();
  if (result.code !== 0) return [];
  const targets: SamplerTarget[] = [];
  const seen = new Set<string>();
  for (const entry of parseComposePs(result.stdout)) {
    const id = entry.id;
    const service = entry.service;
    if (!id || !service || service === "seeder" || seen.has(service)) continue;
    seen.add(service);
    targets.push({
      role: service,
      id,
      ...(entry.name ? { name: entry.name } : {}),
    });
  }
  return targets;
}

interface ComposePsEntry {
  id?: string;
  name?: string;
  service?: string;
}

/** Parse `docker compose ps --format json` (JSONL or a single JSON array). */
export function parseComposePs(stdout: string): ComposePsEntry[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const entries: ComposePsEntry[] = [];
  const push = (raw: unknown): void => {
    if (typeof raw !== "object" || raw === null) return;
    const entry = raw as Record<string, unknown>;
    const id =
      typeof entry.ID === "string"
        ? entry.ID
        : typeof entry.Id === "string"
          ? entry.Id
          : undefined;
    const service =
      typeof entry.Service === "string" ? entry.Service : undefined;
    const name = typeof entry.Name === "string" ? entry.Name : undefined;
    entries.push({
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(service ? { service } : {}),
    });
  };
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) for (const item of parsed) push(item);
      return entries;
    } catch {
      return [];
    }
  }
  for (const line of trimmed.split("\n")) {
    const text = line.trim();
    if (!text) continue;
    try {
      push(JSON.parse(text));
    } catch {
      // ignore a malformed line rather than lose the whole map
    }
  }
  return entries;
}

/**
 * Start a sampler covering a variant's own services plus its `bench-k6-*`
 * generator (resolved lazily — it does not exist until k6 starts). Never throws:
 * returns null on any setup failure so a load leg is never failed by sampling.
 */
export async function startResourceSampler(options: {
  compose: Compose;
  caps: ResourceCaps;
  generatorName: string;
  intervalMs?: number;
}): Promise<ResourceSampler | null> {
  try {
    const endpoint = await probeDockerEndpoint(resolveDockerEndpoint());
    const targets = await resolveComposeTargets(options.compose);
    targets.push({ role: "generator", name: options.generatorName });
    const fetcher =
      endpoint.source === "api"
        ? createApiFetcher(endpoint)
        : createCliFetcher();
    const sampler = new ResourceSampler({
      fetcher,
      targets,
      caps: options.caps,
      ...(options.intervalMs !== undefined
        ? { intervalMs: options.intervalMs }
        : {}),
    });
    await sampler.start();
    return sampler;
  } catch {
    return null;
  }
}

/** Stop a sampler best-effort; null when none ran or the stop failed. */
export async function stopResourceSampler(
  sampler: ResourceSampler | null,
): Promise<SamplerCapture | null> {
  if (!sampler) return null;
  try {
    return await sampler.stop();
  } catch {
    return null;
  }
}

/** The artefact shape written to `resources/*-samples.json` (plan §3.3). */
export function resourceSeriesFile(capture: SamplerCapture): {
  source: ResourceSource;
  intervalMs: number;
  samples: ResourceSample[];
} {
  return {
    source: capture.source,
    intervalMs: capture.intervalMs,
    samples: capture.samples,
  };
}
