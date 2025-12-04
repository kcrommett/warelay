#!/bin/bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.steipete.warelay.plist"
LABEL="com.steipete.warelay"
USER_ID=$(id -u)

echo "Restarting $LABEL using $PLIST"
if [ ! -f "$PLIST" ]; then
  echo "Error: plist not found at $PLIST" >&2
  exit 1
fi

launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$USER_ID" "$PLIST"
launchctl kickstart -k "gui/$USER_ID/$LABEL"

launchctl list | grep "$LABEL" || {
  echo "Warning: $LABEL not found in launchctl list" >&2
  exit 1
}
