defmodule PhoenixRestWeb.PageController do
  use PhoenixRestWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
