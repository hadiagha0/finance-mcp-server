// Appends one JSON line per tool call to data/audit_log.jsonl — a governance
// trail showing exactly what was queried, when, and which source rows backed
// the answer. Mirrors the audit_trail.json pattern from the sibling
// financial-research-agent project, adapted to a per-call append-only log.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_LOG_PATH = path.join(__dirname, '..', '..', 'data', 'audit_log.jsonl');

export function logToolCall({ tool, input, citationCount, summary }) {
  const entry = {
    timestamp: new Date().toISOString(),
    tool,
    input,
    citation_count: citationCount,
    summary,
  };
  appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
}
