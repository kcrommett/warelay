#!/bin/bash
tmux kill-session -t warelay-relay 2>/dev/null
tmux new-session -d -s warelay-relay 'warelay relay --provider twilio --verbose'
