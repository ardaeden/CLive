#!/usr/bin/env bash
# Starts CLive and opens it in the default browser. Optional argument: port (default 8000).
# Set CLIVE_NO_BROWSER=1 to start the server without opening a browser.
cd "$(dirname "$(readlink -f "$0")")" || exit 1

PORT="${1:-8000}"
URL="http://127.0.0.1:$PORT"

PY=""
for cmd in python3 python; do
  if command -v "$cmd" >/dev/null 2>&1 && "$cmd" -c 'import sys; sys.exit(sys.version_info[0] != 3)' 2>/dev/null; then
    PY="$cmd"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3 was not found. Install it with your package manager (e.g. sudo apt install python3) and run this file again."
  exit 1
fi

# Something is already listening on this port: it is either CLive or another program.
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  IS_CLIVE=1
  if command -v curl >/dev/null 2>&1; then
    curl -s -m 2 "$URL/index.html" | grep -q "<title>CLive</title>" || IS_CLIVE=""
  fi
  if [ -z "$IS_CLIVE" ]; then
    echo "Port $PORT is used by another program, not CLive."
    echo "Close that program, or start CLive on another port, for example: ./start.sh 8001"
    exit 1
  fi
  echo "CLive is already running on $URL"
  [ -n "$CLIVE_NO_BROWSER" ] && exit 0
  echo "Opening it in your browser. To restart it, stop the terminal that started it first."
  xdg-open "$URL" >/dev/null 2>&1 &
  exit 0
fi

OPEN="--open"
[ -n "$CLIVE_NO_BROWSER" ] && OPEN=""

if ! "$PY" server.py "$PORT" $OPEN; then
  echo
  echo "The server stopped with an error, see the message above."
  exit 1
fi
