// Generates a synthetic but internally-consistent GL dataset for a fictional
// SaaS company ("Meridian Analytics Inc.") across Jan 2024 - Dec 2025.
//
// Design goals:
//   - Every P&L and balance-sheet dollar (except Retained Earnings) is posted
//     as real double-entry GL transactions, so debits = credits every period
//     and every trial-balance number can be traced back to source rows.
//   - Retained Earnings is deliberately left as a *derived plug* (cumulative
//     net income), not sourced from GL rows — the MCP server flags this
//     explicitly rather than fabricating a citation for it.
//   - A handful of intentional anomalies are seeded into specific months so
//     the variance tool has something real to surface (see ANOMALIES below).
//
// Run: node src/generate-data.js  (writes CSVs into ../data)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// ---- seeded RNG (mulberry32) for reproducible output ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20240101);
const jitter = (pct) => 1 + (rng() * 2 - 1) * pct;

const PERIODS = [];
for (let y = 2024; y <= 2025; y++) {
  for (let m = 1; m <= 12; m++) PERIODS.push(`${y}-${String(m).padStart(2, '0')}`);
}

const CHART_OF_ACCOUNTS = [
  { account_code: '1000', account_name: 'Cash', account_type: 'Asset', statement: 'BS', normal_balance: 'debit' },
  { account_code: '1100', account_name: 'Accounts Receivable', account_type: 'Asset', statement: 'BS', normal_balance: 'debit' },
  { account_code: '1500', account_name: 'Fixed Assets', account_type: 'Asset', statement: 'BS', normal_balance: 'debit' },
  { account_code: '1600', account_name: 'Accumulated Depreciation', account_type: 'Asset', statement: 'BS', normal_balance: 'credit' },
  { account_code: '2000', account_name: 'Accounts Payable', account_type: 'Liability', statement: 'BS', normal_balance: 'credit' },
  { account_code: '3000', account_name: 'Common Stock', account_type: 'Equity', statement: 'BS', normal_balance: 'credit' },
  { account_code: '3900', account_name: 'Retained Earnings', account_type: 'Equity', statement: 'BS', normal_balance: 'credit' },
  { account_code: '4000', account_name: 'Product Revenue', account_type: 'Revenue', statement: 'IS', normal_balance: 'credit' },
  { account_code: '4100', account_name: 'Service Revenue', account_type: 'Revenue', statement: 'IS', normal_balance: 'credit' },
  { account_code: '5000', account_name: 'Cost of Goods Sold', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6000', account_name: 'Salaries & Wages', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6100', account_name: 'Employee Benefits', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6200', account_name: 'Software & Subscriptions', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6300', account_name: 'Marketing & Advertising', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6400', account_name: 'Travel & Entertainment', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6500', account_name: 'Professional Fees', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6600', account_name: 'Rent & Facilities', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6700', account_name: 'Depreciation', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6800', account_name: 'Office Supplies', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
  { account_code: '6900', account_name: 'Utilities', account_type: 'Expense', statement: 'IS', normal_balance: 'debit' },
];
const NAME = Object.fromEntries(CHART_OF_ACCOUNTS.map(a => [a.account_code, a.account_name]));

// Anomalies deliberately seeded for the demo (documented in README):
//   - 6200 Software & Subscriptions: one-time ERP/finance-system implementation invoice, Oct 2025
//   - 6300 Marketing & Advertising: one-off brand campaign on top of normal Q4 seasonality, Nov 2025
//   - 6400 Travel & Entertainment: sales kickoff conference, Sep 2025
//   - 6600 Rent & Facilities: lease renewal step-up, effective Jul 2025
const ANOMALIES = {
  software_spike: '2025-10',
  marketing_spike: '2025-11',
  travel_spike: '2025-09',
  rent_step_month: '2025-07',
};

let txnSeq = 0;
const nextTxnId = () => `JE-${String(++txnSeq).padStart(6, '0')}`;
let invSeq = 40000;
const nextInv = (prefix) => `${prefix}-${++invSeq}`;

const rows = []; // gl_transactions rows
function post(date, period, debitAcct, creditAcct, amount, description, sourceDoc) {
  amount = Math.round(amount * 100) / 100;
  if (amount <= 0) return;
  const txn = nextTxnId();
  rows.push({ transaction_id: txn, line_id: `${txn}-1`, date, period, account_code: debitAcct, account_name: NAME[debitAcct], debit: amount, credit: 0, description, source_doc: sourceDoc });
  rows.push({ transaction_id: txn, line_id: `${txn}-2`, date, period, account_code: creditAcct, account_name: NAME[creditAcct], debit: 0, credit: amount, description, source_doc: sourceDoc });
}

// Opening equity injection
post('2024-01-02', '2024-01', '1000', '3000', 650000, 'Founding equity contribution', 'JE-OPEN-0001');

let productRevBase = 180000;
let serviceRevBase = 25000;
let salaries = 95000;
let fixedAssets = 0;
let arBalance = 0; // running outstanding receivables (debit-normal)
let apBalance = 0; // running outstanding payables (credit-normal)
const COLLECTION_RATE = 0.6; // fraction of outstanding AR collected each month (~DSO of ~1.7 months)
const PAYMENT_RATE = 0.6; // fraction of outstanding AP paid each month

for (let i = 0; i < PERIODS.length; i++) {
  const period = PERIODS[i];
  const [y, m] = period.split('-');
  const eom = new Date(Number(y), Number(m), 0).getDate();
  const dateEarly = `${period}-05`, dateMid = `${period}-15`, dateLate = `${period}-${String(eom).padStart(2, '0')}`;
  const monthNum = Number(m);
  const isQ4 = monthNum >= 10;

  // ---- Revenue ----
  productRevBase *= 1.025; // ~2.5%/mo compounding growth
  const productRev = productRevBase * jitter(0.03);
  post(dateLate, period, '1100', '4000', productRev, 'Monthly SaaS subscription revenue recognized', nextInv('SUB'));

  serviceRevBase *= 1.01;
  let serviceRev = serviceRevBase * jitter(0.10);
  if (isQ4) serviceRev *= 1.15; // year-end budget-flush seasonality
  post(dateLate, period, '1100', '4100', serviceRev, 'Professional services revenue recognized', nextInv('SVC'));

  // ---- COGS ----
  const cogs = productRev * 0.32 * jitter(0.05);
  post(dateLate, period, '5000', '2000', cogs, 'Hosting infrastructure & customer support costs', nextInv('INV'));

  // ---- Payroll & benefits ----
  if (monthNum === 1 || monthNum === 7) salaries *= 1.08; // semi-annual headcount step-up
  const salariesAmt = salaries * jitter(0.02);
  post(dateEarly, period, '6000', '1000', salariesAmt, 'Payroll run', nextInv('PR'));
  post(dateEarly, period, '6100', '1000', salariesAmt * 0.22 * jitter(0.05), 'Employee benefits & payroll taxes', nextInv('PR'));

  // ---- Software & Subscriptions (with Oct-2025 anomaly) ----
  let software = 8000 * Math.pow(1.015, i) * jitter(0.08);
  let softwareAnomalyAmt = 0;
  if (period === ANOMALIES.software_spike) {
    softwareAnomalyAmt = 42000;
    post(dateMid, period, '6200', '2000', softwareAnomalyAmt, 'One-time ERP/finance-system implementation — vendor SOW', nextInv('INV'));
  }
  post(dateMid, period, '6200', '1000', software, 'Recurring SaaS tooling subscriptions', nextInv('SUB'));

  // ---- Marketing (Q4 seasonality + Nov-2025 anomaly) ----
  let marketing = 15000 * Math.pow(1.01, i) * jitter(0.10);
  if (isQ4) marketing *= 1.6;
  let marketingAnomalyAmt = 0;
  if (period === ANOMALIES.marketing_spike) {
    marketingAnomalyAmt = 38000;
    post(dateMid, period, '6300', '2000', marketingAnomalyAmt, 'One-off brand awareness campaign — outside normal Q4 plan', nextInv('INV'));
  }
  post(dateMid, period, '6300', '2000', marketing, 'Digital advertising & agency fees', nextInv('INV'));

  // ---- Travel (Sep-2025 anomaly) ----
  let travel = 4000 * jitter(0.15);
  if (period === ANOMALIES.travel_spike) travel += 11000; // sales kickoff conference
  post(dateMid, period, '6400', '1000', travel, 'Employee travel & client entertainment', nextInv('EXP'));

  // ---- Professional fees (Q1 audit bump) ----
  let profFees = 6000 * jitter(0.12);
  if (monthNum === 1 || monthNum === 2) profFees += 9000; // annual audit/legal
  post(dateMid, period, '6500', '2000', profFees, 'Legal, audit & advisory fees', nextInv('INV'));

  // ---- Rent (Jul-2025 step-up) ----
  const rentBase = (period >= ANOMALIES.rent_step_month) ? 13200 : 12000;
  post(dateEarly, period, '6600', '1000', rentBase, 'Office lease payment', nextInv('LEASE'));

  // ---- Depreciation ----
  if (monthNum % 3 === 1) { // quarterly small capex
    const capex = 8000 * jitter(0.2);
    fixedAssets += capex;
    post(dateEarly, period, '1500', '1000', capex, 'Capital expenditure — equipment & software capitalization', nextInv('CAPEX'));
  }
  const depreciation = Math.max(2000, fixedAssets * 0.02);
  post(dateLate, period, '6700', '1600', depreciation, 'Monthly depreciation expense', `DEP-${period}`);

  // ---- Office supplies & utilities ----
  post(dateMid, period, '6800', '1000', 1200 * jitter(0.2), 'Office supplies', nextInv('EXP'));
  let utilities = 2000 * jitter(0.1);
  if (['06','07','08','12','01'].includes(m)) utilities *= 1.15; // seasonal HVAC
  post(dateMid, period, '6900', '1000', utilities, 'Utilities', nextInv('UTIL'));

  // ---- Cash collections / payments (working-capital cycling against the
  // running AR/AP balance, not just this month's new activity — otherwise
  // the uncollected/unpaid tail from every prior month stacks up forever) ----
  arBalance += productRev + serviceRev;
  apBalance += cogs + marketing + marketingAnomalyAmt + profFees + softwareAnomalyAmt;

  const collection = arBalance * COLLECTION_RATE;
  post(dateLate, period, '1000', '1100', collection, 'Customer collections on account', `COLL-${period}`);
  arBalance -= collection;

  const payment = apBalance * PAYMENT_RATE;
  post(dateLate, period, '2000', '1000', payment, 'Vendor payments on account', `PMT-${period}`);
  apBalance -= payment;
}

// ---- aggregate trial balance per period per account ----
const balances = Object.fromEntries(CHART_OF_ACCOUNTS.map(a => [a.account_code, 0])); // running cumulative (debit - credit)
const tbRows = [];
for (const period of PERIODS) {
  const monthly = Object.fromEntries(CHART_OF_ACCOUNTS.map(a => [a.account_code, { debit: 0, credit: 0 }]));
  for (const r of rows) {
    if (r.period !== period) continue;
    monthly[r.account_code].debit += r.debit;
    monthly[r.account_code].credit += r.credit;
  }
  for (const acct of CHART_OF_ACCOUNTS) {
    const { debit, credit } = monthly[acct.account_code];
    balances[acct.account_code] += debit - credit; // cumulative debit-normal running balance

    let ending_balance, source;
    if (acct.statement === 'IS') {
      // flow account: this month's activity only, signed per normal balance
      const flow = debit - credit;
      ending_balance = acct.normal_balance === 'debit' ? flow : -flow;
      source = 'GL';
    } else if (acct.account_code === '3900') {
      ending_balance = null; // computed below as plug
      source = 'derived_plug';
    } else {
      const cum = balances[acct.account_code];
      ending_balance = acct.normal_balance === 'debit' ? cum : -cum;
      source = 'GL';
    }
    tbRows.push({ period, account_code: acct.account_code, account_name: acct.account_name, account_type: acct.account_type, debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100, ending_balance, source });
  }
  // plug Retained Earnings so Assets = Liabilities + Equity for this period
  const byCode = Object.fromEntries(tbRows.filter(t => t.period === period).map(t => [t.account_code, t.ending_balance]));
  const assets = byCode['1000'] + byCode['1100'] + byCode['1500'] - byCode['1600'];
  const liabilities = byCode['2000'];
  const commonStock = byCode['3000'];
  const re = assets - liabilities - commonStock;
  const reRow = tbRows.find(t => t.period === period && t.account_code === '3900');
  reRow.ending_balance = Math.round(re * 100) / 100;
}

// ---- write CSVs ----
function toCsv(records, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...records.map(r => columns.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}

writeFileSync(path.join(DATA_DIR, 'chart_of_accounts.csv'), toCsv(CHART_OF_ACCOUNTS, ['account_code', 'account_name', 'account_type', 'statement', 'normal_balance']));
writeFileSync(path.join(DATA_DIR, 'gl_transactions.csv'), toCsv(rows, ['transaction_id', 'line_id', 'date', 'period', 'account_code', 'account_name', 'debit', 'credit', 'description', 'source_doc']));
writeFileSync(path.join(DATA_DIR, 'trial_balance.csv'), toCsv(tbRows, ['period', 'account_code', 'account_name', 'account_type', 'debit', 'credit', 'ending_balance', 'source']));

console.log(`Generated ${rows.length} GL lines (${txnSeq} journal entries), ${tbRows.length} trial balance rows across ${PERIODS.length} periods.`);
