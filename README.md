# PI-Desktop ClinePass 插件

[English](./README.en.md) | **简体中文**

让 PI-Desktop 通过 **ClinePass** 订阅调用 Cline 提供的一组编码模型。

> ⚠️ **本项目为第三方非官方插件**，与 Cline（cline.bot）官方无任何关系。
> 使用前请确认你已拥有有效的 ClinePass 订阅，并遵守 Cline 的服务条款。

---

## 简介

ClinePass 是 Cline 推出的 **$9.99/月** 订阅，在精选开源编码模型上提供相对标准 API 费率 **2–5 倍**的额度。
Cline 官方支持在 Cline 之外调用它（见 [官方文档](https://docs.cline.bot/getting-started/clinepass) 的
"Using ClinePass outside of Cline" 一节），接口是标准的 OpenAI 兼容 Chat Completions。

本插件把这个订阅接进 PI-Desktop：装完之后，PI-Desktop 的模型列表里会出现 ClinePass 的全部模型，直接用即可。

**特性**

- 声明式插件，不执行任何自定义代码，权限只申请 `provider.register`
- 内置 14 个 ClinePass 模型，无需手动填写模型 ID
- 部分模型带**官方 reasoning 档位**（思考强度可调）
- 启动时自动对账，Cline 更新模型后只需更新插件

---

## 前置条件

| 项目 | 说明 |
| --- | --- |
| PI-Desktop | 需支持插件与 `contributes.providers` |
| ClinePass 订阅 | $9.99/月，在 [app.cline.bot](https://app.cline.bot/dashboard/subscription?personal=true) 订阅 |
| API Key | 在 app.cline.bot → **Settings → API Keys** 生成 |

---

## 目录结构

```
.
├── manifest.json   插件全部内容：provider 声明 + 模型列表 + thinking 档位
├── main.js         空实现
└── README.md
```

**为什么 `main.js` 是空的？**

Provider 属于 PI-Desktop 的**声明式贡献**：host-core 加载插件时直接读
`manifest.json` 的 `contributes.providers`，据此在数据库里建立 provider 行，并在每次启动时重新对账。
整个过**不需要 `main.js` 执行任何代码**。

但 `main.js` 又不能省略，因为：`manifest.json` 的 `"main"` 字段是必填，且所指文件必须真实存在，
否则加载会报 `PLUGIN_LOAD_FAILED: main entry missing`。因此这里放了一个空壳来满足契约。

> 也就是说：**功能上只有 `manifest.json` 是必需的**，`main.js` 是形式要求。

---

## 安装

1. 打开 PI-Desktop → **设置 → 插件（Plugins）**
2. 点击 **Load local plugin**（加载本地插件）
3. 选中本插件所在目录
4. 批准 `provider.register` 权限

---

## 配置 API Key

API Key **不包含在本插件里**，它保存在应用的安全存储中：

1. 打开 **设置 → Providers（服务商）**
2. 找到 **ClinePass**
3. 粘贴你的 Cline API Key
4. 保存

然后就可以在模型选择器里选 ClinePass 的模型了。

---

## 模型列表

| 模型 | Model ID | 上下文 |
| --- | --- | --- |
| GLM-5.3 | `cline-pass/glm-5.3` | 1,310,720 |
| GLM-5.3-Flash | `cline-pass/glm-5.3-flash` | 1,310,720 |
| Kimi K3 | `cline-pass/kimi-k3` | 1,048,576 |
| DeepSeek V4 Pro | `cline-pass/deepseek-v4-pro` | 1,048,576 |
| DeepSeek V4.1 Flash | `cline-pass/deepseek-v4.1-flash` | 1,048,576 |
| MiMo-V2.5 | `cline-pass/mimo-v2.5` | 1,050,000 |
| MiMo-V2.5-Pro | `cline-pass/mimo-v2.5-pro` | 1,050,000 |
| MiMo-V2.6-Flash | `cline-pass/mimo-v2.6-flash` | 1,048,576 |
| MiMo-V2.6-Pro | `cline-pass/mimo-v2.6-pro` | 1,048,576 |
| MiniMax-M3 | `cline-pass/minimax-m3` | 1,048,576 |
| Muse Spark 1.3 Contributor | `cline-pass/muse-spark-1.3-contributor` | 1,048,576 |
| Qwen3.7 Max | `cline-pass/qwen3.7-max` | 1,000,000 |
| Qwen3.7 Plus | `cline-pass/qwen3.7-plus` | 1,000,000 |
| Qwen3.8 Max | `cline-pass/qwen3.8-max` | 128,000 |

> 模型列表来自 Cline CLI 自带的注册表（`@cline/llms`）。Cline 可能随时增删模型，
> 如发现过期请提 issue 或更新 `manifest.json`。

**ClinePass 不包含 Claude。** Claude 系列在 Cline 里属于 `anthropic/*`，走的是**按量付费**，
与本订阅无关。

---

## 思考强度（Thinking Levels）

各模型的档位**直接取自 Cline 官方定义**，未做任何改写：

| 模型 | 档位 | 默认 |
| --- | --- | --- |
| GLM-5.3 / GLM-5.3-Flash | `low` `high` `max` | high |
| Kimi K3 | `low` `high` `max` | high |
| DeepSeek V4.1 Flash | `low` `high` `max` | high |
| DeepSeek V4 Pro | `high` `xhigh` | high |
| Muse Spark 1.3 Contributor | `minimal` `low` `medium` `high` `xhigh` `max` | medium |
| MiMo 系列、MiniMax-M3、Qwen3.7 / Qwen3.8 | —（见下） | — |

---

## 已知限制

**1. `off` 档位未提供，因为它无法真正关闭思考。**

PI-Desktop 在 `off` 时的行为是**不发送** `reasoning_effort`，而**不是**发送"关闭"。
实测：对 MiMo-V2.5 不发送该参数时，仍然产生了 547 个 reasoning token。
真正关闭思考需要 Cline 私有的 `reasoning: {"enabled": false}` 对象，而插件 manifest 无法表达它。
因此与其提供一个名不副实的开关，不如不提供。

**2. 八个模型没有档位可选。**

Cline 对这些模型只提供「开 / 关」开关，没有档位表：
MiMo-V2.5、MiMo-V2.5-Pro、MiMo-V2.6-Flash、MiMo-V2.6-Pro、MiniMax-M3、Qwen3.7 Max、Qwen3.7 Plus、Qwen3.8 Max。
PI-Desktop 的 provider 贡献只能表达 `thinkingLevels`（一列档位），表达不了开关，
所以这些模型保持原样，而不是去编造一组并不存在的档位。

---

## 实现原理

| 环节 | 说明 |
| --- | --- |
| 请求端点 | `baseUrl` + `/chat/completions` → `https://api.cline.bot/api/v1/chat/completions` |
| 认证 | `Authorization: Bearer <API Key>` |
| 协议 | `apiStyle: chat_completions` → pi-ai 的 `openai-completions` 适配器 |
| 角色 | 默认发送 `system` 而非 `developer`，符合 ClinePass 的要求 |
| 未知模型 | 若某个模型 ID 不在本地元数据中，会退回通用配置，不会被丢弃 |

Provider 行的 id 为 `plugin:pi.clinepass:clinepass`，由插件 id 与声明的 provider id 拼成。
**修改插件 id 会导致出现第二个 ClinePass 条目**，因此请勿随意改动。

---

## 常见问题

**Q：能用 Claude 吗？**
不能。ClinePass 不包含 Claude，`cline-pass/claude-*` 这类 ID 并不存在（实测返回 404）。
想用 Claude 请直接配置 `anthropic/*`（按量付费）。

**Q：同一目录放了多个版本的插件会冲突吗？**
不会自动冲突，因为 PI-Desktop 只加载你显式加载或已登记的那一个。
但若两个版本**插件 id 相同**，后加载的会**覆盖**先前的注册——同一时刻只会有一个 ClinePass。
想回退，重新加载旧目录即可。

**Q：换新版本后 API Key 要重填吗？**
不需要。provider 行 id 未变，凭据会保留。

---

## 免责声明

- 本项目为**非官方**第三方插件，作者与 Cline 无关联。
- 订阅、计费、额度、模型上下架均由 Cline 决定，本项目不做任何保证。
- 模型列表与档位信息可能随 Cline 更新而过期，请以 Cline 官方文档为准。
- 请勿将 API Key 提交到任何仓库；本插件不会存储你的凭据。

## 许可证

本仓库尚未声明许可证。如需开源，建议添加 `LICENSE` 文件（例如 MIT）。
