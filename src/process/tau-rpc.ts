import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import readline from "node:readline";

import { piSpec } from "../agents/pi.js";

type PromptPayload =
  | string
  | {
      role?: string;
      content?: Array<{ type?: string; text?: unknown }>;
      text?: unknown;
    }
  | { text?: unknown }
  | unknown;

type TauRpcOptions = {
  argv: string[];
  cwd?: string;
  timeoutMs: number;
  onEvent?: (line: string) => void;
  prompt: PromptPayload;
};

type TauRpcResult = {
  stdout: string;
  stderr: string;
  code: number;
  signal?: NodeJS.Signals | null;
  killed?: boolean;
};

export function normalizePiPrompt(prompt: PromptPayload): {
  text: string;
  coerced: boolean;
} {
  if (typeof prompt === "string") return { text: prompt, coerced: false };

  // Attempt to extract text content from a message-like payload.
  if (prompt && typeof prompt === "object") {
    const content = (prompt as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const parts = content
        .map((c) => {
          if (typeof c === "string") return c;
          if (c && typeof c === "object") {
            const text = (c as { text?: unknown }).text;
            if (typeof text === "string") return text;
          }
          return "";
        })
        .filter(Boolean);
      const combined = parts.join("\n").trim();
      if (combined) return { text: combined, coerced: true };
    }

    const text = (prompt as { text?: unknown }).text;
    if (typeof text === "string") return { text, coerced: true };
  }

  try {
    const json = JSON.stringify(prompt);
    if (json) return { text: json, coerced: true };
  } catch {
    // fall through to string coercion below
  }

  return {
    text: prompt == null ? "" : String(prompt),
    coerced: true,
  };
}

function previewPrompt(prompt: PromptPayload): string | undefined {
  if (typeof prompt === "string") return prompt.slice(0, 120);
  try {
    const json = JSON.stringify(prompt);
    return json ? json.slice(0, 120) : undefined;
  } catch {
    return undefined;
  }
}

class TauRpcClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private stderr = "";
  private buffer: string[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly idleMs = 120;
  private pending:
    | {
        resolve: (r: TauRpcResult) => void;
        reject: (err: unknown) => void;
        timer: NodeJS.Timeout;
        onEvent?: (line: string) => void;
      }
    | undefined;

  constructor(
    private readonly argv: string[],
    private readonly cwd: string | undefined,
  ) {}

  private ensureChild() {
    if (this.child) return;
    this.child = spawn(this.argv[0], this.argv.slice(1), {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (d) => {
      this.stderr += d.toString();
    });
    this.child.on("exit", (code, signal) => {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      if (this.pending) {
        const pending = this.pending;
        this.pending = undefined;
        const out = this.buffer.join("\n");
        clearTimeout(pending.timer);
        // Treat process exit as completion with whatever output we captured.
        pending.resolve({
          stdout: out,
          stderr: this.stderr,
          code: code ?? 0,
          signal,
        });
      }
      this.dispose();
    });
  }

  private handleLine(line: string) {
    if (!this.pending) return;
    this.buffer.push(line);
    this.pending?.onEvent?.(line);

    // Parse the line once to track agent lifecycle signals.
    try {
      const evt = JSON.parse(line) as { type?: string; message?: unknown };

      if (evt?.type === "agent_end") {
        // Tau signals the end of the prompt/response cycle; resolve with all buffered output.
        const pending = this.pending;
        this.pending = undefined;
        const out = this.buffer.join("\n");
        this.buffer = [];
        clearTimeout(pending.timer);
        pending.resolve({ stdout: out, stderr: this.stderr, code: 0 });
        return;
      }
    } catch {
      // ignore malformed/non-JSON lines
    }
  }

  async prompt(
    prompt: PromptPayload,
    timeoutMs: number,
    onEvent?: (line: string) => void,
  ): Promise<TauRpcResult> {
    const { text: promptText, coerced } = normalizePiPrompt(prompt);
    const preview = coerced ? previewPrompt(prompt) : undefined;
    if (coerced) {
      const suffix = preview ? ` (preview: ${preview})` : "";
      console.warn(`tau rpc: coerced non-string prompt to text${suffix}`);
    }

    this.ensureChild();
    if (this.pending) {
      throw new Error("tau rpc already handling a request");
    }
    const child = this.child;
    if (!child) throw new Error("tau rpc child not initialized");
    await new Promise<void>((resolve, reject) => {
      const ok = child.stdin.write(
        `${JSON.stringify({
          type: "prompt",
          message: promptText,
        })}\n`,
        (err) => (err ? reject(err) : resolve()),
      );
      if (!ok) child.stdin.once("drain", () => resolve());
    });
    return await new Promise<TauRpcResult>((resolve, reject) => {
      // Hard cap to avoid stuck relays; agent_end or process exit should usually resolve first.
      const capMs = Math.min(timeoutMs, 5 * 60 * 1000);
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error(`tau rpc timed out after ${capMs}ms`));
        child.kill("SIGKILL");
      }, capMs);
      this.pending = { resolve, reject, timer, onEvent };
    });
  }

  dispose() {
    this.rl?.close();
    this.rl = null;
    if (this.child && !this.child.killed) {
      this.child.kill("SIGKILL");
    }
    this.child = null;
    this.buffer = [];
    this.stderr = "";
  }
}

let singleton: { key: string; client: TauRpcClient } | undefined;

export async function runPiRpc(opts: TauRpcOptions): Promise<TauRpcResult> {
  const key = `${opts.cwd ?? ""}|${opts.argv.join(" ")}`;
  if (!singleton || singleton.key !== key) {
    singleton?.client.dispose();
    singleton = { key, client: new TauRpcClient(opts.argv, opts.cwd) };
  }
  return singleton.client.prompt(opts.prompt, opts.timeoutMs, opts.onEvent);
}

export function resetPiRpc() {
  singleton?.client.dispose();
  singleton = undefined;
}
