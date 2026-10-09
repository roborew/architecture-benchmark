defmodule PhoenixRestWeb.Params do
  # Route- and query-param helpers shared by the REST controllers, so the
  # "raw query string, Express-style" reading and the `:id` → 400 mapping live in
  # one place instead of being repeated per controller.
  @moduledoc false

  alias PhoenixRest.QueryParams
  alias PhoenixRestWeb.ApiError

  @doc """
  The request's query params, Express-style: a repeated param arrives as a list
  so the validators can reject it. Plug collapses repeats on `conn.query_params`,
  which would hide the client bug being reported.
  """
  @spec query(Plug.Conn.t()) :: %{optional(String.t()) => String.t() | [String.t()]}
  def query(conn), do: QueryParams.parse_query(conn.query_string)

  @doc "The raw `q` search value from the query string."
  @spec search_term(Plug.Conn.t()) :: term()
  def search_term(conn), do: conn |> query() |> Map.get("q")

  @doc """
  The `:id` a detail/update/delete URL names, or `{:error, %ApiError{}}` with the
  400 envelope. Keeping this at the controller edge means a non-numeric id is a
  clear 400 rather than a Postgres cast failure surfaced as a 500.
  """
  @spec id(term()) :: {:ok, integer()} | {:error, ApiError.t()}
  def id(raw) do
    case QueryParams.parse_id_param(raw) do
      {:ok, id} -> {:ok, id}
      {:error, message} -> {:error, ApiError.bad_request(message)}
    end
  end
end
