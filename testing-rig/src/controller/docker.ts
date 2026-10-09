// Docker / Compose invocation (plan §5): through `execFile`, never a shell
// string. Arguments are arrays, so nothing from YAML or the environment is ever
// re-parsed by a shell.

import { execFile } from "node:child_process";
import { CommandError, type CommandResult } from "./types.js";

const MAX_BUFFER = 256 * 1024 * 1024;

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Written to the child's stdin, then closed. */
  stdin?: string;
  timeoutMs?: number;
  /** Resolve (instead of throwing) on a non-zero exit. */
  allowFailure?: boolean;
}

export function runCommand(
  file: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        maxBuffer: MAX_BUFFER,
        timeout: options.timeoutMs,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const result: CommandResult = {
          file,
          args,
          code:
            error && typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : error
                ? 1
                : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          durationMs: Date.now() - startedAt,
        };
        if (error && !options.allowFailure) reject(new CommandError(result));
        else resolve(result);
      },
    );
    if (child.stdin) child.stdin.end(options.stdin ?? "");
  });
}

export interface ComposeOptions {
  projectName: string;
  files: string[];
  /** Compose resolves relative build contexts against the file; `cwd` also
   *  anchors `.env` interpolation. */
  cwd: string;
  env?: Record<string, string | undefined>;
}

export class Compose {
  constructor(private readonly options: ComposeOptions) {}

  private base(sub: string[]): string[] {
    const args = ["compose", "-p", this.options.projectName];
    for (const file of this.options.files) args.push("-f", file);
    return [...args, ...sub];
  }

  private run(sub: string[], options: RunOptions = {}): Promise<CommandResult> {
    return runCommand("docker", this.base(sub), {
      cwd: this.options.cwd,
      env: { ...this.options.env, ...options.env },
      ...options,
    });
  }

  build(
    options: { services?: string[]; noCache?: boolean } = {},
  ): Promise<CommandResult> {
    const sub = ["build"];
    if (options.noCache) sub.push("--no-cache");
    if (options.services?.length) sub.push(...options.services);
    return this.run(sub, { timeoutMs: 45 * 60 * 1000 });
  }

  up(services?: string[]): Promise<CommandResult> {
    return this.run(["up", "-d", ...(services ?? [])], {
      timeoutMs: 15 * 60 * 1000,
    });
  }

  down(
    options: { volumes?: boolean; removeOrphans?: boolean } = {},
  ): Promise<CommandResult> {
    const sub = ["down"];
    if (options.volumes ?? true) sub.push("-v");
    if (options.removeOrphans ?? true) sub.push("--remove-orphans");
    return this.run(sub, { timeoutMs: 5 * 60 * 1000, allowFailure: true });
  }

  /**
   * `docker compose run --rm [-e K=V ...] <service> <command...>`.
   * Used for the seeder: one-shot, in-network, no published port.
   */
  runService(
    service: string,
    command: string[],
    options: {
      env?: Record<string, string>;
      rm?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<CommandResult> {
    const sub = ["run"];
    if (options.rm ?? true) sub.push("--rm");
    for (const [key, value] of Object.entries(options.env ?? {}))
      sub.push("-e", `${key}=${value}`);
    sub.push(service, ...command);
    return this.run(sub, { timeoutMs: options.timeoutMs ?? 30 * 60 * 1000 });
  }

  /** `docker compose exec -T <service> <command...>` (no TTY). */
  exec(
    service: string,
    command: string[],
    options: { stdin?: string; allowFailure?: boolean } = {},
  ): Promise<CommandResult> {
    return this.run(["exec", "-T", service, ...command], {
      stdin: options.stdin,
      allowFailure: options.allowFailure,
    });
  }

  ps(): Promise<CommandResult> {
    return this.run(["ps", "--format", "json"]);
  }

  images(): Promise<CommandResult> {
    return this.run(["images", "--format", "json"], { allowFailure: true });
  }

  logs(service?: string): Promise<CommandResult> {
    return this.run(["logs", "--no-color", ...(service ? [service] : [])], {
      allowFailure: true,
    });
  }

  config(): Promise<CommandResult> {
    return this.run(["config"], { allowFailure: true });
  }
}

/** True if the Docker daemon is reachable. */
export async function dockerAvailable(): Promise<boolean> {
  const result = await runCommand(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    {
      allowFailure: true,
      timeoutMs: 20_000,
    },
  );
  return result.code === 0;
}
