# 提交用的 PR 标题与正文

## 标题

```
Add turn-cost-footer
```

## 正文

```markdown
Adds one entry: `data/plugins/qcy-good__turn-cost-footer.yml`.

**What it does** — `turn-cost-footer` shows the real cost of each assistant turn, plus the
running total for today, at the end of the completed-turn footer in DeepSeek Harness
(after the clock, matching its type size).

**How the amount is produced** — the Host half subscribes to `session/event`, folds the
`assistant/message.usage` counters of one turn, and prices them with a local CNY table
(`cacheHit` / `cacheMiss` / `output`, per million tokens; peak-hours multiplier configurable).
It serves one read-only JSON route that the Client half polls. No billing or balance API,
no `credentials`, no `llm` service, no outbound network call, and nothing is sent to the model —
the plugin cannot add tokens to a request.

**Manifest** — `package.json` declares `dsh.bundle.patch` (`./cordis.patch.yml` at repo root)
and `dsh.client` for the browser half; runtime deps are zero (only `node:fs`/`node:os`/`node:path`).
Tested on DSH 0.2.2-rc.1: install/uninstall, disable→enable, app restart, consecutive turns,
and with `dsh-whale-widget` disabled (the plugin does not read, patch or depend on it).

**Scope** — this is deliberately narrower than `dsh-cost-meter`: that one is a sidebar
dashboard (aggregated charts, budget, balance), this one is a single inline footer amount
for the turn you just ran.
```
