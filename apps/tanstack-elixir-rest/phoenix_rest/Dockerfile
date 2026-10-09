# syntax=docker/dockerfile:1
#
# phoenix archetype (plan §3.3/§3.4): build the Phoenix app in prod mode
# (deps + compiled app + digested assets), then run a `mix release` in a slim
# Erlang runtime. Chosen over `mix phx.server` because a release is the
# canonical, self-contained production start and does not ship the Elixir
# toolchain, sources, or `_build`/`deps` to the runtime image.
#
# Base images: `elixir:1.18-otp-27-alpine` matches `mix.exs` (`elixir: "~> 1.15"`)
# and the project's OTP-27 toolchain. That image is itself `FROM erlang:27-alpine`,
# so the runtime uses that same base for a guaranteed ERTS/ABI match — avoiding a
# bare-alpine guess at the matching `libstdc++`/`openssl`/`ncurses` versions.

FROM elixir:1.18-otp-27-alpine AS build

# git: `mix deps.get` fetches the heroicons github dependency. build-base: any
# NIF/OS build steps in the prod dependency tree.
RUN apk add --no-cache build-base git

ENV MIX_ENV=prod \
    LANG=C.UTF-8

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

# Fetch and compile deps first (layer-cache friendly). config/*.exs is copied
# before `deps.compile` so a config change invalidates dependency compilation,
# matching the upstream Phoenix release Dockerfile.
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mkdir config
COPY config/config.exs config/prod.exs config/
RUN mix deps.compile

COPY priv priv
COPY lib lib
COPY assets assets

# Compile first: the esbuild config aliases `phoenix-colocated/phoenix_rest` to
# the app's colocated-hooks output under `_build/$MIX_ENV/lib/phoenix_rest`,
# which `mix compile` generates. Assets must therefore be built after compile.
RUN mix compile

# Builds css/js and runs `phx.digest` (see mix.exs `assets.deploy`), producing
# the priv/static/cache_manifest.json that config/prod.exs points at.
RUN mix assets.deploy

# runtime.exs is evaluated at boot, so it needs no recompilation.
COPY config/runtime.exs config/

RUN mix release

# ---------------------------------------------------------------------------

FROM erlang:27-alpine AS runtime

ENV MIX_ENV=prod \
    LANG=C.UTF-8 \
    PHX_SERVER=true \
    PORT=4000

WORKDIR /app

# Non-root runtime user. The release owns its root so it can create its tmp dir.
RUN addgroup -S app && adduser -S -G app app

COPY --from=build --chown=app:app /app/_build/prod/rel/phoenix_rest ./
RUN chown app:app /app

USER app

EXPOSE 4000

# `mix release` ships bin/phoenix_rest; PHX_SERVER (above) makes runtime.exs
# start the endpoint on PORT (4000).
CMD ["/app/bin/phoenix_rest", "start"]
