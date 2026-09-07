// Variance and forecast logic shared by the MCP tools. Every function returns
// plain data plus an explicit "citations" list so the caller (the model) can
// quote a number and point to exactly which GL rows or trial-balance periods
// back it up, rather than asserting figures with no traceable source.

import { GL_TRANSACTIONS, TRIAL_BALANCE, PERIODS, glDetailFor, priorPeriod, priorYearPeriod, validatePeriod } from './data.js';

function tbRow(accountCode, period) {
  return TRIAL_BALANCE.find((r) => r.account_code === accountCode && r.period === period) ?? null;
}

function signedAmount(row, account) {
  // amount expressed in the account's own normal-balance direction
  return account.normal_balance === 'debit' ? row.debit - row.credit : row.credit - row.debit;
}

export function resolveComparisonPeriod(period, compareTo) {
  if (compareTo === 'prior_month') return priorPeriod(period);
  if (compareTo === 'prior_year') return priorYearPeriod(period);
  validatePeriod(compareTo);
  return compareTo;
}

export function computeVariance(account, period, compareTo = 'prior_month') {
  validatePeriod(period);
  const comparisonPeriod = resolveComparisonPeriod(period, compareTo);
  if (!comparisonPeriod) {
    throw new Error(`No comparison period available for compare_to="${compareTo}" relative to ${period}.`);
  }

  const currentRow = tbRow(account.account_code, period);
  const comparisonRow = tbRow(account.account_code, comparisonPeriod);
  const currentBalance = currentRow.ending_balance;
  const comparisonBalance = comparisonRow.ending_balance;
  const varianceAmount = Math.round((currentBalance - comparisonBalance) * 100) / 100;
  const variancePct = comparisonBalance !== 0 ? Math.round((varianceAmount / Math.abs(comparisonBalance)) * 10000) / 100 : null;

  if (currentRow.source === 'derived_plug') {
    return {
      account: account.account_code,
      account_name: account.account_name,
      period,
      comparison_period: comparisonPeriod,
      current_balance: currentBalance,
      comparison_balance: comparisonBalance,
      variance_amount: varianceAmount,
      variance_pct: variancePct,
      is_gl_sourced: false,
      note: `${account.account_name} is a derived plug (cumulative net income), not a GL-posted account — there are no source transactions to cite. It equals Assets − Liabilities − Common Stock for the period. To explain its movement, examine variance on the P&L accounts instead (they roll into net income).`,
      citations: [
        { type: 'trial_balance', period, account_code: account.account_code, ending_balance: currentBalance, source: 'derived_plug' },
        { type: 'trial_balance', period: comparisonPeriod, account_code: account.account_code, ending_balance: comparisonBalance, source: 'derived_plug' },
      ],
    };
  }

  const currentTxns = glDetailFor(account.account_code, period).map((r) => ({
    transaction_id: r.transaction_id,
    date: r.date,
    description: r.description,
    source_doc: r.source_doc,
    amount: signedAmount(r, account),
  }));

  // historical baseline (all other periods) to flag unusual line items
  const historicalTxns = GL_TRANSACTIONS.filter((r) => r.account_code === account.account_code && r.period !== period);
  const historicalDescriptions = new Set(historicalTxns.map((r) => r.description));
  const historicalAmounts = historicalTxns.map((r) => Math.abs(signedAmount(r, account)));
  const historicalMean = historicalAmounts.length
    ? historicalAmounts.reduce((a, b) => a + b, 0) / historicalAmounts.length
    : 0;

  const likelyDrivers = currentTxns
    .filter((t) => !historicalDescriptions.has(t.description) || Math.abs(t.amount) > 1.75 * historicalMean)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return {
    account: account.account_code,
    account_name: account.account_name,
    period,
    comparison_period: comparisonPeriod,
    current_balance: currentBalance,
    comparison_balance: comparisonBalance,
    variance_amount: varianceAmount,
    variance_pct: variancePct,
    is_gl_sourced: true,
    likely_drivers: likelyDrivers,
    all_period_transactions: currentTxns,
    citations: [
      { type: 'trial_balance', period, account_code: account.account_code, ending_balance: currentBalance, source: 'GL' },
      { type: 'trial_balance', period: comparisonPeriod, account_code: account.account_code, ending_balance: comparisonBalance, source: 'GL' },
      ...currentTxns.map((t) => ({ type: 'gl_transaction', transaction_id: t.transaction_id, account_code: account.account_code, period })),
    ],
  };
}

function nextPeriodLabels(fromPeriod, count) {
  const [y, m] = fromPeriod.split('-').map(Number);
  const labels = [];
  let year = y, month = m;
  for (let i = 0; i < count; i++) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    labels.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return labels;
}

function linearRegression(points) {
  // points: [{x, y}], returns {slope, intercept}
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function forecastAccount(account, periodsAhead, method) {
  const history = PERIODS
    .map((period) => tbRow(account.account_code, period))
    .filter((r) => r && r.ending_balance !== null);

  if (account.account_code === '3900') {
    // Retained Earnings: still forecastable as a time series, but flag it
  }

  const windowSize = Math.min(12, history.length);
  const windowed = history.slice(-windowSize);

  let forecastValues;
  let methodDetail;
  if (method === 'moving_average') {
    const last3 = history.slice(-3).map((r) => r.ending_balance);
    const avg = last3.reduce((a, b) => a + b, 0) / last3.length;
    forecastValues = Array(periodsAhead).fill(Math.round(avg * 100) / 100);
    methodDetail = `Flat projection at the 3-month moving average of the trailing periods (${history.slice(-3).map((r) => r.period).join(', ')}).`;
  } else {
    const points = windowed.map((r, i) => ({ x: i, y: r.ending_balance }));
    const { slope, intercept } = linearRegression(points);
    forecastValues = Array.from({ length: periodsAhead }, (_, i) => {
      const x = windowed.length + i;
      return Math.round((intercept + slope * x) * 100) / 100;
    });
    methodDetail = `Ordinary least-squares linear trend fit over the trailing ${windowed.length} periods (${windowed[0].period}..${windowed[windowed.length - 1].period}); slope ≈ ${Math.round(slope)} per period.`;
  }

  const lastPeriod = history[history.length - 1].period;
  const labels = nextPeriodLabels(lastPeriod, periodsAhead);
  const forecast = labels.map((period, i) => ({ period, forecast_ending_balance: forecastValues[i] }));

  return {
    account: account.account_code,
    account_name: account.account_name,
    method,
    method_detail: methodDetail,
    forecast,
    caveat: 'This is a naive statistical projection from historical trial-balance history only. It does not know about planned price changes, new contracts, headcount plans, or other future business events — treat it as a starting point for discussion, not a business forecast.',
    citations: windowed.map((r) => ({ type: 'trial_balance', period: r.period, account_code: account.account_code, ending_balance: r.ending_balance, source: r.source })),
  };
}
