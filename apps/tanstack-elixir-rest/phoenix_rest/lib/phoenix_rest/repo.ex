defmodule PhoenixRest.Repo do
  use Ecto.Repo,
    otp_app: :phoenix_rest,
    adapter: Ecto.Adapters.Postgres

  @doc """
  Runs `sql` with `params` and returns the rows as string-keyed maps.

  The wire rows are the SQL aliases verbatim (`AS "projectId"`), which is what
  the SPA renders and what the reference variant's postgres.js returns, so the
  controllers can hand the maps straight to `json/2` without a serialization
  layer in between. Column order in the map is irrelevant to JSON output.
  """
  @spec query_maps(String.t(), [term()]) :: [%{optional(String.t()) => term()}]
  def query_maps(sql, params \\ []) do
    %Postgrex.Result{columns: columns, rows: rows} =
      Ecto.Adapters.SQL.query!(__MODULE__, sql, params)

    Enum.map(rows, &Map.new(Enum.zip(columns, &1)))
  end
end
