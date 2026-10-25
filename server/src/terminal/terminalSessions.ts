/**
 * The standalone terminal surface, as the rest of the server sees it.
 *
 * Two implementations:
 * - PtySessionManager (the default, and the only one that ships): PTYs live in
 *   the server process and die with it.
 * - RemotePtySessions (development only, `--pty-host`): PTYs live in a separate
 *   long-lived process, so restarting the server leaves every agent running and
 *   the next server reattaches to them (see ptyHost.ts).
 */

export interface CreateTerminalOptions {
  agentId: number;
  command: string;
  args: string[];
  cwd: string;
  /** The whole environment the terminal runs with (TERM is set over it). */
  env: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface TerminalExit {
  exitCode: number;
  signal?: number;
}

/**
 * A screen to replay to a fresh terminal, and where in the output stream it
 * was taken: every chunk numbered `seq` or lower is already drawn in it, every
 * later one is not. That is what lets a client attach mid-stream without a
 * byte dropped or doubled.
 */
export interface TerminalReplay {
  data: string;
  seq: number;
  cols: number;
  rows: number;
}

/** One agent's terminal. */
export interface TerminalSession {
  readonly agentId: number;
  /** The process id, or -1 while a remote spawn is still in flight. */
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  readonly hasExited: boolean;
  /** Output chunks, numbered 1, 2, 3… in order (see TerminalReplay). */
  onData(listener: (chunk: string, seq: number) => void): () => void;
  /** Fires once. Registered after the exit, it still fires (asynchronously). */
  onExit(listener: (exit: TerminalExit) => void): () => void;
  replay(): Promise<TerminalReplay>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/** Every agent's terminal: what launch, attach, close and shutdown act on. */
export interface TerminalSessions {
  /** Whether the operator enabled the terminal (false with --no-terminal). */
  readonly enabled: boolean;
  isAvailable(): boolean;
  /** Why the terminal is unavailable, or null when it works. */
  unavailableReason(): string | null;
  /** The PTY module in use (diagnostics only). */
  moduleId(): string | null;
  /** Spawn a terminal for an agent. Throws when unavailable. */
  create(options: CreateTerminalOptions): TerminalSession;
  get(agentId: number): TerminalSession | undefined;
  has(agentId: number): boolean;
  /** Kill and forget an agent's terminal. No-op when there isn't one. */
  dispose(agentId: number): void;
  /** Terminals still running from before this server started: they
   *  outlived a restart (the saved agent list says whose they are). */
  survivors(): TerminalSession[];
  /** The server is stopping. In process: kill every terminal and wait for
   *  them (each exit closes its agent). With the PTY host: just disconnect,
   *  leaving them running. */
  shutdown(): Promise<void>;
}
