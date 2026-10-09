// Read-only load generator (plan §6.5, interim). Cycles GET requests over the
// manifest's read paths at a constant VU count. This measures read capacity; it
// deliberately makes no mutation-capacity claim (that needs per-transport write
// adapters validated against a captured browser request — plan §5/§7).
//
// No thresholds: the run measures, it does not gate. The controller parses the
// summary export and monitors generator CPU against generatorMaxCpuPercent.

import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    read: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || "15s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
  discardResponseBodies: true,
};

const baseUrl = __ENV.BASE_URL;
const paths = (__ENV.PATHS || "/")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);

export default function () {
  for (const path of paths) {
    const response = http.get(`${baseUrl}${path}`);
    check(response, { "status < 500": (r) => r.status < 500 });
  }
}
