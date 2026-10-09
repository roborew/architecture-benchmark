defmodule PhoenixRestWeb.Plugs.CORS do
  # CORS for the separate-origin SPA, the equivalent of the reference variant's
  # `cors({ origin: true })` (src/app.ts). Ported as an endpoint plug rather
  # than a router pipeline: a preflight `OPTIONS` names the real path, which the
  # router would answer 404 because no route matches OPTIONS. Halt it here, in
  # front of the router, and the browser sees a successful preflight.
  #
  # Origins are reflected rather than allowlisted: this API serves no cookies or
  # credentials, so there is nothing a reflected origin could smuggle. A
  # credentialed API would need an explicit allowlist instead.
  @moduledoc false

  import Plug.Conn

  # The methods the reference's cors middleware advertises by default.
  @allow_methods "GET,HEAD,PUT,PATCH,POST,DELETE"

  def init(options), do: options

  def call(conn, _options) do
    origin = request_origin(conn)

    conn =
      conn
      |> put_resp_header("access-control-allow-origin", origin)
      # A reflected origin means the response varies by Origin, so a shared
      # cache must key on it.
      |> put_resp_header("vary", "Origin")

    if conn.method == "OPTIONS" do
      conn
      |> put_resp_header("access-control-allow-methods", @allow_methods)
      |> put_resp_header("access-control-allow-headers", requested_headers(conn))
      |> send_resp(204, "")
      |> halt()
    else
      conn
    end
  end

  # `origin: true` reflects the caller's Origin; a request without one (a
  # non-browser client) gets `*`.
  defp request_origin(conn) do
    case get_req_header(conn, "origin") do
      [origin | _] -> origin
      [] -> "*"
    end
  end

  # Echo the headers the preflight asks for, so a client that adds a header the
  # server does not otherwise know about is not blocked.
  defp requested_headers(conn) do
    conn
    |> get_req_header("access-control-request-headers")
    |> List.first()
    |> Kernel.||("")
  end
end
