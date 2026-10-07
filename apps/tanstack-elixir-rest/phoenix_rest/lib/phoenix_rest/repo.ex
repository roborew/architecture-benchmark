defmodule PhoenixRest.Repo do
  use Ecto.Repo,
    otp_app: :phoenix_rest,
    adapter: Ecto.Adapters.Postgres
end
