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
| models     | the 15 ClinePass slugs, hard-coded |

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
  `clinePass` recommendation list, which is exactly these 15 slugs;
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

Those 15 rows are the 15 entries in `manifest.json`, in the same id order, so the
two can be compared line by line.

What changed against 1.2.0 (the catalog as of the previous sync): three models
appeared — `kimi-k3.1-pro`, `minimax-m3.1-flash`, `deepseek-v4.1-flash-1017`;
`mimo-v2.5` and `mimo-v2.5-pro` are gone from the official catalog, so they are
dropped here too; and `qwen3.8-max` was republished — the old snapshot said a
128K window, an 8,192-token ceiling and no image support, while the catalog now
says 262,144 / 128,000 with images, which is what this version declares.

**Both token limits are user-editable.** In **Settings → Providers → ClinePass**
each model row carries its own context-window and max-output fields. They start
out following the published numbers above (`contextWindowSource: "catalog"`) and
switch to your value once you edit them (`"user"`). What you can set is the
number PI-Desktop plans against — the model's real ceiling still comes from
Cline's side, so raising it past the published value does not buy more context.

Cline's current catalog does **not** contain the following slugs, so they are not
declared: `cline-pass/glm-5.2`, `cline-pass/kimi-k2.6`,
`cline-pass/kimi-k2.7-code`, `cline-pass/deepseek-v4-flash` (retired earlier), and
`cline-pass/mimo-v2.5`, `cline-pass/mimo-v2.5-pro` (retired in this round).
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

1. **`off` is not declared, and `none` cannot be sent.** Cline models "no
   reasoning" as the level `none`, which its client sends as a *choice*, while
   PI-Desktop's `off` means "send no `reasoning_effort` at all" — a different
   thing the manifest cannot express. In the current catalog the ladders for
   `deepseek-v4-pro`, `deepseek-v4.1-flash`, `deepseek-v4.1-flash-1017`,
   `kimi-k3` and `kimi-k3.1-pro` **start at `none`**, so those five cannot be put
   into a no-reasoning mode from PI-Desktop: their declared lists carry every
   other rung and nothing else.
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
does not publish a default per model.
