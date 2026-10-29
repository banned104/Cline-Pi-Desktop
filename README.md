# PI-Desktop ClinePass 插件

把 Cline 的 **ClinePass** 订阅声明成 PI-Desktop 的一个 provider，走 Cline 的 OpenAI 兼容
Chat Completions 接口。

[English](./README.en.md) | **简体中文**

> ⚠️ 第三方非官方插件，与 Cline（cline.bot）官方无任何关系。使用前请确认你有有效的 ClinePass
> 订阅，并遵守 Cline 的服务条款。

## 它做什么

`manifest.json` 只贡献一个 provider（`contributes.providers`）：

| 字段 | 值 |
| --- | --- |
| id | `clinepass` |
| apiStyle | `chat_completions` |
| authKind | `api_key` |
| baseUrl | `https://api.cline.bot/api/v1` |
| models | ClinePass 的 15 个 slug，写死 |

host-core 在加载时按这份声明建立 provider 行，并在每次启动时重新对账，模型无需手工录入。
`main.js` 是**刻意的空实现**（manifest 的 `main` 字段必填，且所指文件必须存在）。

下面所有数字 —— 模型清单、上下文窗口、输出上限、能力、思考档位 —— 都取自 **Cline 官方目录**，
不是第三方索引：

- `sdk/packages/llms/src/catalog/catalog.generated.ts` 的 `"cline-pass"` 块：
  `contextWindow`、`maxInputTokens`、`maxTokens`、`capabilities`、`reasoningOptions`；
- `sdk/packages/llms/src/catalog/cline-recommended.generated.ts` 的 `clinePass` 推荐列表，
  正好就是这 15 个 slug；
- `sdk/packages/shared/src/llms/reasoning-options.ts` 的档位词表
  （`none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`），以及
  `reasoning_effort` 只接受除 `none` 以外的档位。

## 安装

1. 打开 PI-Desktop → **设置 → 插件（Plugins）**
2. 用 **Install from folder** 选中本目录
3. 批准 `provider.register` 权限

## 填凭据

API Key **不在本包内**，它保存在应用的安全存储里：

1. **设置 → Providers（服务商）**，找到 **ClinePass**
2. 粘贴你的 Cline API Key（在 `app.cline.bot` → Settings → API Keys 生成）
3. 保存

端点与 Cline 自己的客户端一致（`api.cline.bot` + `/api/v1`），Key 以
`Authorization: Bearer <key>` 发送。Cline 自家也是把 ClinePass provider 注册在这个端点上、
用同一个 `CLINE_API_KEY`，所以这里不需要改路径或加 header。

## 模型

请求里的 `model` 字段用完整 slug。Claude **不属于** ClinePass —— 它在 `anthropic/*` 下按量付费。

| 模型 | Model ID | 上下文窗口 | 最大输出 | 图片 |
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

表里 15 行就是 `manifest.json` 里那 15 条（按 id 排序），方便逐行对照。

相对 1.2.0 那一版（上一次同步时的官方目录）本轮的变化：新增 `kimi-k3.1-pro`、
`minimax-m3.1-flash`、`deepseek-v4.1-flash-1017` 三条；`mimo-v2.5`、`mimo-v2.5-pro`
已从官方目录下线，因此这里也删掉；`qwen3.8-max` 的公布值变了 —— 旧快照是 128K 窗口 /
8,192 输出、不支持图片，现在目录里是 262,144 / 128,000 且支持图片，本轮按官方目录改正。

**两个长度都能自己改。** 在 **设置 → Providers → ClinePass** 里，每个模型行都有自己的
上下文窗口与最大输出字段：默认跟随上表的公布值（`contextWindowSource: "catalog"`），
你一旦编辑就变成你的值（`"user"`）。可以改的是 PI-Desktop 据以规划的长度；真实上限仍然由
Cline 一侧决定，所以把数字调高于公布值并不会真的多出上下文。

官方目录里**没有**下面这些 slug，所以这里不声明：`cline-pass/glm-5.2`、
`cline-pass/kimi-k2.6`、`cline-pass/kimi-k2.7-code`、`cline-pass/deepseek-v4-flash`
（更早下线），以及本轮下线的 `cline-pass/mimo-v2.5`、`cline-pass/mimo-v2.5-pro`。
选了只会得到 model not found。

## 思考强度

只在 Cline 公布了档位阶梯时才声明档位，且沿用官方档位名：

| 模型 | 档位 | 默认 |
| --- | --- | --- |
| GLM-5.3、GLM-5.3-Flash、Kimi K3、Kimi K3.1 Pro、DeepSeek V4.1 Flash、DeepSeek V4.1 Flash 1017 | `low` `high` `max` | `high` |
| DeepSeek V4 Pro | `high` `xhigh` | `high` |
| MiniMax-M3.1-Flash | `low` `medium` `high` `xhigh` `max` | `medium` |
| Muse Spark 1.3 Contributor | `minimal` `low` `medium` `high` `xhigh` `max` | `medium` |
| Qwen 3.8 Max | `low` `medium` `xhigh` | `medium` |
| MiMo-V2.6-Flash、MiMo-V2.6-Pro、MiniMax-M3、Qwen3.7 Max、Qwen3.7 Plus | —（见下） | — |

三点说明：

1. **不声明 `off`，`none` 也发不出去。** Cline 把"不思考"表达成档位 `none`，由它的客户端
   **发送**该值；而 PI-Desktop 的 `off` 是"**什么都不发**"，两者不是一回事，manifest 也表达不了。
   当前目录里 `deepseek-v4-pro`、`deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017`、
   `kimi-k3`、`kimi-k3.1-pro` 的阶梯**以 `none` 起步**，所以这五个模型没法从 PI-Desktop
   进入"不思考"：声明出来的列表里没有 `none`，其余档位一个不少。
2. **只有开关的模型不给档位。** 上面五个模型官方只提供「开 / 关」开关，没有档位阶梯；
   `thinkingLevels` 是一列档位，表达不了开关，所以这些模型不声明档位，而不是编造一组档位。
   它们照样会思考，只是 PI-Desktop 不为它们发送 `reasoning_effort`。
3. **既有开关又有阶梯的模型**只有 `qwen3.8-max`（`toggle` + `low`/`medium`/`xhigh` +
   `budget_tokens` 0–262,144）。按阶梯声明：那个"彻底关掉思考"的开关在 manifest 里没有
   对应物，`budget_tokens` 也表达不了，PI-Desktop 发的是 `reasoning_effort`。

「默认」列是本地选择（各阶梯的首选档，Muse Spark 1.3 Contributor 与 MiniMax-M3.1-Flash
取 `medium`）；官方目录不公布每模型的默认档。
