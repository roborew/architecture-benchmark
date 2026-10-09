defmodule PhoenixRestWeb.ErrorJSON do
  # The JSON envelopes this API answers failures with, ported from the
  # reference variant's error handler (src/middleware/error-handler.ts and
  # src/middleware/not-found.ts): a REST client never receives an HTML error
  # page, and the internals never reach the client.
  #
  # Invoked by the endpoint (config/config.exs — render_errors lists this
  # module as the only error format) whenever a raised exception carries a
  # plug_status, and by the router for an unmatched path.
  @moduledoc false

  # A body the JSON parser could not decode — the client's mistake, answered
  # as 400 rather than masquerading as a server fault (Plug.Parsers.ParseError
  # carries plug_status: 400).
  def render("400.json", _assigns), do: %{"error" => "Invalid JSON body"}

  # An unmatched path (src/middleware/not-found.ts).
  def render("404.json", _assigns), do: %{"error" => "Not found"}

  # Any unexpected failure — the generic envelope; the underlying error is
  # logged once by the endpoint, never leaked to the client.
  def render("500.json", _assigns), do: %{"error" => "Internal server error"}

  # Anything else that reached the error renderer is equally unexpected.
  def render(_template, _assigns), do: %{"error" => "Internal server error"}
end
