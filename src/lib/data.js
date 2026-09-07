// CSV-backed data access layer for the finance MCP server.
// Loads once at process start and serves all tool queries from memory —
// this is a toy/demo dataset (~750 GL rows), not a pattern for production scale.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const columns = lines[0].split(',');
  return lines.slice(1).map((line) => {
    // minimal CSV parser: handles quoted fields with embedded commas/quotes
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

function loadCsv(filename) {
  return parseCsv(readFileSync(path.join(DATA_DIR, filename), 'utf8'));
}

const rawChartOfAccounts = loadCsv('chart_of_accounts.csv');
const rawGlTransactions = loadCsv('gl_transactions.csv');
const rawTrialBalance = loadCsv('trial_balance.csv');

export const CHART_OF_ACCOUNTS = rawChartOfAccounts.map((r) => ({ ...r }));

export const GL_TRANSACTIONS = rawGlTransactions.map((r) => ({
  ...r,
  debit: Number(r.debit),
  credit: Number(r.credit),
}));

export const TRIAL_BALANCE = rawTrialBalance.map((r) => ({
  ...r,
  debit: Number(r.debit),
  credit: Number(r.credit),
  ending_balance: r.ending_balance === '' ? null : Number(r.ending_balance),
}));

export const PERIODS = [...new Set(TRIAL_BALANCE.map((r) => r.period))].sort();
export const ACCOUNT_BY_CODE = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.account_code, a]));

export function findAccount(codeOrName) {
  const needle = String(codeOrName).trim().toLowerCase();
  return CHART_OF_ACCOUNTS.find(
    (a) => a.account_code === needle || a.account_name.toLowerCase() === needle
  ) ?? CHART_OF_ACCOUNTS.find((a) => a.account_name.toLowerCase().includes(needle));
}

export function validatePeriod(period) {
  if (!PERIODS.includes(period)) {
    throw new Error(`Unknown period "${period}". Available periods: ${PERIODS[0]}..${PERIODS[PERIODS.length - 1]}.`);
  }
}

export function trialBalanceFor(period, { accountType } = {}) {
  validatePeriod(period);
  return TRIAL_BALANCE.filter(
    (r) => r.period === period && (!accountType || r.account_type === accountType)
  );
}

export function tbSeriesFor(accountCode) {
  return PERIODS.map((period) => {
    const row = TRIAL_BALANCE.find((r) => r.period === period && r.account_code === accountCode);
    return { period, ending_balance: row ? row.ending_balance : null, source: row?.source };
  });
}

export function glDetailFor(accountCode, period) {
  return GL_TRANSACTIONS.filter((r) => r.account_code === accountCode && r.period === period)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Previous period label, or null if `period` is the first period on record. */
export function priorPeriod(period) {
  const idx = PERIODS.indexOf(period);
  return idx > 0 ? PERIODS[idx - 1] : null;
}

/** Same month, prior year (e.g. 2025-11 -> 2024-11), or null if out of range. */
export function priorYearPeriod(period) {
  const [y, m] = period.split('-');
  const candidate = `${Number(y) - 1}-${m}`;
  return PERIODS.includes(candidate) ? candidate : null;
}
