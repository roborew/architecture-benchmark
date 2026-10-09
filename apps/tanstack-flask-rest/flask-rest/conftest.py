# conftest.py
#
# Root conftest: its presence (and the explicit insertion below) puts this
# directory on sys.path, so the tests import the `src` package exactly as the
# server entry does (`python -m src.server`).

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
