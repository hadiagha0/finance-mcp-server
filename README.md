# finance-mcp-server

A toy MCP (Model Context Protocol) server over a synthetic general ledger /
trial balance dataset. It exposes a small set of **read-only** tools —
trial balance lookups, GL drill-down, variance analysis, and naive
forecasting — that an LLM (Claude, in this repo) can call directly, with
every answer traceable back to a specific trial-balance period or GL
transaction ID.

## Why this exists

OneStream, SAP, Workday, and the other major ERP/EPM vendors are all
currently racing to productize the same pattern: **governed, citable LLM
access to finance data via MCP** — an agent that can answer "why did this
account move?" without hallucinating a number, because every claim points
back to a source row. This repo is a small, self-contained demonstration of
that exact pattern, built to understand it hands-on rather than just read
about it in a vendor's product announcement.

It's a companion piece to [`financial-research-agent`](../financial-research-agent)
(citation-grounded research over a 10-K filing via BM25 retrieval) — that
project grounds an LLM against unstructured filing text; this one grounds it
against structured ledger data. Same "explainable finance AI" thesis, two
different data shapes.

## Live demo

**[hadiagha0.github.io/finance-mcp-server](https://hadiagha0.github.io/finance-mcp-server/)**

`docs/index.html` — a self-contained, static page (no server, no MCP
connection needed) that embeds the real GL/trial-balance data and runs the
same variance and forecast logic as `src/lib/analysis.js` client-side. Pick
an account and period, and watch it flag the seeded anomalies with citations
back to the exact transaction, or run the forecast tool and see the caveat
disclosed right next to the chart. Built with `scripts/build-demo.js`
(regenerate after any change to the data or template:
`node scripts/build-demo.js`). Preview locally with `npm run serve-demo`
(serves `docs/` on `http://localhost:4174`). Lives in `docs/` rather than
`demo/` specifically so GitHub Pages can serve it directly from the `main`
branch.

## The dataset

`src/generate-data.js` generates a fully self-consistent, double-entry GL for
a fictional SaaS company, **Meridian Analytics Inc.**, across 24 months
(Jan 2024 – Dec 2025):

- `data/chart_of_accounts.csv` — 20 accounts across Asset/Liability/Equity/Revenue/Expense
- `data/gl_transactions.csv` — ~370 journal entries (two lines each: a debit leg and a credit leg), so debits = credits by construction
- `data/trial_balance.csv` — the aggregated period-end balance per account per period, derived from the GL rows above

Every number in the trial balance is either:
- **`source: "GL"`** — aggregated directly from real GL transaction rows (traceable to a `transaction_id`), or
- **`source: "derived_plug"`** — true only of Retained Earnings, which is computed as `Assets − Liabilities − Common Stock` rather than posted from journal entries. The server flags this explicitly rather than inventing a citation for it — a deliberate honesty feature, not a gap.

**Seeded anomalies** (so variance/forecast queries have something real to
find, not just noise):

| Account | Period | What happens |
|---|---|---|
| 6200 Software & Subscriptions | 2025-10 | One-time $42k ERP/finance-system implementation invoice |
| 6300 Marketing & Advertising | 2025-11 | $38k one-off brand campaign on top of normal Q4 seasonality |
| 6400 Travel & Entertainment | 2025-09 | Sales kickoff conference spike |
| 6600 Rent & Facilities | 2025-07 | Lease renewal step-up (~10%) |

Regenerate the dataset any time with `npm run generate-data` (deterministic —
same seed, same numbers).

## The tools

| Tool | Purpose |
|---|---|
| `list_accounts` | Chart of accounts + available period range. Call first to discover valid codes. |
| `get_trial_balance` | All account balances for one period, optionally filtered by account type. |
| `get_account_detail` | Every GL line posted to one account in one period — the drill-down/citation source. |
| `compute_variance` | Variance vs. prior month / prior year / an explicit period, with likely driver transactions flagged (unusual amount or a description never seen in other periods) and full citations. |
| `forecast_account` | Linear-trend or moving-average projection from trial-balance history, explicitly caveated as naive and business-blind. |

Every tool call is appended to `data/audit_log.jsonl` (tool, input, citation
count, timestamp, one-line summary) — a lightweight governance trail showing
exactly what was asked and how well-sourced the answer was.

## Running it

```bash
npm install
npm run generate-data   # only needed if you want to regenerate the CSVs
npm test                # smoke test: spawns the server and exercises all 5 tools
npm start                # run the server standalone over stdio
```

### Connecting to Claude Code

This repo is already registered in `C:\Claude\.mcp.json` as
`finance-gl-server`. Restart Claude Code (or approve the server when
prompted) and its tools become available in any session rooted at
`C:\Claude`.

### Connecting to Claude Desktop

Add to Claude Desktop's config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "finance-gl-server": {
      "command": "node",
      "args": ["C:\\Claude\\Projects\\finance-mcp-server\\src\\server.js"]
    }
  }
}
```

## Example questions to ask once connected

- "Why did Software & Subscriptions spend spike in October 2025?"
- "Compare Marketing & Advertising in November 2025 to November 2024 — what changed?"
- "What's driving the Retained Earnings movement this quarter?" (tests the derived-plug honesty path)
- "Forecast Product Revenue for the next 3 months."
- "Give me the full trial balance for December 2025, expenses only."

A good answer cites specific `transaction_id`s and period figures rather than
just asserting a number — that's the whole point of the pattern.

## Known limitations (by design, for a toy project)

- In-memory CSV loading — fine for ~750 rows, not a scale pattern.
- Only Retained Earnings is a derived plug; every other balance is real GL aggregation, but the "driver detection" heuristic in `compute_variance` is intentionally simple (unusual amount or novel description) — a production system would want proper anomaly scoring.
- `forecast_account` is a naive statistical projection with no seasonality model beyond what a straight line or 3-month average implicitly captures — the tool description and every response say this explicitly rather than let it pass as more rigorous than it is.
- No write tools, on purpose — this demonstrates governed *read* access, which is the part of the pattern worth practicing.
