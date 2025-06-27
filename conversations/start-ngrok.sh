#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"

# 1) .env must exist
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found!" >&2
  exit 1
fi

# 2) Load and clean token
set -a
source "$ENV_FILE"
set +a
# strip any stray CR or quotes
NGROK_AUTHTOKEN="${NGROK_AUTHTOKEN//[$'\r"']}"

if [[ -z "$NGROK_AUTHTOKEN" ]]; then
  echo "Error: NGROK_AUTHTOKEN is empty in $ENV_FILE" >&2
  exit 1
fi

# 3) Configure ngrok
echo "Configuring ngrok authtoken…"
ngrok config add-authtoken "$NGROK_AUTHTOKEN"

# 4) Launch tunnel
PORT="${1:-3000}"
echo "Starting ngrok tunnel on port $PORT…"
exec ngrok http "$PORT"
