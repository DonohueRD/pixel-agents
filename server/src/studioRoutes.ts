/**
 * Studio control API: lets Claude Code (curl) launch / list / stop agents in the
 * standalone office. Bearer-authed with the same token as the hook route.
 *
 *   POST   /api/agents      { directory, prompt?, promptFile? } -> { id }
 *   GET    /api/agents      -> [{ id, directoryName, sessionId }]
 *   DELETE /api/agents/:id
 *
 * Budget guard: launches are refused (429) while the lock file exists or before
 * STUDIO_LAUNCH_NOT_BEFORE (ISO date), so Heads can't be started into a spent
 * monthly limit.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { claudeProvider } from './providers/index.js';
import type { PtySessionManager } from './terminal/ptySessionManager.js';
import { launchStandaloneAgent } from './terminal/standaloneAgentLauncher.js';
import { bearerTokenValid } from './wsAuth.js';

const KEY_BYPASS_PERMISSIONS = 'pixel-agents.bypassPermissions';
const budgetLockPath = () => path.join(os.homedir(), '.pixel-agents', 'studio-budget.lock');

export interface StudioRoutesOptions {
  token: string;
  store: AgentStateStore;
  runtime?: AgentRuntime;
  ptyManager?: PtySessionManager;
}

/** Returns a human reason when launching is blocked, else null. */
export function budgetBlock(now = Date.now(), lockFile = budgetLockPath()): string | null {
  if (fs.existsSync(lockFile)) return `budget lock present (${lockFile})`;
  const notBefore = process.env.STUDIO_LAUNCH_NOT_BEFORE;
  if (notBefore) {
    const t = Date.parse(notBefore);
    if (!Number.isNaN(t) && now < t) return `launches blocked until ${notBefore}`;
  }
  return null;
}

/** Turn promptFile into a short kickoff so a long prompt never hits the command-line limit. */
export function kickoffPrompt(prompt?: string, promptFile?: string): string | undefined {
  if (promptFile) {
    const extra = prompt ? ` ${prompt}` : '';
    return `Read ${promptFile} and follow it as your standing instructions.${extra}`;
  }
  return prompt || undefined;
}

export function registerStudioRoutes(app: FastifyInstance, options: StudioRoutesOptions): void {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!bearerTokenValid(request.headers.authorization, options.token)) {
      reply.code(401).send('unauthorized');
    }
  };

  app.post<{ Body: { directory?: string; prompt?: string; promptFile?: string } }>(
    '/api/agents',
    { preHandler: auth },
    async (request, reply) => {
      const { runtime, ptyManager, store } = options;
      if (!runtime || !ptyManager) return reply.code(503).send({ error: 'terminal unavailable' });
      const { directory, prompt, promptFile } = request.body ?? {};
      if (!directory || !fs.existsSync(directory)) {
        return reply.code(400).send({ error: 'directory missing or not found' });
      }
      if (promptFile && !fs.existsSync(promptFile)) {
        return reply.code(400).send({ error: 'promptFile not found' });
      }
      const blocked = budgetBlock();
      if (blocked) return reply.code(429).send({ error: blocked });

      const id = launchStandaloneAgent(
        { store, runtime, ptyManager, provider: claudeProvider },
        {
          directoryPath: directory,
          bypassPermissions: store.getAdapter()?.getSetting(KEY_BYPASS_PERMISSIONS, false) ?? false,
          prompt: kickoffPrompt(prompt, promptFile),
        },
      );
      if (id === null) return reply.code(500).send({ error: 'launch failed' });
      return { id };
    },
  );

  app.get('/api/agents', { preHandler: auth }, async () =>
    [...options.store.values()].map((a) => ({
      id: a.id,
      directoryName: a.directoryName,
      sessionId: a.sessionId,
    })),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/agents/:id',
    { preHandler: auth },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!options.store.has(id) || !options.runtime)
        return reply.code(404).send({ error: 'no such agent' });
      options.ptyManager?.dispose(id);
      options.runtime.closeAgent(id);
      return { ok: true };
    },
  );
}
