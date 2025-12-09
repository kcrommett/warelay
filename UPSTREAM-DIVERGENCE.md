# Warelay Fork: Claude Code Support

This document describes the modifications made to our warelay fork to support Claude Code as the backend agent instead of the default `pi` (tau) agent.

## Problem Statement

The upstream warelay project is designed to work with the `pi` (tau) coding agent, which uses a specific RPC protocol and command-line flags. When attempting to use Claude Code instead, several issues arose:

1. **Pi-specific flags**: Warelay hardcodes flags like `--session`, `--continue`, `--thinking`, and `--mode rpc` that Claude Code doesn't recognize
2. **RPC mode**: Warelay uses a special RPC mode for pi that expects JSON-formatted events on stdin/stdout
3. **Session management**: Warelay manages session state and injects session-related arguments
4. **PATH issues**: launchd doesn't include `~/.local/bin` in PATH, so `claude` command wasn't found

## Solution

We modified `src/auto-reply/command-reply.ts` to detect when the configured command is Claude Code and use a simpler direct subprocess execution path instead of the pi RPC mode.

### Code Changes

**File: `src/auto-reply/command-reply.ts`**

1. **Import the command runner** (line 18):
   ```typescript
   import { runCommandWithTimeout, type runCommandWithTimeout as RunCommandWithTimeoutType } from "../process/exec.js";
   ```

2. **Detect Claude commands** (lines 363-366):
   ```typescript
   // Check if this is a claude command (not pi/tau) - skip pi-specific flags
   const isClaudeCommand = reply.command[0]?.includes("claude");
   logger.info({ isClaudeCommand, command: reply.command[0] }, "agent detection");
   ```

3. **Skip `--thinking` flag for Claude** (lines 458-470):
   ```typescript
   // Only add --thinking for pi/tau, not for claude
   if (!isClaudeCommand && thinkLevel && thinkLevel !== "off") {
     // ... existing --thinking logic
   }
   ```

4. **Direct subprocess execution for Claude** (lines 573-586):
   ```typescript
   // For Claude commands, use simple subprocess execution (no RPC mode)
   if (isClaudeCommand) {
     logger.info({ argv: finalArgv, cwd: reply.cwd }, "running claude command directly");
     const result = await runCommandWithTimeout(finalArgv, {
       timeoutMs: timeoutMs ?? 600_000,
       cwd: reply.cwd
     });
     return {
       stdout: result.stdout,
       stderr: result.stderr,
       code: result.code ?? 0,
       signal: result.signal,
     };
   }
   ```

## Configuration

### Working Configuration (`warelay.json`)

```json
{
  "logging": {
    "level": "debug",
    "file": "/tmp/warelay/warelay.log"
  },
  "inbound": {
    "allowFrom": ["+14256819216"],
    "timestampPrefix": "America/Los_Angeles",
    "reply": {
      "mode": "command",
      "cwd": "/Users/shuv/clawd",
      "command": ["/Users/shuv/.local/bin/claude", "-p", "--dangerously-skip-permissions", "--output-format", "text", "{{BodyStripped}}"],
      "timeoutSeconds": 600
    }
  }
}
```

### Key Configuration Notes

1. **Full path to Claude**: Use `/Users/shuv/.local/bin/claude` (not just `claude`) because launchd doesn't have the same PATH as interactive shells

2. **No session block**: Remove any `session` configuration - warelay's session management is pi-specific

3. **No agent block**: Don't specify `agent.kind` - warelay only accepts "pi" as a valid kind, but our code detects Claude via the command path

4. **Minimal flags**: Only include flags that Claude Code actually supports:
   - `-p`: Print mode (non-interactive)
   - `--dangerously-skip-permissions`: Skip permission prompts
   - `--output-format text`: Plain text output (not JSON)
   - `{{BodyStripped}}`: The message body template

## How It Works

When a WhatsApp message arrives:

1. Warelay receives the message and prepares to run the command
2. Our code checks if the command path contains "claude"
3. If Claude is detected:
   - Skip adding `--thinking` flag
   - Skip the pi RPC mode entirely
   - Execute Claude directly as a subprocess with `runCommandWithTimeout`
   - Capture stdout/stderr and return the result
4. If pi/tau is detected:
   - Use the existing RPC mode with all pi-specific flags

## Verifying It Works

Check the logs at `/tmp/warelay/warelay.log` for:

```
"marker":"REBUILD_2025_12_09_0735"  # Confirms new code is loaded
"isClaudeCommand":true              # Claude detected
"running claude command directly"   # Using direct execution
"exitCode":0                        # Successful execution
```

## Upstream Divergence

This fork diverges from upstream in one file:

- **`src/auto-reply/command-reply.ts`**: ~25 lines added for Claude detection and direct execution

The changes are minimal and non-breaking - pi/tau commands continue to work exactly as before. Only commands containing "claude" in the path take the new code path.

## Rebuilding After Changes

After modifying the source:

```bash
cd /Users/shuv/repos/forks/warelay
npm run build
launchctl unload ~/Library/LaunchAgents/com.steipete.warelay.plist
launchctl load ~/Library/LaunchAgents/com.steipete.warelay.plist
```

## Troubleshooting

### "spawn claude ENOENT"
Use full path `/Users/shuv/.local/bin/claude` instead of just `claude`

### "error: unknown option '--session'"
Remove the `session` block from config

### "error: unknown option '--thinking'"
Clear session state: `rm -rf ~/.clawdis/sessions/*`

### "error: unknown option '--mode'"
This was the final issue - fixed by the direct execution path that bypasses RPC mode entirely

### Changes not taking effect
1. Verify build completed: `npm run build`
2. Check dist file has changes: `grep "isClaudeCommand" dist/auto-reply/command-reply.js`
3. Fully restart service: `launchctl unload` then `launchctl load`
