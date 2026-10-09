# ClinePass provider plugin for PI-Desktop

Declares Cline's **ClinePass** subscription as a PI-Desktop provider over
Cline's OpenAI-compatible Chat Completions API.

## What it does

`manifest.json` contributes one provider (`contributes.providers`):

| Field      | Value                            |
| ---------- | -------------------------------- |
| id         | `clinepass`                      |
| apiStyle   | `chat_completions`               |
| authKind   | `api_key`                        |
| baseUrl    | `https://api.cline.bot/api/v1`   |
| models     | the 14 ClinePass slugs, hard-coded |

host-core materializes the provider row from this declaration on load and
re-reconciles it on every startup, so the models stay selectable without any
manual entry. `main.js` is a deliberate no-op (the manifest must name a `main`
entry).

Every number below — model list, context window, output limit, capabilities and
reasoning levels — is taken from **Cline's own catalog**, not from a
third-party index:

* `sdk/packages/llms/src/catalog/catalog.generated.ts` — the `"cline-pass"`
  block: `contextWindow`, `maxInputTokens`, `maxTokens`, `capabilities`,
  `reasoningOptions`;
* `sdk/packages/llms/src/catalog/cline-recommended.generated.ts` — the
  `clinePass` recommendation list, which is exactly these 14 slugs;
* `sdk/packages/shared/src/llms/reasoning-options.ts` — the level vocabulary
  (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) and the fact that
  `reasoning_effort` accepts every level except `none`.

## Install

1. Open PI-Desktop → **Settings → Plugins**.
2. Use **Install from folder** and pick this directory.
3. Approve the `provider.register` permission.

## Add your credential

The API key is **not** part of this package — it belongs in the app's secret
store:

1. **Settings → Providers**, find **ClinePass**.
2. Paste your Cline API key (created at `app.cline.bot` → Settings → API Keys).
3. Save.

The endpoint matches Cline's own client (`api.cline.bot` + `/api/v1`), and the
key is sent as `Authorization: Bearer <key>`. Cline registers its own ClinePass
provider against that same endpoint and that same `CLINE_API_KEY`, so no path or
header needs adjusting here.

## Models

The full slug is sent as the API `model` field. Claude is **not** part of
ClinePass — those live under `anthropic/*` and bill pay-as-you-go.

| Model | Model ID | Context window | Max output | Images |
| --- | --- | --- | --- | --- |
| GLM-5.3 | `cline-pass/glm-5.3` | 1,048,576 | 943,718 | — |
| GLM-5.3-Flash | `cline-pass/glm-5.3-flash` | 1,048,576 | 943,717 | ✓ |
| Kimi K3 | `cline-pass/kimi-k3` | 1,048,576 | 943,718 | ✓ |
| DeepSeek V4 Pro | `cline-pass/deepseek-v4-pro` | 1,048,576 | 384,000 | — |
| DeepSeek V4.1 Flash | `cline-pass/deepseek-v4.1-flash` | 1,048,576 | 943,718 | ✓ |
| Muse Spark 1.3 Contributor | `cline-pass/muse-spark-1.3-contributor` | 1,048,576 | 943,718 | ✓ |
| MiMo-V2.5 | `cline-pass/mimo-v2.5` | 1,050,000 | 131,072 | ✓ |
| MiMo-V2.5-Pro | `cline-pass/mimo-v2.5-pro` | 1,050,000 | 131,072 | — |
| MiMo-V2.6-Flash | `cline-pass/mimo-v2.6-flash` | 1,050,000 | 131,072 | ✓ |
| MiMo-V2.6-Pro | `cline-pass/mimo-v2.6-pro` | 1,050,000 | 131,072 | ✓ |
| MiniMax-M3 | `cline-pass/minimax-m3` | 1,048,576 | 512,000 | ✓ |
| Qwen3.7 Max | `cline-pass/qwen3.7-max` | 1,000,000 | 131,072 | — |
| Qwen3.7 Plus | `cline-pass/qwen3.7-plus` | 1,000,000 | 131,072 | ✓ |
| Qwen3.8 Max | `cline-pass/qwen3.8-max` | 128,000 | 8,192 | — |

Qwen3.8 Max really is the small one: Cline's catalog gives it a 128K window and
an 8,192-token output ceiling, far below the other Qwen lanes.

**Both token limits are user-editable.** In **Settings → Providers → ClinePass**
each model row carries its own context-window and max-output fields. They start
out following the published numbers above (`contextWindowSource: "catalog"`) and
switch to your value once you edit them (`"user"`). What you can set is the
number PI-Desktop plans against — the model's real ceiling still comes from
Cline's side, so raising it past the published value does not buy more context.

Older catalogs also list `cline-pass/glm-5.2`, `cline-pass/kimi-k2.6`,
`cline-pass/kimi-k2.7-code` and `cline-pass/deepseek-v4-flash`. Cline's current
catalog does **not** contain them, so they are not declared: selecting one only
produces a model-not-found error.

## Thinking levels

Levels are declared only where Cline publishes an effort ladder, using its level
names unchanged:

| Model(s) | Levels | Default |
| --- | --- | --- |
| GLM-5.3, GLM-5.3-Flash, Kimi K3, DeepSeek V4.1 Flash | `low` `high` `max` | `high` |
| DeepSeek V4 Pro | `high` `xhigh` | `high` |
| Muse Spark 1.3 Contributor | `minimal` `low` `medium` `high` `xhigh` `max` | `medium` |
| MiMo-V2.5, MiMo-V2.5-Pro, MiMo-V2.6-Flash, MiMo-V2.6-Pro, MiniMax-M3, Qwen3.7 Max, Qwen3.7 Plus, Qwen3.8 Max | *(none declared)* | — |

Three notes on why the table looks like this:

1. **`off` is not declared.** Cline models "no reasoning" as the level `none`,
   which its client sends as a *choice*, while PI-Desktop's `off` means "send no
   `reasoning_effort` at all" — a different thing the manifest cannot express.
   None of the 14 ClinePass ladders start at `none` anyway, so nothing is lost:
   each declared list is exactly the effort values in Cline's catalog.
2. **Toggle-only models get no level control.** Eight models expose an on/off
   toggle rather than a ladder. `thinkingLevels` cannot express a toggle, so
   they are declared without levels instead of with invented ones. They still
   reason; PI-Desktop simply sends no `reasoning_effort` for them.
3. **Models with both a toggle and a ladder** (Kimi K3, DeepSeek V4 Pro,
   DeepSeek V4.1 Flash) are declared with their ladder. The toggle — switching
   reasoning off entirely — has no counterpart in the manifest, so those three
   cannot be put into a no-reasoning mode from PI-Desktop.

The `Default` column is a local choice (the leading rung of each ladder, or
`medium` for Muse Spark); Cline's catalog does not publish a default per model.
