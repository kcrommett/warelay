#!/bin/bash
cd /Users/shuv/repos/forks/warelay
export PATH="/Users/shuv/.local/bin:/Users/shuv/.bun/bin:/opt/homebrew/bin:$PATH"
exec pnpm run dev:relay "$@"
