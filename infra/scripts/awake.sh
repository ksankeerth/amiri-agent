#!/usr/bin/env bash
# The money switch.
#
#     infra/scripts/awake.sh off   # stop the database and pause the tick (no compute charge while stopped)
#     infra/scripts/awake.sh on    # start both again (the database takes a few minutes)
#     infra/scripts/awake.sh       # say which it is
#
# Writes infra/terraform/awake.auto.tfvars, then deploy.sh plans the change and asks before applying it.
# While stopped, the web app still opens: it shows "paused", and it wakes by itself once the database is up.
# Storage, backups and the database's IP address are still charged while it is stopped.
source "$(dirname "$0")/common.sh"

FILE="$TF/awake.auto.tfvars"
case "${1:-}" in
  on)  echo "awake = true" > "$FILE" ;;
  off) echo "awake = false" > "$FILE" ;;
  "")  if [ -f "$FILE" ]; then cat "$FILE"; else echo "awake = true (the default)"; fi; exit 0 ;;
  *)   echo "infra/scripts/awake.sh on|off" >&2; exit 1 ;;
esac
"$(dirname "$0")/deploy.sh"
