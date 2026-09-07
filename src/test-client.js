// Manual smoke test: spawns the server as a real MCP subprocess (stdio) and
// drives it exactly as an MCP client would, so we can verify the tools work
// end-to-end without needing to reconnect a live Claude session mid-task.
// Run: node src/test-client.js

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(__dirname, 'server.js')],
});

const client = new Client({ name: 'test-client', version: '1.0.0' });
await client.connect(transport);

function printResult(label, result) {
  console.log(`\n=== ${label} ===`);
  const text = result.content?.[0]?.text ?? JSON.stringify(result);
  console.log(text.length > 1500 ? text.slice(0, 1500) + '\n...[truncated]' : text);
}

const tools = await client.listTools();
console.log('Tools registered:', tools.tools.map((t) => t.name).join(', '));

printResult(
  'list_accounts',
  await client.callTool({ name: 'list_accounts', arguments: {} })
);

printResult(
  'get_trial_balance 2025-10 Expense',
  await client.callTool({ name: 'get_trial_balance', arguments: { period: '2025-10', account_type: 'Expense' } })
);

printResult(
  'get_account_detail Software & Subscriptions 2025-10',
  await client.callTool({ name: 'get_account_detail', arguments: { account: 'Software & Subscriptions', period: '2025-10' } })
);

printResult(
  'compute_variance Software & Subscriptions 2025-10 vs prior_month (expect the ERP anomaly flagged)',
  await client.callTool({ name: 'compute_variance', arguments: { account: '6200', period: '2025-10', compare_to: 'prior_month' } })
);

printResult(
  'compute_variance Marketing 2025-11 vs prior_year (seasonal + one-off anomaly)',
  await client.callTool({ name: 'compute_variance', arguments: { account: 'Marketing & Advertising', period: '2025-11', compare_to: 'prior_year' } })
);

printResult(
  'compute_variance Retained Earnings (should flag derived_plug, no citations to GL)',
  await client.callTool({ name: 'compute_variance', arguments: { account: '3900', period: '2025-12', compare_to: 'prior_month' } })
);

printResult(
  'forecast_account Product Revenue linear_trend 3 periods ahead',
  await client.callTool({ name: 'forecast_account', arguments: { account: 'Product Revenue', periods_ahead: 3, method: 'linear_trend' } })
);

printResult(
  'error handling: unknown account',
  await client.callTool({ name: 'get_account_detail', arguments: { account: 'Not A Real Account', period: '2025-01' } })
);

await client.close();
console.log('\nSmoke test complete.');
