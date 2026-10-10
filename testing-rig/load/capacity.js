// Capacity ladder (plan K3) — the tip-over instrument.
//
// One `constant-arrival-rate` run per declared rate (the controller runs the
// script once per step). The iteration body picks an operation by the config's
// `weights`: list/detail are GETs over the manifest's read paths; create/update/
// delete replay the captured write requests with the same leased pool ids as
// `mutations.js`. This makes the ladder the *weighted mixed* load the config
// declares, not a pure-read ladder.
//
// With the generator's CPU under the limit, `dropped_iterations` (or a degraded
// p95) means the app could not absorb the held rate — that is the tipping point,
// made measurable. Thresholds are recorded health labels, not gates (plan K2).
//
// Env: BASE_URL, RATE, DURATION, PREALLOCATED_VUS, MAX_VUS, READ_PATHS,
//      WEIGHT_{LIST,DETAIL,CREATE,UPDATE,DELETE}, CAPTURE (JSON or empty),
//      UPDATE_FROM/UPDATE_TO, DELETE_FROM/DELETE_TO, SUMMARY_FILE.

import http from "k6/http";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import { check } from "k6";
import { summaryFile } from "./summary.js";

const baseUrl = __ENV.BASE_URL;
const rate = Number(__ENV.RATE || 10);
const duration = __ENV.DURATION || "60s";
const preAllocatedVUs = Number(__ENV.PREALLOCATED_VUS || 50);
const maxVUs = Number(__ENV.MAX_VUS || 200);

let capture = { ops: {} };
if (__ENV.CAPTURE) {
  try {
    capture = JSON.parse(__ENV.CAPTURE);
  } catch (e) {
    capture = { ops: {} };
  }
}

const readPaths = (__ENV.READ_PATHS || "/")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);

const pools = {
  updateFrom: Number(__ENV.UPDATE_FROM || 1),
  updateTo: Number(__ENV.UPDATE_TO || 1),
  deleteFrom: Number(__ENV.DELETE_FROM || 1),
  deleteTo: Number(__ENV.DELETE_TO || 1),
};

const weights = {
  list: Number(__ENV.WEIGHT_LIST || 0),
  detail: Number(__ENV.WEIGHT_DETAIL || 0),
  create: Number(__ENV.WEIGHT_CREATE || 0),
  update: Number(__ENV.WEIGHT_UPDATE || 0),
  delete: Number(__ENV.WEIGHT_DELETE || 0),
};

const ok = {
  list: new Counter("cap_list_ok"),
  detail: new Counter("cap_detail_ok"),
  create: new Counter("cap_create_ok"),
  update: new Counter("cap_update_ok"),
  delete: new Counter("cap_delete_ok"),
};

export const options = {
  scenarios: {
    capacity: {
      executor: "constant-arrival-rate",
      rate: rate,
      timeUnit: "1s",
      duration: duration,
      preAllocatedVUs: preAllocatedVUs,
      maxVUs: maxVUs,
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: true,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

// Build the weighted op table. Write ops need captured requests; without them
// the ladder degrades to reads only (the controller records that honestly).
const table = [];
if (weights.list > 0) table.push({ op: "list", weight: weights.list });
if (weights.detail > 0) table.push({ op: "detail", weight: weights.detail });
if (capture.ops.create && weights.create > 0)
  table.push({ op: "create", weight: weights.create });
if (capture.ops.update && weights.update > 0)
  table.push({ op: "update", weight: weights.update });
if (capture.ops.delete && weights.delete > 0)
  table.push({ op: "del", weight: weights.delete });
if (table.length === 0) table.push({ op: "list", weight: 1 });
const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);

function pick() {
  let roll = Math.random() * totalWeight;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) return entry.op;
  }
  return table[table.length - 1].op;
}

const literal = (text, from, to) =>
  from === undefined ? text : text.split(String(from)).join(String(to));
const idSub = (text, from, to) =>
  from === undefined
    ? text
    : text.replace(new RegExp(`\\b${from}\\b`, "g"), String(to));

function send(tag, request, { id, title, comment } = {}) {
  let path = request.path;
  let body = request.body;
  if (id !== undefined) {
    path = idSub(path, request.id, id);
    body = idSub(body, request.id, id);
  }
  if (title !== undefined) body = literal(body, request.title, title);
  if (comment !== undefined) body = literal(body, request.comment, comment);
  const response = http.request(request.method, `${baseUrl}${path}`, body, {
    headers: request.headers,
    tags: { op: tag },
  });
  return response.status >= 200 && response.status < 300;
}

function read(op, i) {
  const path = readPaths[i % readPaths.length];
  const response = http.get(`${baseUrl}${path}`, { tags: { op: "read", path } });
  check(response, { "read status < 500": (r) => r.status < 500 });
  if (response.status < 500) ok[op].add(1);
}

function create(i) {
  const title = `bench-load-create-${__VU}-${i}`;
  if (send("create", capture.ops.create, { title })) ok.create.add(1);
}

function update(i) {
  const span = pools.updateTo - pools.updateFrom + 1;
  const id = pools.updateFrom + (i % span);
  if (send("update", capture.ops.update, { id, title: `bench-load-update-${id}` }))
    ok.update.add(1);
}

function del(i) {
  const span = pools.deleteTo - pools.deleteFrom + 1;
  const id = pools.deleteFrom + (i % span);
  if (send("delete", capture.ops.delete, { id })) ok.delete.add(1);
}

export default function () {
  const i = exec.scenario.iterationInTest;
  const op = pick();
  if (op === "list" || op === "detail") return read(op, i);
  if (op === "create") return create(i);
  if (op === "update") return update(i);
  return del(i);
}

export function handleSummary(data) {
  return summaryFile(data);
}
