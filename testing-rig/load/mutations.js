// Mutation load (plan §6.5). Replays the captured write requests (see
// src/load/capture.ts) as a volume scenario: exact per-op iteration counts, with
// distinct leased target ids drawn from the fixture's update/delete pools. Every
// request carries an `op` tag so the summary export yields per-op latency, and a
// per-op success counter gives offered-vs-achieved.
//
// Transport-agnostic by construction: the request is whatever the app sent, with
// the captured title/comment and target id substituted.
//
// Env: BASE_URL, CAPTURE (JSON), plus COUNT_* / pool ranges / CONCURRENCY.

import http from "k6/http";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import { check } from "k6";

const baseUrl = __ENV.BASE_URL;
const capture = JSON.parse(__ENV.CAPTURE);
const vus = Number(__ENV.CONCURRENCY || 5);
const maxDuration = __ENV.MAX_DURATION || "10m";

const counts = {
  list: Number(__ENV.COUNT_LIST || 0),
  detail: Number(__ENV.COUNT_DETAIL || 0),
  create: Number(__ENV.COUNT_CREATE || 0),
  update: Number(__ENV.COUNT_UPDATE || 0),
  delete: Number(__ENV.COUNT_DELETE || 0),
};
const pools = {
  updateFrom: Number(__ENV.UPDATE_FROM || 1),
  updateTo: Number(__ENV.UPDATE_TO || 1),
  deleteFrom: Number(__ENV.DELETE_FROM || 1),
  deleteTo: Number(__ENV.DELETE_TO || 1),
};
const readPaths = (__ENV.READ_PATHS || "/")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

const ok = {
  create: new Counter("mk_create_ok"),
  update: new Counter("mk_update_ok"),
  delete: new Counter("mk_delete_ok"),
  createWithComment: new Counter("mk_atomic_ok"),
};

const scenarios = {};
if (counts.create > 0) scenarios.create = shared("create", counts.create);
if (counts.update > 0) scenarios.update = shared("update", counts.update);
if (counts.delete > 0) scenarios.delete = shared("del", counts.delete);
if (counts.create > 0 || counts.update > 0 || counts.delete > 0) {
  if (capture.ops.createWithComment)
    scenarios.atomic = shared(
      "atomic",
      Math.max(1, Math.min(counts.create, 20)),
    );
}
const readCount = counts.list + counts.detail;
if (readCount > 0) scenarios.read = shared("read", readCount);

function shared(exec, iterations) {
  return { executor: "shared-iterations", exec, vus, iterations, maxDuration };
}

export const options = {
  scenarios,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: true,
};

const literal = (text, from, to) =>
  from === undefined ? text : text.split(String(from)).join(String(to));
const idSub = (text, from, to) =>
  from === undefined
    ? text
    : text.replace(new RegExp(`\\b${from}\\b`, "g"), String(to));

function send(op, request, { id, title, comment } = {}) {
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
    tags: { op },
  });
  return response.status >= 200 && response.status < 300;
}

export function create() {
  const i = exec.scenario.iterationInTest;
  const title = `bench-load-create-${__VU}-${i}`;
  if (send("create", capture.ops.create, { title })) ok.create.add(1);
}

export function update() {
  const i = exec.scenario.iterationInTest;
  const span = pools.updateTo - pools.updateFrom + 1;
  const id = pools.updateFrom + (i % span);
  if (
    send("update", capture.ops.update, { id, title: `bench-load-update-${id}` })
  )
    ok.update.add(1);
}

export function del() {
  const i = exec.scenario.iterationInTest;
  const span = pools.deleteTo - pools.deleteFrom + 1;
  const id = pools.deleteFrom + (i % span);
  if (send("delete", capture.ops.delete, { id })) ok.delete.add(1);
}

export function atomic() {
  const i = exec.scenario.iterationInTest;
  const title = `bench-load-atomic-${__VU}-${i}`;
  if (
    send("createWithComment", capture.ops.createWithComment, {
      title,
      comment: `bench load comment ${i}`,
    })
  ) {
    ok.createWithComment.add(1);
  }
}

export function read() {
  const i = exec.scenario.iterationInTest;
  const path = readPaths[i % readPaths.length];
  const response = http.get(`${baseUrl}${path}`, { tags: { op: "read" } });
  check(response, { "read status < 500": (r) => r.status < 500 });
}

export const setup = () => ({ captured: !!capture.ops });
