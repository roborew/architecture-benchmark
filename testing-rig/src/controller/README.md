# Controller (TODO: M2)

Trial lifecycle state machine: validate experiment YAML + manifests, host and
fixture eligibility checks, image builds + digests, per-trial/per-variant
rotated Compose lifecycle (unique project name, allocated APP_PORT), reset /
load canonical fixtures / verify schema + row hashes, run suites, collect
artifacts, and `try/finally` teardown of stacks, networks, and volumes.

See the plan §6 lifecycle diagram and `../README.md` milestone map.
