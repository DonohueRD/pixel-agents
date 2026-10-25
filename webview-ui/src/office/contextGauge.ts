/**
 * Agents' context gauges, shared by the label over each character
 * (ToolOverlay) and the bar along the foot of each agent card (AgentCard).
 * The fill is the context LEFT, like a health bar; the colour warns by the
 * share used, in the steps of the user's Claude Code status line.
 */

import { useSyncExternalStore } from 'react';

import {
  CONTEXT_GAUGE_COLOR_OK,
  CONTEXT_GAUGE_COLOR_RED,
  CONTEXT_GAUGE_COLOR_YELLOW,
  CONTEXT_RED_THRESHOLD,
  CONTEXT_YELLOW_THRESHOLD,
} from '../constants.js';

/** The gauge colour for a share of the context used (0-1). */
export function contextColor(usedRatio: number): string {
  if (usedRatio > CONTEXT_RED_THRESHOLD) return CONTEXT_GAUGE_COLOR_RED;
  if (usedRatio >= CONTEXT_YELLOW_THRESHOLD) return CONTEXT_GAUGE_COLOR_YELLOW;
  return CONTEXT_GAUGE_COLOR_OK;
}

// Each agent's share used, as the latest agentContextUsage said (the server
// re-sends them on every connect). React reads it per card, so a card
// re-renders when its own agent's context moves.
const usedById = new Map<number, number>();
const listeners = new Set<() => void>();

/** Record an agentContextUsage (useExtensionMessages). */
export function setAgentContextUsed(id: number, contextTokens: number, maxTokens: number): void {
  if (!(contextTokens > 0) || !(maxTokens > 0)) return;
  const used = Math.min(1, contextTokens / maxTokens);
  if (usedById.get(id) === used) return;
  usedById.set(id, used);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** An agent's share of context used (0-1), or null before its first turn. */
export function useAgentContextUsed(id: number): number | null {
  return useSyncExternalStore(subscribe, () => usedById.get(id) ?? null);
}
