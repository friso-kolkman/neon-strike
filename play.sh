#!/bin/bash
# NEON STRIKE launcher: serves the game locally and opens it in your browser.
cd "$(dirname "$0")"
PORT="${1:-8765}"
( sleep 1; open "http://localhost:$PORT" ) &
echo "NEON STRIKE running at http://localhost:$PORT  (ctrl-C to stop)"
python3 -m http.server "$PORT"
