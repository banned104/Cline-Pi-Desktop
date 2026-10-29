# ClinePass provider plugin for PI-Desktop

Declares Cline's **ClinePass** subscription as a PI-Desktop provider, and adds an
**upstream observer** channel: which upstream actually served each request, how
many fallbacks remain, prompt-cache hits and cost.

## Two providers

| Provider | Endpoint | Credential | Purpose |
| --- | --- | --- | --- |
| **ClinePass** | `https://api.cline.bot/api/v1` | the key in the host's secret store (`authKind: api_key`) | direct; never touches the plugin; behaves like 1.x |
| **ClinePass Upstream** | `http://127.0.0.1:41892/v1` (this plugin) | same key — the host signs `Authorization: Bearer <key>` for that row | forwards the same requests and records where they landed; can anchor a model to an upstream |

Both declare the **same 15** `cline-pass/*` models (`contributes.providers` in
`manifest.json`). The list is generated from Cline's own catalog by
`scripts/sync-clinepass.mjs`, which keeps both providers in step.

`main.js` only has runtime behavior on the **observer** path: it runs a loopback
endpoint, forwards, reads the routing metadata the gateway returns, and publishes
results to the panel. The direct provider stays purely declarative.

## Install

1. Open PI-Desktop → **Settings → Plugins**.
2. Use **Install from folder** and pick this directory, or install
   `dist/pi.clinepass-2.0.0.piplug`.
3. Approve `provider.register`, `ui.panel`, `background.service`.

Upgrading to 2.0.0 adds two permissions, so the host asks you to re-approve.

## Add your credential

Each provider has its own row and needs its own key (create one at
`app.cline.bot` → Settings → API Keys):

1. **Settings → Providers → ClinePass** — the direct one.
2. **Settings → Providers → ClinePass Upstream** — the observer. **Filling only
   this one is the recommended setup**: the plugin forwards with the
   `Authorization` header the host already sends for that row, so the key is
   never written to plugin storage or to a snapshot.

There is also an **optional** `apiKey` in the plugin's own settings
(Settings → Plugins → ClinePass). It is only a fallback for calls made outside a
request (catalog refresh, the panel's probe) or when the host sends no
Authorization header. On Windows it is sealed with DPAPI into `apiKeyEnc`, so
disk and snapshots carry ciphertext only; on other platforms there is no
equivalent and it stays plaintext, which the log and the panel both say.

The direct provider's endpoint matches Cline's own client (`api.cline.bot` +
`/api/v1`) and the key is sent as `Authorization: Bearer <key>`, so no path or
header needs adjusting.

## Models

The full slug is sent as the API `model` field. Claude is **not** part of
ClinePass — those live under `anthropic/*` and bill pay-as-you-go.

| Model | Model ID | Context window | Max output | Images |
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

Every number — model list, context window, output ceiling, capabilities, reasoning
ladders — comes from **Cline's own catalog**, not a third-party index:

- the `"cline-pass"` block of `sdk/packages/llms/src/catalog/catalog.generated.ts`
  (`contextWindow`, `maxInputTokens`, `maxTokens`, `capabilities`,
  `reasoningOptions`);
- the `clinePass` list in `cline-recommended.generated.ts`;
- the live endpoint `GET https://api.cline.bot/api/v1/ai/cline/recommended-models`
  as a cross-check.

**Both token limits are user-editable.** In **Settings → Providers → ClinePass**
each model row carries its own context-window and max-output fields. They start
out following the published numbers above (`contextWindowSource: "catalog"`) and
switch to your value once you edit them (`"user"`). What you can set is the number
PI-Desktop plans against — the model's real ceiling still comes from Cline's side,
so raising it past the published value does not buy more context.

Cline's current catalog does **not** contain these slugs, so they are not
declared: `cline-pass/glm-5.2`, `cline-pass/kimi-k2.6`,
`cline-pass/kimi-k2.7-code`, `cline-pass/deepseek-v4-flash` (retired earlier) and
`cline-pass/mimo-v2.5`, `cline-pass/mimo-v2.5-pro` (retired in October 2026).
Selecting one only produces a model-not-found error.

## Thinking levels

Levels are declared only where Cline publishes an effort ladder, using its level
names unchanged:

| Model(s) | Levels | Default |
| --- | --- | --- |
| GLM-5.3, GLM-5.3-Flash, Kimi K3, Kimi K3.1 Pro, DeepSeek V4.1 Flash, DeepSeek V4.1 Flash 1017 | `low` `high` `max` | `high` |
| DeepSeek V4 Pro | `high` `xhigh` | `high` |
| MiniMax-M3.1-Flash | `low` `medium` `high` `xhigh` `max` | `medium` |
| Muse Spark 1.3 Contributor | `minimal` `low` `medium` `high` `xhigh` `max` | `medium` |
| Qwen 3.8 Max | `low` `medium` `xhigh` | `medium` |
| MiMo-V2.6-Flash, MiMo-V2.6-Pro, MiniMax-M3, Qwen3.7 Max, Qwen3.7 Plus | *(none declared)* | — |

Three notes on why the table looks like this:

1. **`off` is not declared.** The host *can* declare `off`, and `off` means
   exactly "send nothing" (no `reasoning_effort`); but Cline models "no
   reasoning" as the level `none`, which its client sends as an explicit value.
   Those are not the same request to the gateway, so neither `off` nor `none` is
   declared here (`none` is not a legal host level at all — it is dropped
   silently). The cost: the five models whose ladder starts at `none`
   (`deepseek-v4-pro`, `deepseek-v4.1-flash`, `deepseek-v4.1-flash-1017`,
   `kimi-k3`, `kimi-k3.1-pro`) cannot be put into a no-reasoning mode from
   PI-Desktop.
2. **Toggle-only models get no level control.** The five models above expose an
   on/off toggle rather than a ladder. `thinkingLevels` cannot express a toggle,
   so they are declared without levels instead of with invented ones. They still
   reason; PI-Desktop simply sends no `reasoning_effort` for them.
3. **The only model with both a toggle and a ladder** is `qwen3.8-max` (`toggle`
   + `low`/`medium`/`xhigh` + `budget_tokens` 0–262,144). It is declared with its
   ladder: the "reasoning off" toggle has no counterpart in the manifest, and
   neither does `budget_tokens` — PI-Desktop sends `reasoning_effort`.

The `Default` column is a local choice (the leading rung of each ladder, or
`medium` for Muse Spark 1.3 Contributor and MiniMax-M3.1-Flash); Cline's catalog
does not publish a default per model. **The upstream panel can pick a different
default per model**; saving writes it into the `ClinePass Upstream` row's
declaration and takes effect after a restart.

## Upstream observer

Behind one ClinePass model sit twenty-odd upstreams (DeepSeek itself, Fireworks,
Baseten, DigitalOcean…), and a client cannot see which one served a request. The
gateway returns its own `routing` object in **every** response, and PI-Desktop
does not parse it (`finalProvider` appears 0 times in the app's code), so the only
way to see it is to sit in the request path — which is why the second provider
exists.

**How to use it**: switch the model to any `cline-pass/*` on **ClinePass
Upstream**, send a message, then run the command **"ClinePass: 打开上游面板"**
(or **"ClinePass: 清空上游检测记录"** to clear it).

The panel is a read-only observer; writes happen when you press **保存**:

| Column | Meaning |
| --- | --- |
| Time / model | when the request landed; the model id is shown in full, with `→ sent id` when it was rewritten |
| Landed | the upstream that actually served it; green = matches your target, red = does not |
| Pinned | the session-pinned upstream the gateway itself reports |
| Fallbacks | `fallbacksAvailable` count: above 0 means the request can still be downgraded |
| Cache hit | `promptCacheHitTokens`; `—` when the lane does not report it |
| Cost | `marketCost`, else `inferenceCost`, else `cost` (a private lane reports `cost` as 0) |
| Verdict | observe-only / matched / gateway ignored / no metadata |

The log keeps one line per request — the last 60 in the snapshot, 200 in the
plugin's data directory — and never contains request bodies.

### Target upstreams and "gateway ignored"

Tick target upstreams and turn on "写入 routing（实验）" and the plugin adds
`provider: { only: [...] }` (optionally with `allow_fallbacks: false`), then
compares the response's `finalProvider`. **The gateway ignores that field**, so
the panel shows "网关忽略" — that is the expected result today, not a
misconfiguration. Cline's public `POST /chat/completions` documentation lists
only 5 body parameters and no provider routing field either.

### Anchoring an upstream (only by rewriting the model id)

Two measured facts:

1. `clientSessionId` is derived from the API key — passing `sessionId` /
   `clientSessionId` in the body, or `x-session-id` / `x-cline-session-id`
   headers, is ignored, so a request cannot be re-rolled by changing session.
2. The landing upstream is a function of **(key, model id)**: the same id always
   lands on the same upstream; a different id lands elsewhere.

So anchoring means: **probe candidate ids, pick one that lands on the target
upstream, and have the plugin rewrite `model` when forwarding.** That is the
second dropdown on each model row in the panel ("原样转发" = do not rewrite); the
**探测** button next to it tries a few same-family ids for that model and lists
where each one lands. Each probe costs a few real calls (~$0.00003 each). Results
split into **anchorable** (some id selects it) and **fallback-only** (used only
when the primary fails, so a client cannot select it).

The price is explicit: **a different id can serve a different variant of the
model** (same family, possibly another version or quantization). For zero risk,
leave the dropdown on "原样转发" and use the panel as a pure observer.

### Which models are enabled / per-model default thinking level

The panel's checkboxes are stored in plugin settings, and the plugin **rewrites
its own installed `manifest.json`** to narrow the `ClinePass Upstream` row's model
list to your selection:

| Layer | Controlled by | Takes effect |
| --- | --- | --- |
| What the picker shows | PI — writes `manifest.json` into the provider row at startup | **after restarting PI** |
| What is usable | this plugin (whitelist) | immediately; an unchecked model always returns `404 model_not_enabled` |

Note that the rewritten file is the **installed copy**; the repository's
`manifest.json` (generated by the sync script) is untouched. Reinstalling resets
that row to the official 15 — save once more to re-apply. The direct
**ClinePass** row always keeps all 15.

The candidate list never shrinks on its own: when a fetch fails it falls back to
"official declaration ∪ everything already known", so a narrowed list can always
be widened again. The **「全选官方」** button restores all 15 in one click.

### Boundaries (platform facts, not plugin defects)

- A plugin cannot reuse another provider's key (the host states "The plugin never
  receives it"), so the observer row needs its own key — entered on the **host**
  side (Settings → Providers); the plugin only forwards the header it receives.
- A panel cannot reach loopback (panel egress is denied), so panel data travels
  through the plugin settings channel.
- Streaming must be preserved: the plugin strips `accept-encoding` so the
  `routing` block stays readable (bandwidth for observability).
- The loopback port is fixed at `127.0.0.1:41892`. If it is taken, the plugin log
  reports it and the observer provider stops working (the direct one is unaffected).

## Permissions and privacy

- Permissions: `provider.register`, `ui.panel`, `background.service`.
- One outbound destination: `api.cline.bot` (forwarding your model requests,
  fetching the model catalog, probing upstreams).
- On disk, only the plugin data directory: `routing-state.json` (last routing
  result per model plus the last 200 log lines, without request bodies or
  credentials); the optional plugin key is stored as a DPAPI blob.
- The plugin process is not an OS-level sandbox (the host isolates the host API
  only), so load plugins you trust.

## Development

```
main.js                        loopback forwarding + routing parsing + panel channels + declaration rewrite
renderer/                      panel (index.html / panel.css / panel.js)
manifest.json                  two providers + panel/commands/service/settings
scripts/sync-clinepass.mjs     syncs both providers' model lists from Cline's catalog
dist/                          packaged artifact (store-only zip, .piplug)
```

Syncing:

```
node scripts/sync-clinepass.mjs --check   # report drift only
node scripts/sync-clinepass.mjs           # rewrite manifest.json (both providers)
```

Package with `PluginPack` (a store-only zip) — never with `zip` or `tar`.

## License

This repository ships no license file. The upstream-observer code comes from
[moyunliuyin/pi-desktop-cline-upstream](https://github.com/moyunliuyin/pi-desktop-cline-upstream)
(MIT); the license text is in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
