defmodule PhoenixRest.SeedTest do
  # The dev/CLI seed path (`mix ecto.setup` → priv/repo/seeds.exs), ported from
  # the reference variant's src/db/seed.ts. Unlike `load_profile/1` (which the
  # test tiers use for the manifest-less `correctness` profile), `seed/1` verifies
  # the manifest's digests before loading and its row counts after, so this pins
  # that the `small` profile round-trips.
  #
  # async: false — TRUNCATE ... RESTART IDENTITY is not concurrency-safe with
  # other tests on the same database.
  use PhoenixRest.DataCase, async: false

  alias PhoenixRest.{Repo, Seed}

  defp count(table) do
    [%{"count" => count}] = Repo.query_maps("SELECT count(*)::int AS count FROM #{table}")
    count
  end

  test "loads the small profile, verifying its manifest digests and row counts" do
    assert :ok = Seed.seed("small")

    assert count("users") == 20
    assert count("projects") == 5
    assert count("tasks") == 1000
    assert count("comments") == 1000
  end

  test "advances the identity sequences past the loaded rows" do
    assert :ok = Seed.seed("small")

    # The fixture rows carry explicit ids, which bypass the sequences; a live
    # insert must not collide with them.
    assert [%{"id" => 21}] =
             Repo.query_maps(
               "INSERT INTO users (display_name, email) VALUES ('x', 'x') RETURNING id::int AS id"
             )
  end

  test "is deterministic: a re-seed leaves the same rows" do
    assert :ok = Seed.seed("small")
    first = Repo.query_maps("SELECT id, display_name, email FROM users ORDER BY id")

    assert :ok = Seed.seed("small")
    assert Repo.query_maps("SELECT id, display_name, email FROM users ORDER BY id") == first
  end
end
