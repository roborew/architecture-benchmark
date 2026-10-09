defmodule PhoenixRest.Spec do
  # The normative spec lives at the repo root (`spec/`), not inside the app, so
  # the schema task and the seed loader resolve it the same way. Walking up until
  # `spec/schema.sql` is found keeps this correct regardless of where the project
  # sits, matching the reference variant's src/db/spec-dir.ts.
  @moduledoc false

  @marker Path.join(["spec", "schema.sql"])

  @doc "Absolute path to the repo root containing `spec/`."
  @spec root() :: String.t()
  def root, do: find_root(File.cwd!())

  @doc "Absolute path to `spec/schema.sql`."
  @spec schema_path() :: String.t()
  def schema_path, do: Path.join(root(), @marker)

  @doc "Absolute path to `spec/snapshots/`."
  @spec snapshots_dir() :: String.t()
  def snapshots_dir, do: Path.join(root(), "spec/snapshots")

  defp find_root(directory) do
    if File.exists?(Path.join(directory, @marker)) do
      directory
    else
      parent = Path.dirname(directory)

      # Stop at the filesystem root; `Path.dirname("/") == "/"` would loop.
      if parent == directory do
        raise "Could not locate the spec directory: no #{@marker} found in any parent of #{directory}"
      end

      find_root(parent)
    end
  end
end
