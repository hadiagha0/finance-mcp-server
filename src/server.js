#!/usr/bin/env node
// Finance MCP server — read-only query tools over a synthetic GL / trial
// balance dataset for a fictional SaaS company ("Meridian Analytics Inc.").
//
// This exists to demonstrate a pattern, not to be a production finance
// system: an LLM gets governed, citable access to ledger data through a
// small, explicit tool surface — every answer can point back to the exact
// trial-balance period or GL transaction_id it came from, and every call is
// appended to data/audit_log.jsonl. See README.md for the positioning.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  CHART_OF_ACCOUNTS, PERIODS, findAccount, validatePeriod,
  trialBalanceFor, glDetailFor,
} from './lib/data.js';
import { computeVariance, forecastAccount } from './lib/analysis.js';
import { logToolCall } from './lib/audit.js';

const server = new McpServer({ name: 'finance-gl-server', version: '1.0.0' });

function requireAccount(accountRef) {
  const account = findAccount(accountRef);
  if (!account) {
    const codes = CHART_OF_ACCOUNTS.map((a) => `${a.account_code} ${a.account_name}`).join(', ');
    throw new Error(`Unknown account "${accountRef}". Known accounts: ${codes}`);
  }
  return account;
}

const textResult = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

server.registerTool(
  'list_accounts',
  {
    description: 'List the chart of accounts (code, name, type, statement, normal balance) for this dataset. Call this first to discover valid account codes/names before using the other tools.',
    inputSchema: {},
  },
  async () => {
    logToolCall({ tool: 'list_accounts', input: {}, citationCount: CHART_OF_ACCOUNTS.length, summary: 'Listed chart of accounts' });
    return textResult({ accounts: CHART_OF_ACCOUNTS, available_periods: { first: PERIODS[0], last: PERIODS[PERIODS.length - 1], count: PERIODS.length } });
  }
);

server.registerTool(
  'get_trial_balance',
  {
    description: 'Get the trial balance (all accounts) for one period, e.g. "2025-11". Optionally filter by account_type (Asset, Liability, Equity, Revenue, Expense). Revenue/Expense balances are that month\'s activity; Asset/Liability/Equity balances are period-end cumulative balances.',
    inputSchema: {
      period: z.string().describe('Period in YYYY-MM format, e.g. "2025-11"'),
      account_type: z.enum(['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']).optional(),
    },
  },
  async ({ period, account_type }) => {
    const rows = trialBalanceFor(period, { accountType: account_type });
    logToolCall({ tool: 'get_trial_balance', input: { period, account_type }, citationCount: rows.length, summary: `Trial balance for ${period}` });
    return textResult({ period, account_type: account_type ?? 'all', rows });
  }
);

server.registerTool(
  'get_account_detail',
  {
    description: 'Get every GL transaction line posted to one account in one period — the source-of-truth detail behind a trial balance number. Use this to cite specific transaction_ids when explaining a figure.',
    inputSchema: {
      account: z.string().describe('Account code (e.g. "6300") or name (e.g. "Marketing & Advertising")'),
      period: z.string().describe('Period in YYYY-MM format, e.g. "2025-11"'),
    },
  },
  async ({ account, period }) => {
    validatePeriod(period);
    const acct = requireAccount(account);
    if (acct.account_code === '3900') {
      logToolCall({ tool: 'get_account_detail', input: { account, period }, citationCount: 0, summary: 'Retained Earnings has no GL detail (derived plug)' });
      return textResult({ account: acct.account_code, account_name: acct.account_name, period, transactions: [], note: 'Retained Earnings is a derived plug (cumulative net income), not posted from GL transactions. There is nothing to cite here directly — see the P&L accounts that roll into net income instead.' });
    }
    const txns = glDetailFor(acct.account_code, period);
    logToolCall({ tool: 'get_account_detail', input: { account, period }, citationCount: txns.length, summary: `${txns.length} GL lines for ${acct.account_name} ${period}` });
    return textResult({ account: acct.account_code, account_name: acct.account_name, period, transactions: txns });
  }
);

server.registerTool(
  'compute_variance',
  {
    description: 'Compute the variance for one account between a period and a comparison point (prior month, prior year, or an explicit period), and surface the specific GL transactions that most likely drove the change (unusual amounts or descriptions not seen in other periods) with citations.',
    inputSchema: {
      account: z.string().describe('Account code (e.g. "6200") or name (e.g. "Software & Subscriptions")'),
      period: z.string().describe('Period in YYYY-MM format, e.g. "2025-10"'),
      compare_to: z.string().default('prior_month').describe('"prior_month", "prior_year", or an explicit period like "2025-01"'),
    },
  },
  async ({ account, period, compare_to }) => {
    const acct = requireAccount(account);
    const result = computeVariance(acct, period, compare_to);
    logToolCall({ tool: 'compute_variance', input: { account, period, compare_to }, citationCount: result.citations.length, summary: `Variance ${acct.account_name} ${period} vs ${result.comparison_period}: ${result.variance_amount}` });
    return textResult(result);
  }
);

server.registerTool(
  'forecast_account',
  {
    description: 'Project an account\'s balance forward using a naive statistical method (linear trend or moving average) over its trial-balance history. Clearly caveated: this has no knowledge of planned future business events.',
    inputSchema: {
      account: z.string().describe('Account code or name'),
      periods_ahead: z.number().int().min(1).max(12).default(3),
      method: z.enum(['linear_trend', 'moving_average']).default('linear_trend'),
    },
  },
  async ({ account, periods_ahead, method }) => {
    const acct = requireAccount(account);
    const result = forecastAccount(acct, periods_ahead, method);
    logToolCall({ tool: 'forecast_account', input: { account, periods_ahead, method }, citationCount: result.citations.length, summary: `Forecast ${acct.account_name} +${periods_ahead}p via ${method}` });
    return textResult(result);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('finance-gl-server: MCP server running on stdio');
}

main().catch((err) => {
  console.error('finance-gl-server: fatal error', err);
  process.exit(1);
});
