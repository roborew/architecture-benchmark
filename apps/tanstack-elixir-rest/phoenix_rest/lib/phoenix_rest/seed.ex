defmodule PhoenixRest.Seed do
  # Loads a canonical fixture profile from `spec/snapshots/<profile>/` into
  # Postgres, so every app variant ends up with byte-identical rows
  # (spec/seed-spec.md). Ported from the reference variant's src/db/seed.ts and
  # tests/fixtures/load.ts.
  #
  # The CSVs are the single source of truth — this module never generates rows
  # itself, so it cannot drift from the golden digests the benchmark rig verifies.
  #
  # The reference streams the files in with `COPY … FROM STDIN`; here the rows
  # are inserted in bounded chunks of multi-row `VALUES`, which needs no special
  # driver support and is still one statement per chunk.
  #
  # `load_profile/1` is what the test tiers call (the `correctness` profile has
  # no manifest, so it cannot go through `seed/1`); `seed/1` is the dev/CLI path
  # and additionally verifies the manifest's digests and row counts when one
  # exists.
  @moduledoc false

  # Insertion order respects the foreign keys: users and projects before tasks,
  # and tasks before comments.
  @tables ~w(users projects tasks comments)

  # Well under Postgres's 65535-parameter ceiling for the widest table (tasks,
  # 8 columns → 4000 parameters).
  @chunk_size 500

  # Postgres infers a parameter's type from the column it is inserted into, and
  # Postgrex then has to encode the Elixir value against that type. A CSV value
  # is always a string, so the columns that are not text are converted here; a
  # text parameter is passed through untouched.
  @integer_columns ~w(id project_id assignee_id task_id author_id)
  @timestamp_columns ~w(created_at updated_at)

  @doc """
  Loads the profile's rows into an already-empty schema, then advances the
  identity sequences past the explicit fixture ids.
  """
  @spec load_profile(String.t()) :: :ok
  def load_profile(profile) do
    directory = profile_directory(profile)

    Enum.each(@tables, fn table ->
      directory
      |> parse_csv(table)
      |> insert_rows(table)
    end)

    advance_sequences()
    :ok
  end

  @doc """
  Truncates the graph, loads the profile, and verifies the manifest when the
  profile carries one.
  """
  @spec seed(String.t()) :: :ok
  def seed(profile) do
    directory = profile_directory(profile)
    manifest = load_manifest(directory)

    if manifest, do: verify_digests(directory, manifest["files"])

    truncate()
    load_profile(profile)

    if manifest, do: verify_row_counts(manifest["rowCounts"])
    :ok
  end

  # Available profiles are exactly the directories under `spec/snapshots/`.
  defp profile_directory(profile) do
    directory = Path.join(PhoenixRest.Spec.snapshots_dir(), profile)

    unless File.dir?(directory) do
      raise "Unknown seed profile #{inspect(profile)}.\n" <>
              "Expected fixtures at: #{directory}\n" <>
              "Generate them with:\n" <>
              "  node testing-rig/src/fixtures/generate-fixture.mjs --profile #{profile} --out spec/snapshots/#{profile}"
    end

    directory
  end

  defp load_manifest(directory) do
    path = Path.join(directory, "manifest.json")
    if File.exists?(path), do: path |> File.read!() |> Jason.decode!(), else: nil
  end

  # Unquoted CSV, exactly like spec/seed-spec.md: fixture values never contain
  # commas, quotes or newlines.
  defp parse_csv(directory, table) do
    [header | lines] =
      directory
      |> Path.join("#{table}.csv")
      |> File.read!()
      |> normalise_newlines()
      |> String.trim_trailing("\n")
      |> String.split("\n")

    columns = header |> String.split(",") |> Enum.map(&String.trim/1)

    rows =
      lines
      |> Enum.reject(&(&1 == ""))
      |> Enum.map(fn line ->
        line
        |> String.split(",")
        |> Enum.zip(columns)
        |> Enum.map(fn {value, column} -> normalise(column, value) end)
      end)

    {columns, rows}
  end

  # A checkout with `core.autocrlf=true` rewrites every CSV to CRLF; the values
  # are unchanged, so the loader normalises before splitting (and before hashing
  # in `verify_digests/2`, which the manifest recorded over LF bytes).
  defp normalise_newlines(content) do
    content
    |> String.replace("\r\n", "\n")
    |> String.replace("\r", "\n")
  end

  # An empty assignee_id means "unassigned"; every other empty value would have
  # been rejected by the schema's NOT NULL columns.
  defp normalise(column, "") when column in ["assignee_id"], do: nil
  defp normalise(column, value) when column in @integer_columns, do: String.to_integer(value)
  defp normalise(column, value) when column in @timestamp_columns, do: parse_timestamp(value)
  defp normalise(_column, value), do: value

  # The fixture timestamps are ISO 8601 UTC at whole-second precision.
  defp parse_timestamp(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _offset} -> datetime
      {:error, reason} -> raise "Invalid fixture timestamp #{inspect(value)}: #{reason}"
    end
  end

  defp insert_rows({_columns, []}, _table), do: :ok

  defp insert_rows({columns, rows}, table) do
    column_list = Enum.join(columns, ", ")

    rows
    |> Enum.chunk_every(@chunk_size)
    |> Enum.each(fn chunk ->
      {values, params} = values_clause(chunk, length(columns))
      PhoenixRest.Repo.query!("INSERT INTO #{table} (#{column_list}) VALUES #{values}", params)
    end)
  end

  defp values_clause(rows, column_count) do
    {tuples, params, _next} =
      Enum.reduce(rows, {[], [], 1}, fn row, {tuples, params, next} ->
        indexes = Enum.to_list(next..(next + column_count - 1))
        tuple = "(" <> Enum.map_join(indexes, ", ", &"$#{&1}") <> ")"
        {[tuple | tuples], params ++ row, next + column_count}
      end)

    {tuples |> Enum.reverse() |> Enum.join(", "), params}
  end

  # Fixture rows carry explicit ids, which bypass the identity sequences.
  # Advance them past the loaded rows or the next live insert collides
  # (spec/seed-spec.md, "Identity sequence advancement").
  defp advance_sequences do
    Enum.each(@tables, fn table ->
      PhoenixRest.Repo.query!(
        "SELECT setval(pg_get_serial_sequence('#{table}', 'id'), " <>
          "COALESCE((SELECT max(id) FROM #{table}), 1))"
      )
    end)
  end

  defp truncate do
    # Truncating the leaves with CASCADE clears the whole graph in one statement,
    # in FK-safe order, so a re-seed cannot collide with rows a previous run left
    # behind.
    PhoenixRest.Repo.query!(
      "TRUNCATE TABLE comments, tasks, projects, users RESTART IDENTITY CASCADE"
    )
  end

  # Fail before touching the database if a CSV no longer matches its recorded
  # digest — otherwise a corrupt fixture would seed quietly-wrong rows.
  defp verify_digests(directory, files) do
    Enum.each(files, fn %{"name" => name, "sha256" => expected} ->
      actual =
        directory
        |> Path.join(name)
        |> File.read!()
        |> normalise_newlines()
        |> then(&:crypto.hash(:sha256, &1))
        |> Base.encode16(case: :lower)

      if actual != expected do
        raise "Digest mismatch for #{name}\n" <>
                "  expected #{expected}\n" <>
                "  actual   #{actual}\n" <>
                "The fixtures are corrupt or were regenerated; re-run the generator."
      end
    end)
  end

  defp verify_row_counts(row_counts) do
    Enum.each(row_counts, fn {table, expected} ->
      %Postgrex.Result{rows: [[actual]]} =
        PhoenixRest.Repo.query!("SELECT count(*)::int FROM #{table}")

      if actual != expected do
        raise "Row count mismatch for #{table}: expected #{expected}, loaded #{actual}"
      end
    end)
  end
end
