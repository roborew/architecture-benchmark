// Shared end-of-test summary writer (plan K2).
//
// The scripts switch from the legacy `--summary-export` to `handleSummary`
// because the legacy shape cannot carry threshold results, and thresholds are
// the recorded health *labels* the viewer shows — never gates. `handleSummary`
// replaces k6's default summary output, so this module writes the file itself
// (to the `SUMMARY_FILE` the controller sets) in a shape both the controller and
// the viewer already read:
//
//   { metrics: { <name>: { <values flattened>, thresholds? } },
//     thresholds: [ { metric, expression, ok } ],
//     root_group }
//
// Flattening `data.metrics[name].values` to the top level keeps the existing
// readers (`summaryMetric`/`reduceMutations`) working unchanged.

export function summaryPayload(data) {
  var metrics = {};
  var thresholds = [];
  var names = Object.keys((data && data.metrics) || {});
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var metric = data.metrics[name] || {};
    var values = metric.values || {};
    var flat = {};
    for (var key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) flat[key] = values[key];
    }
    var metricThresholds = metric.thresholds || {};
    var expressions = Object.keys(metricThresholds);
    if (expressions.length > 0) {
      flat.thresholds = metricThresholds;
      for (var t = 0; t < expressions.length; t++) {
        var result = metricThresholds[expressions[t]] || {};
        thresholds.push({
          metric: name,
          expression: expressions[t],
          ok: !!result.ok,
        });
      }
    }
    metrics[name] = flat;
  }
  thresholds.sort(function (a, b) {
    if (a.metric !== b.metric) return a.metric < b.metric ? -1 : 1;
    if (a.expression === b.expression) return 0;
    return a.expression < b.expression ? -1 : 1;
  });
  return { metrics: metrics, thresholds: thresholds, root_group: data && data.root_group };
}

/** Build the `handleSummary` return map for the controller's SUMMARY_FILE. */
export function summaryFile(data) {
  var out = {};
  out[__ENV.SUMMARY_FILE || "/out/summary.json"] = JSON.stringify(
    summaryPayload(data),
  );
  return out;
}
