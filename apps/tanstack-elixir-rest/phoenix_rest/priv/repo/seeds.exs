# Seeds the development database from the shared fixture profile
# (`spec/snapshots/<profile>/`), the same CSVs every app variant loads. Ported
# from the reference variant's src/db/seed.ts.
#
#     mix run priv/repo/seeds.exs                              # the "small" profile
#     SEED_PROFILE=correctness mix run priv/repo/seeds.exs
#
# `mix ecto.setup` applies the normative schema first, so this only truncates,
# loads rows, and advances the identity sequences.
PhoenixRest.Seed.seed(System.get_env("SEED_PROFILE") || "small")
