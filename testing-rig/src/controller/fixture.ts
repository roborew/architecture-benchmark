// Fixture eligibility (plan §5, spec/seed-spec.md). The controller refuses a
// plan whose scenarios ask for more distinct update/delete targets than the
// fixture provides — before any image is built or row is written.

import type { RigConfig } from "../config/schema.js";

export interface Pool {
  from: number;
  to: number;
}

export interface EligibilityPools {
  readPool: Pool;
  hotSet: Pool;
  updatePool: Pool;
  deletePool: Pool;
}

export type FixtureParams = RigConfig["fixture"];

export function poolSize(pool: Pool): number {
  return Math.max(0, pool.to - pool.from + 1);
}

export function eligibilityPools(fixture: FixtureParams): EligibilityPools {
  const n = fixture.taskCount;
  const readPoolSize = Math.floor(n / 2);
  return {
    readPool: { from: 1, to: readPoolSize },
    hotSet: { from: 1, to: Math.ceil(readPoolSize * fixture.workingSetFraction) },
    updatePool: { from: readPoolSize + 1, to: Math.floor((4 * n) / 5) },
    deletePool: { from: Math.floor((4 * n) / 5) + 1, to: n },
  };
}

export interface EligibilityRequest {
  updates: number;
  deletes: number;
  /** create-with-comment always creates new rows, so it needs no pool. */
  requireCommentForDeletePool?: boolean;
}

export interface EligibilityResult {
  ok: boolean;
  reasons: string[];
  pools: EligibilityPools;
}

export function checkEligibility(
  fixture: FixtureParams,
  request: EligibilityRequest,
): EligibilityResult {
  const pools = eligibilityPools(fixture);
  const reasons: string[] = [];

  if (poolSize(pools.updatePool) < request.updates) {
    reasons.push(
      `updatePool holds ${poolSize(pools.updatePool)} tasks but the plan requests ${request.updates} updates`,
    );
  }
  if (poolSize(pools.deletePool) < request.deletes) {
    reasons.push(
      `deletePool holds ${poolSize(pools.deletePool)} tasks but the plan requests ${request.deletes} deletes`,
    );
  }
  if (request.requireCommentForDeletePool !== false && fixture.commentCount < fixture.taskCount) {
    reasons.push(
      `commentCount ${fixture.commentCount} < taskCount ${fixture.taskCount}: not every deletePool task has a comment to cascade`,
    );
  }
  // Pools are constructed from disjoint bands; assert it rather than assume it.
  const bands = [pools.readPool, pools.updatePool, pools.deletePool];
  for (let i = 0; i < bands.length; i += 1) {
    for (let j = i + 1; j < bands.length; j += 1) {
      const a = bands[i]!;
      const b = bands[j]!;
      if (a.from <= b.to && b.from <= a.to) {
        reasons.push(`fixture pools overlap: [${a.from}..${a.to}] and [${b.from}..${b.to}]`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, pools };
}
