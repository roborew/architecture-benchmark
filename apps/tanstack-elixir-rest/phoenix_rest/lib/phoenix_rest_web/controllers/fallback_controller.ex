defmodule PhoenixRestWeb.FallbackController do
  # Maps an `{:error, %PhoenixRestWeb.ApiError{}}` returned by a controller
  # action onto its status and payload — the router-level equivalent of the
  # reference variant's error handler (src/middleware/error-handler.ts) for the
  # outcomes a controller decided on. Anything else (an unexpected failure) is
  # left to the endpoint's error renderer, which answers 500.
  @moduledoc false

  use PhoenixRestWeb, :controller

  alias PhoenixRestWeb.ApiError

  def call(conn, {:error, %ApiError{status: status, payload: payload}}) do
    conn
    |> put_status(status)
    |> json(payload)
  end
end
