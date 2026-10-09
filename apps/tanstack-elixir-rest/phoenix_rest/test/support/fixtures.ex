defmodule PhoenixRest.Fixtures do
  # The shared `spec/snapshots/correctness` fixture, loaded by every data test.
  #
  # `seed_fixture/1` is an ExUnit setup callback (called as `setup :seed_fixture`)
  # and therefore runs *after* the CaseTemplate's `setup`, which is what checks
  # out the sandbox connection — the inserts must land inside that transaction so
  # they roll back with the test.
  @moduledoc false

  @profile "correctness"

  @doc "Loads the correctness profile into the test's sandbox transaction."
  @spec seed_fixture(map()) :: :ok
  def seed_fixture(_context) do
    PhoenixRest.Seed.load_profile(@profile)
    :ok
  end
end
