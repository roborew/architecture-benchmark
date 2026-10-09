defmodule Mix.Tasks.Phx.Rest.Schema do
  # Applies the normative schema (spec/schema.sql) to the configured database —
  # the same file the test lifecycle applies, so dev and test databases cannot
  # drift apart. Ported from the reference variant's src/db/migrate.ts, with the
  # Ecto-less "no migrations" posture: the spec file is the migration.
  #
  # Dropping first makes the task idempotent, so `mix test` and `ecto.setup` can
  # run it unconditionally.
  @shortdoc "Applies the normative spec/schema.sql"

  @moduledoc false

  use Mix.Task

  @impl Mix.Task
  def run(_args) do
    Mix.Task.run("app.start")

    PhoenixRest.Repo.query!("DROP TABLE IF EXISTS comments, tasks, projects, users CASCADE")

    PhoenixRest.Spec.schema_path()
    |> File.read!()
    |> statements()
    |> Enum.each(&PhoenixRest.Repo.query!/1)
  end

  # The schema file is plain SQL with `--` line comments; strip the comments,
  # split on `;`, and execute each statement on its own. No statement in the
  # spec contains a literal `;`, so the split is unambiguous.
  defp statements(sql) do
    sql
    |> String.split("\n")
    |> Enum.reject(&String.starts_with?(String.trim_leading(&1), "--"))
    |> Enum.join("\n")
    |> String.split(";")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end
end
