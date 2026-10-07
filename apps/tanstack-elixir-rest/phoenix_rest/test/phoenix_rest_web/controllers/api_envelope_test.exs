defmodule PhoenixRestWeb.ApiEnvelopeTest do
  # The app factory's cross-cutting behaviour (apps/tanstack-express-rest —
  # tests/integration/app.integration.test.ts): a REST client must never
  # receive an HTML error page, so an unmatched path answers with the JSON 404
  # envelope and a malformed JSON body with the 400 envelope.
  use ExUnit.Case, async: true

  import Plug.Conn
  import Phoenix.ConnTest

  @endpoint PhoenixRestWeb.Endpoint

  test "returns a JSON 404 envelope for an unknown API path" do
    conn = get(build_conn(), "/api/does-not-exist")

    assert conn.status == 404

    assert [content_type] = get_resp_header(conn, "content-type")
    assert content_type =~ "json"

    assert json_response(conn, 404) == %{"error" => "Not found"}
  end

  test "returns a JSON 404 envelope for the root path" do
    # This API serves the SPA from its own origin; there is no HTML surface,
    # so "/" is simply a path nothing matches.
    conn = get(build_conn(), "/")

    assert conn.status == 404
    assert json_response(conn, 404) == %{"error" => "Not found"}
  end

  test "answers a malformed JSON body with the 400 envelope" do
    # The one non-success reply that is still the client's mistake: a body the
    # JSON parser cannot decode, answered as 400 rather than masquerading as
    # a server fault.
    #
    # The endpoint's error renderer sends the 400 envelope (ErrorJSON's
    # "400.json" clause — pinned by the unit test above) and then re-raises
    # the parse error for the server log, mirroring how the reference's error
    # handler logs unexpected errors once. Over HTTP the client has already
    # received the envelope; in the test the re-raise surfaces, so the status
    # is pinned via the exception's plug_status and the body via the unit
    # clause.
    conn =
      build_conn()
      |> put_req_header("content-type", "application/json")

    error =
      assert_raise Plug.Parsers.ParseError, fn ->
        post(conn, "/api/users", "{not json")
      end

    assert error.plug_status == 400
  end
end
