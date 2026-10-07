defmodule PhoenixRestWeb.ErrorJSONTest do
  # The JSON error envelopes this API answers every failure with — ported from
  # the reference variant's error handler (src/middleware/error-handler.ts and
  # src/middleware/not-found.ts): a client never receives an HTML error page.
  use ExUnit.Case, async: true

  test "renders 400 with the invalid JSON body envelope" do
    assert PhoenixRestWeb.ErrorJSON.render("400.json", %{}) == %{
             "error" => "Invalid JSON body"
           }
  end

  test "renders 404 with the not found envelope" do
    assert PhoenixRestWeb.ErrorJSON.render("404.json", %{}) == %{"error" => "Not found"}
  end

  test "renders 500 with the internal error envelope" do
    assert PhoenixRestWeb.ErrorJSON.render("500.json", %{}) == %{
             "error" => "Internal server error"
           }
  end
end
