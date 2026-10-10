// Read-only load generator (plan §6.5, interim). Cycles GET requests over the
// manifest's read paths at a constant VU count. This measures read capacity; it
// deliberately makes no mutation-capacity claim (that needs per-transport write
// adapters validated against a captured browser request — plan §5/§7).
//
// Per-path tags (plan K1): every request carries `tags: { path }`, so the
// summary carries `http_req_duration{path:…}` sub-metrics and the viewer can
// show a per-path latency breakdown instead of one blended number.
//
// Thresholds (plan K2) are recorded health *labels*, not gates: `abortOnFail`
// stays false, and the controller treats k6's threshold-failure exit as a
// recorded signal, never a stage error.

import http from "k6/http";
import { check } from "k6";
import { summaryFile } from "./summary.js";

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
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

const baseUrl = __ENV.BASE_URL;
const paths = (__ENV.PATHS || "/")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);

export default function () {
  for (const path of paths) {
    const response = http.get(`${baseUrl}${path}`, { tags: { path } });
    check(response, { "status < 500": (r) => r.status < 500 });
  }
}

export function handleSummary(data) {
  return summaryFile(data);
}
