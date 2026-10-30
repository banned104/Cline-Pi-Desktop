# ClinePass provider plugin for PI-Desktop

Brings Cline's **ClinePass** subscription into PI-Desktop, and shows **which
upstream actually served each request** — one ClinePass model sits behind twenty-odd
upstreams (deepseek, fireworks, baseten, alibaba…) that a client normally cannot see.

## Quick start (30 seconds)

1. **Install**: Settings → Plugins → install `dist/pi.clinepass-2.2.0.piplug` (or
   Install from folder), approving four permissions: `provider.register`,
   `ui.panel`, `ui.view`, `background.service`.
2. **Restart PI-Desktop** (the host rebuilds provider rows and the view list only
   at startup).
3. **Send a message as usual**, keeping the model on **ClinePass** — no provider
   switch, no second key to enter.
4. **Look**: work panel → new tab → **ClinePass status** (same as the command
   `ClinePass: 在右侧显示状态`).

You are done when the table shows a value like `fireworks` under **landed**.

> For the full view (per-request table, model checkboxes, upstream probe and
> anchoring) run **`ClinePass: 打开上游面板`**.

## Two providers, only one of them records

| Provider | Request path | Records? | When to use |
| --- | --- | --- | --- |
| **ClinePass** | local `127.0.0.1:41892` → `api.cline.bot` | **yes** | everyday use |
| **ClinePass Direct** | straight to `api.cline.bot` | no | temporary escape hatch when the plugin is off or misbehaving |

**Why**: seeing the landing upstream requires sitting in the request path, so the
observed provider must point at a local endpoint. 2.2.0 makes *the row you already
used* the observed one — its id is unchanged, so the key you stored on it keeps
working.

> 2.1.x and earlier had this backwards: `ClinePass` was direct and a separate
> `ClinePass Upstream` row did the observing. That row needed **its own key**, so it
> stayed empty for almost everyone — that is the mistake 2.2.0 fixes.

## FAQ

**The table stays empty.** In order: (1) has anything been sent on this provider?
(2) does Settings → Providers → **ClinePass** have a key? (a missing key makes the
chat report "no API key"); (3) are you on **ClinePass Direct**, which is direct and
therefore not recorded? (4) is the plugin disabled? (a disabled plugin makes
`ClinePass` return 503).

**Where does the key go?** Settings → Providers → **ClinePass** — the one you
already filled. The plugin's own `apiKey` setting is normally **not** needed; it is
only a fallback for when the host sends no `Authorization` header. A plugin cannot
read the host's secrets (the host says so explicitly), so it forwards the header it
receives.

**Will it slow things down?** One extra local hop. The plugin also strips
`accept-encoding` so the gateway's routing block stays readable (bandwidth for
observability).

**Plugin broken?** Switch the model to **ClinePass Direct** and keep working,
unobserved.

## What you see

Docked status view (narrow column, refreshes every 3 s): current status (endpoint
listening, switch, key source, enabled/official model counts, catalog refresh,
target upstreams, last error), the last request (landed / pinned / fallbacks /
cache hits / cost / count / verdict) and the last 20 requests.

Full panel (separate window): all of the above plus the snapshot's 60-row table, per-model
checkboxes, per-model default thinking level, target upstreams, probe and anchoring.

| Column | Meaning |
| --- | --- |
| landed | the upstream that actually served it; green = matches your target |
| pinned | the session-pinned upstream the gateway reports |
| fallbacks | `fallbacksAvailable` count: above 0 means it can still be downgraded |
| cache hit | `promptCacheHitTokens`, `—` when the lane does not report it |
| cost | `marketCost`, else `inferenceCost`, else `cost` (a private lane reports 0) |
| verdict | observe-only / matched / gateway ignored / no metadata |

### Target upstreams and "gateway ignored"

Ticking target upstreams plus "写入 routing（实验）" adds `provider: { only: [...] }`
(optionally `allow_fallbacks: false`) and compares the response's `finalProvider`.
**The gateway ignores that field**, so the panel shows "网关忽略" — expected today,
not a misconfiguration.

### Anchoring an upstream

Two measured facts: `clientSessionId` is derived from the key (so body `sessionId` /
`x-session-id` headers are ignored), and the landing upstream is a function of
**(key, model id)** — the same id always lands on the same upstream.

So anchoring means **probe same-family ids, pick one that lands on the target, and
have the plugin rewrite `model`**. That is the second dropdown per model row; the
**探测** button next to it probes a few ids (a few real calls, ~$0.00003 each).
Results split into *anchorable* and *fallback-only*. Note that a different id can
serve a slightly different variant of the model — leave the dropdown on "原样转发"
for zero risk.

### Narrowing the model list

The checkboxes are stored in plugin settings, and the plugin **rewrites its own
installed `manifest.json`** to narrow the `clinepass` row. The picker follows after
a restart; the forward layer refuses unchecked models immediately
(`404 model_not_enabled`). `ClinePass Direct` always keeps all 15. "全选官方"
restores them in one click. With "Install from folder" on this directory that
installed copy *is* this file, so re-run `node scripts/sync-clinepass.mjs` to
restore the official list.

## Models

The API `model` field takes the full slug. Claude is **not** part of ClinePass
(`anthropic/*` bills pay-as-you-go).

| Model | Model ID | Context | Max output | Images |
| --- | --- | --- | --- | --- |
| DeepSeek V4 Pro | `cline-pass/deepseek-v4-pro` | 1,048,576 | 384,000 | — |
| DeepSeek V4.1 Flash | `cline-pass/deepseek-v4.1-flash` | 1,048,576 | 943,718 | ✓ |
| DeepSeek V4.1 Flash 1017 | `cline-pass/deepseek-v4.1-flash-1017` | 1,048,576 | 393,216 | ✓ |
| GLM-5.3 | `cline-pass/glm-5.3` | 1,048,576 | 943,718 | — |
| GLM-5.3-Flash | `cline-pass/glm-5.3-flash` | 1,048,576 | 943,717 | ✓ |
| Kimi K3 | `cline-pass/kimi-k3` | 1,048,576 | 943,718 | ✓ |
| Kimi K3.1 Pro | `cline-pass/kimi-k3.1-pro` | 1,048,576 | 943,718 | ✓ |
| MiMo-V2.6-Flash | `cline-pass/mimo-v2.6-flash` | 1,050,000 | 131,072 | ✓ |
| MiMo-V2.6-Pro | `cline-pass/mimo-v2.6-pro` | 1,050,000 | 131,072 | ✓ |
| MiniMax-M3 | `cline-pass/minimax-m3` | 1,048,576 | 512,000 | ✓ |
| MiniMax-M3.1-Flash | `cline-pass/minimax-m3.1-flash` | 1,048,576 | 524,288 | ✓ |
| Muse Spark 1.3 Contributor | `cline-pass/muse-spark-1.3-contributor` | 1,048,576 | 943,718 | ✓ |
| Qwen3.7 Max | `cline-pass/qwen3.7-max` | 1,000,000 | 131,072 | — |
| Qwen3.7 Plus | `cline-pass/qwen3.7-plus` | 1,000,000 | 131,072 | ✓ |
| Qwen 3.8 Max | `cline-pass/qwen3.8-max` | 262,144 | 128,000 | ✓ |

All numbers come from **Cline's own catalog**: the `"cline-pass"` block of
`catalog.generated.ts`, the `clinePass` list in `cline-recommended.generated.ts`,
cross-checked against `GET /api/v1/ai/cline/recommended-models`.

Both token limits are user-editable per model in Settings → Providers → ClinePass;
raising them past the published value does not buy real context.

Not declared (retired upstream): `glm-5.2`, `kimi-k2.6`, `kimi-k2.7-code`,
`deepseek-v4-flash`, `mimo-v2.5`, `mimo-v2.5-pro`.

## Thinking levels

| Model(s) | Levels | Default |
| --- | --- | --- |
| GLM-5.3, GLM-5.3-Flash, Kimi K3, Kimi K3.1 Pro, DeepSeek V4.1 Flash, DeepSeek V4.1 Flash 1017 | `low` `high` `max` | `high` |
| DeepSeek V4 Pro | `high` `xhigh` | `high` |
| MiniMax-M3.1-Flash | `low` `medium` `high` `xhigh` `max` | `medium` |
| Muse Spark 1.3 Contributor | `minimal` `low` `medium` `high` `xhigh` `max` | `medium` |
| Qwen 3.8 Max | `low` `medium` `xhigh` | `medium` |
| MiMo-V2.6-Flash, MiMo-V2.6-Pro, MiniMax-M3, Qwen3.7 Max, Qwen3.7 Plus | *(toggle only)* | — |

1. **No `off`.** The host *can* declare `off`, whose meaning is exactly "send
   nothing"; but Cline models "no reasoning" as `none`, which its client sends
   explicitly. Those are different requests, so neither is declared (`none` is not a
   legal host level and would be dropped). Consequence: the five models whose
   ladder starts at `none` cannot be put into no-reasoning mode from PI-Desktop.
2. **Toggle-only models get no level menu** — the manifest cannot express a toggle,
   and they are not given invented levels.
3. **Only `qwen3.8-max` has both** (toggle + `low`/`medium`/`xhigh` +
   `budget_tokens`); it is declared with its ladder.

The default column is a local choice; the panel can set a different default per
model, which lands in the `clinepass` declaration and applies after a restart.

## Permissions and privacy

- Permissions: `provider.register`, `ui.panel`, `ui.view`, `background.service`.
- One outbound destination: `api.cline.bot`.
- On disk: only the plugin data directory (`routing-state.json`: last routing result
  per model plus 200 log lines, no request bodies, no credentials).
- The key normally stays on the host side; the optional plugin `apiKey` is stored as
  a DPAPI blob on Windows and plaintext elsewhere (with a visible warning).
- The plugin process is not an OS-level sandbox — only load plugins you trust.

## Development

```
main.js                        loopback forwarding + routing parsing + panel channels + declaration rewrite
renderer/                      full panel (index/panel.*) and the docked status view (view.*)
manifest.json                  two providers + panel/view/commands/service/settings
scripts/sync-clinepass.mjs     syncs both providers' model lists from Cline's catalog
scripts/test-plugin.mjs        38 checks (endpoint, channels, parser, both pages' real render)
dist/                          packaged artifact (store-only zip, .piplug)
```

```
node scripts/sync-clinepass.mjs --check   # report drift only
node scripts/sync-clinepass.mjs           # rewrite manifest.json (both providers)
node scripts/test-plugin.mjs              # run the checks (the copy gets its own port)
```

Package with `PluginPack` (a store-only zip) — never with `zip` or `tar`.

## License

This repository ships no license file. The upstream-observer code comes from
[moyunliuyin/pi-desktop-cline-upstream](https://github.com/moyunliuyin/pi-desktop-cline-upstream)
(MIT); see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
