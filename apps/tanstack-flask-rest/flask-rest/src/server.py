# src/server.py
#
# The executable entry. The only module allowed to bind a port — importing
# `create_app` anywhere else must never open a socket.
#
#   python -m src.server             # http://localhost:4000
#   python -m src.server --reload    # same, restarting on file changes
#
# The module-level `app` also makes this a WSGI entry point for a production
# server: `gunicorn src.server:app`.

import signal
import sys

from src.app import create_app
from src.config import env

app = create_app()


def _raise_keyboard_interrupt(signum, frame) -> None:
    # The werkzeug dev server shuts down cleanly on SIGINT (Ctrl-C); route
    # SIGTERM there too so a container stop behaves the same way.
    raise KeyboardInterrupt


def main() -> None:
    reload = "--reload" in sys.argv[1:]

    if not reload:
        signal.signal(signal.SIGTERM, _raise_keyboard_interrupt)

    print(f"[flask-rest] listening on http://localhost:{env.PORT}")

    try:
        # threaded: a SPA's TanStack Query layer fires several parallel
        # fetches; the dev server should answer them concurrently. The
        # debugger stays off deliberately — this is an API, and the error
        # handler answers JSON, not an interactive HTML page.
        app.run(
            host="0.0.0.0",
            port=env.PORT,
            threaded=True,
            debug=False,
            use_reloader=reload,
        )
    except KeyboardInterrupt:
        pass
    finally:
        print("[flask-rest] shutting down")


if __name__ == "__main__":
    main()
