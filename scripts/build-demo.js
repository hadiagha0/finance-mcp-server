// Builds demo/index.html: takes demo/template.html (the UI shell) and injects
// a compact copy of the real dataset (data/*.csv) so the page is a true,
// self-contained replay of the MCP server's tool logic — same numbers, same
// analysis, no server or network access required. Mirrors the sibling
// financial-research-agent project's scripts/build_demo.js pattern.
//
// Run: node scripts/build-demo.js

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const columns = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { values.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    values.push(cur);
    const record = {};
    columns.forEach((c, i) => { record[c] = values[i]; });
    return record;
  });
}

const coa = parseCsv(readFileSync(path.join(ROOT, 'data', 'chart_of_accounts.csv'), 'utf8'));
const gl = parseCsv(readFileSync(path.join(ROOT, 'data', 'gl_transactions.csv'), 'utf8'));
const tb = parseCsv(readFileSync(path.join(ROOT, 'data', 'trial_balance.csv'), 'utf8'));

const embedded = {
  accounts: coa.map((a) => [a.account_code, a.account_name, a.account_type, a.statement, a.normal_balance]),
  glRows: gl.map((r) => [r.transaction_id, r.date, r.period, r.account_code, Number(r.debit), Number(r.credit), r.description, r.source_doc]),
  tbRows: tb.map((r) => [r.period, r.account_code, Number(r.debit), Number(r.credit), r.ending_balance === '' ? null : Number(r.ending_balance), r.source]),
};

const template = readFileSync(path.join(ROOT, 'demo', 'template.html'), 'utf8');
const output = template.replace('/*__EMBEDDED_DATA__*/', JSON.stringify(embedded));
writeFileSync(path.join(ROOT, 'demo', 'index.html'), output);

console.log(`Built demo/index.html (${(output.length / 1024).toFixed(0)} KB) with ${embedded.accounts.length} accounts, ${embedded.glRows.length} GL rows, ${embedded.tbRows.length} trial balance rows.`);
