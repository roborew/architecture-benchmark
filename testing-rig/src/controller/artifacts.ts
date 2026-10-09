// Result artefacts (plan §5/cli): everything a run produces is written under
// `testing-rig/results/<run-id>/`, and failure artefacts are preserved on every
// exit path — a failed run is more valuable than a clean one.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export class RunArtifacts {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  write(relativePath: string, contents: string): string {
    const target = path.join(this.dir, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    return target;
  }

  writeJson(relativePath: string, value: unknown): string {
    return this.write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }
}
