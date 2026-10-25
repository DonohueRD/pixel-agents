import * as fs from 'fs';

import { CONVERSATION_TITLE_MAX_CHARS, CONVERSATION_TITLE_SCAN_BYTES } from '../../../constants.js';

/**
 * The title Claude Code shows for a session, read from its transcript.
 *
 * Claude Code appends title records as a session goes on, so the newest is
 * near the end: `custom-title` (the user's /rename, which wins), `ai-title`
 * (the one it generates) and `last-prompt` (the fallback for a session too
 * short to have been titled). Only the file's tail is read, then its head
 * (an early title of a session whose tail is one long tool result): a
 * transcript can run to many megabytes.
 */
export function conversationTitle(transcriptPath: string): string | undefined {
  let fd: number;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch {
    return undefined;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const tail = readChunk(fd, Math.max(0, size - CONVERSATION_TITLE_SCAN_BYTES), size);
    const head =
      size > CONVERSATION_TITLE_SCAN_BYTES ? readChunk(fd, 0, CONVERSATION_TITLE_SCAN_BYTES) : '';
    const late = titlesIn(tail);
    const early = titlesIn(head);
    const title = late.custom ?? early.custom ?? late.ai ?? early.ai ?? late.prompt ?? early.prompt;
    return title ? clip(title) : undefined;
  } catch {
    return undefined;
  } finally {
    fs.closeSync(fd);
  }
}

interface Titles {
  custom?: string;
  ai?: string;
  prompt?: string;
}

/** The newest title of each kind in a chunk of JSONL (a cut line at either
 *  end simply fails to parse). */
function titlesIn(chunk: string): Titles {
  const found: Titles = {};
  for (const line of chunk.split('\n')) {
    if (!line.includes('title"') && !line.includes('"last-prompt"')) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const text = (key: string) =>
      typeof record[key] === 'string' && (record[key] as string).trim()
        ? (record[key] as string)
        : undefined;
    if (record.type === 'custom-title') found.custom = text('customTitle') ?? found.custom;
    else if (record.type === 'ai-title') found.ai = text('aiTitle') ?? found.ai;
    else if (record.type === 'last-prompt') found.prompt = text('lastPrompt') ?? found.prompt;
  }
  return found;
}

function readChunk(fd: number, start: number, end: number): string {
  const buf = Buffer.alloc(end - start);
  const read = fs.readSync(fd, buf, 0, buf.length, start);
  return buf.toString('utf8', 0, read);
}

/** One line, at most CONVERSATION_TITLE_MAX_CHARS. */
function clip(title: string): string {
  const line = title.replace(/\s+/g, ' ').trim();
  return line.length > CONVERSATION_TITLE_MAX_CHARS
    ? `${line.slice(0, CONVERSATION_TITLE_MAX_CHARS - 1)}…`
    : line;
}
