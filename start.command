#!/bin/bash
# Double-click to launch the Loan vs. Sell Analyzer in your browser.
cd "$(dirname "$0")" || exit 1
PORT=8766
if curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html"; then
  open "http://127.0.0.1:$PORT/index.html"; echo "Already running — opened in your browser."; exit 0
fi
echo "Starting Loan vs. Sell Analyzer on http://127.0.0.1:$PORT ..."
( sleep 1; open "http://127.0.0.1:$PORT/index.html" ) &
echo "Leave this window open while you use the app. Close it (or Ctrl+C) to stop."
python3 serve.py
