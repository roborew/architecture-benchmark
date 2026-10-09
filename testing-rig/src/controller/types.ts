// Controller types (plan §5). A `ResolvedVariant` is what the controller runs:
// a manifest with paths made absolute, the Compose project name fixed for the
// run, host ports allocated, and `{{TOKEN}}` build args resolved.

import type { CapabilityKind, Cohort, ServiceKind } from "../config/schema.js";

export interface ResolvedService {
  /** Key in the manifest's `services:` map: app | api | spa | db | seeder. */
  slot: "app" | "api" | "spa" | "db" | "seeder";
  composeService: string;
  kind: ServiceKind;
  /** HTTP path polled for readiness (published services only). */
  healthPath?: string;
  hostPortEnv?: string;
  /** Allocated host port (published services only). */
  hostPort?: number;
  buildArgs?: Record<string, string>;
}

export interface ResolvedVariant {
  id: string;
  cohort: Cohort;
  appDirectory: string;
  composeFile: string;
  /** `<projectPrefix>-<runId>` — unique per run so parallel stacks never collide. */
  projectName: string;
  services: {
    app?: ResolvedService;
    api?: ResolvedService;
    spa?: ResolvedService;
    db: ResolvedService;
    seeder: ResolvedService;
  };
  /** app + api + spa, in readiness order. */
  published: ResolvedService[];
  seedCommand: string[];
  resetCommand: string[];
  /** Read-only load target (plan §6.5), if the manifest declares one. */
  load?: { service: "app" | "api" | "spa"; paths: string[] };
  capabilities: CapabilityKind[];
  readMode: string;
  mutationMode: string;
  orm: string;
}

export interface ResourceCaps {
  appCpus: number;
  appMemoryMb: number;
  dbCpus: number;
  dbMemoryMb: number;
}

export interface CommandResult {
  file: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class CommandError extends Error {
  constructor(readonly result: CommandResult) {
    super(
      `${result.file} ${result.args.join(" ")} exited ${result.code}\n${result.stderr || result.stdout}`,
    );
    this.name = "CommandError";
  }
}
