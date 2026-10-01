# ClinePass provider plugin for PI-Desktop — v1.1.0 (thinking levels)

**English** | [简体中文](./README.md)

Declares Cline's **ClinePass** subscription as a PI-Desktop provider over
Cline's OpenAI-compatible Chat Completions API.

**Difference from v1.0.0:** models now declare their official reasoning effort
levels, so PI-Desktop shows a thinking-level control and sends the selected
level as `reasoning_effort`.

## Provider declaration

| Field    | Value                          |
| -------- | ------------------------------ |
| id       | `clinepass`                    |
| apiStyle | `chat_completions`             |
| authKind | `api_key`                      |
| baseUrl  | `https://api.cline.bot/api/v1` |
| models   | the 14 current ClinePass slugs |

## Thinking levels

The values below are Cline's own `reasoningOptions` for each model, taken from
`@cline/llms`. They already fall inside PI-Desktop's canonical thinking levels
(`off/minimal/low/medium/high/xhigh/max`), so nothing is remapped.

| Model(s)                                       | thinkingLevels                                  | default |
| ---------------------------------------------- | ----------------------------------------------- | ------- |
| `glm-5.3`, `glm-5.3-flash`, `kimi-k3`, `deepseek-v4.1-flash` | `low`, `high`, `max`               | `high`  |
| `deepseek-v4-pro`                              | `high`, `xhigh`                                 | `high`  |
| `muse-spark-1.3-contributor`                   | `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | `medium` |
| `mimo-v2.5`, `mimo-v2.5-pro`, `mimo-v2.6-flash`, `mimo-v2.6-pro`, `minimax-m3`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.8-max` | *(none declared)* | — |

Measured against the live API (2026-09-26):

* `reasoning_effort` is honoured. On `glm-5.3`, `reasoning_effort: "low"` dropped
  reasoning tokens to 0 while `"max"` kept them; on `mimo-v2.5`, `"high"`/`"low"`
  both reduced reasoning versus sending nothing.
* The accepted vocabulary is exactly
  `none/minimal/low/medium/high/xhigh/max`; any other string returns HTTP 500.

### Two honest limitations

1. **`off` is not declared.** Selecting `off` in PI-Desktop sends *no*
   `reasoning_effort` — it does not disable thinking. On `mimo-v2.5` a request
   with no effort still produced 547 reasoning tokens. Actually disabling
   reasoning needs Cline's `reasoning: {"enabled": false}` object, which the
   plugin manifest has no way to express. Declaring `off` would therefore be a
   control that does not do what it says.

2. **Toggle-only models have no level control.** For eight models Cline exposes
   only an on/off toggle, not an effort ladder (see the table). PI-Desktop's
   provider contribution only carries `thinkingLevels`, which cannot represent a
   toggle, so those models are left without a level list rather than given
   invented values.

## Install

1. Open PI-Desktop → **Settings → Plugins**.
2. **Load local plugin** and pick this directory.
3. Approve the `provider.register` permission.

Installing this replaces the v1.0.0 registration (same plugin id `pi.clinepass`).
To revert, load the original folder again.

## Credential

The API key is **not** part of this package: **Settings → Providers →
ClinePass**, paste the key created at `app.cline.bot` → Settings → API Keys.
