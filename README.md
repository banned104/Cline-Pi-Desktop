# PI-Desktop ClinePass 插件

把 Cline 的 **ClinePass** 订阅声明成 PI-Desktop 的服务商；并额外提供一条**上游观察**通道：
每个请求实际落在 Cline 网关的哪个上游、还有多少备选、缓存命中与成本。

[English](./README.en.md) | **简体中文**

> ⚠️ 第三方非官方插件，与 Cline（cline.bot）官方无任何关系。使用前请确认你有有效的 ClinePass
> 订阅，并遵守 Cline 的服务条款。
>
> 上游观察部分移植自 [moyunliuyin/pi-desktop-cline-upstream](https://github.com/moyunliuyin/pi-desktop-cline-upstream)
> （MIT，见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)）。

## 两个服务商

| 服务商 | 端点 | 凭据 | 用途 |
| --- | --- | --- | --- |
| **ClinePass** | `https://api.cline.bot/api/v1` | 宿主安全存储里的 key（`authKind: api_key`） | 直连，不经过插件，与 1.x 行为一致 |
| **ClinePass Upstream** | `http://127.0.0.1:41892/v1`（本插件） | 同上：宿主为该行签名 `Authorization: Bearer <key>` | 转发同样的请求并记录真实落点，可锚定上游 |

两条都声明**同一批 15 个** `cline-pass/*` 模型（`manifest.json` 的 `contributes.providers`）。
模型清单由 `scripts/sync-clinepass.mjs` 从 Cline 官方目录生成，两个 provider 一起同步。

`main.js` 只在**上游观察**这条路径上有运行时行为：起一个回环端点、转发、读网关返回的路由元数据、
把结果发布给面板。直连那条完全声明式，插件不参与。

## 安装

1. 打开 PI-Desktop → **设置 → 插件（Plugins）**
2. 用 **Install from folder** 选中本目录，或安装 `dist/pi.clinepass-2.0.0.piplug`
3. 批准权限：`provider.register`、`ui.panel`、`background.service`

升级到 2.0.0 会新增两项权限，宿主会要求你重新授权。

## 填凭据

两个服务商各有一行，各自需要 key（都在 `app.cline.bot` → Settings → API Keys 生成）：

1. **设置 → Providers → ClinePass**：直连那条。
2. **设置 → Providers → ClinePass Upstream**：观察那条。**推荐只填这里**——插件转发时直接使用
   宿主为这一行发送的 `Authorization` 头，key 不落盘、不进快照。

插件设置里还有一个**可选**的 `apiKey`（设置 → 插件 → ClinePass）：只在没有请求经过（拉目录、
面板点「探测」）或宿主没发 Authorization 头时兜底。Windows 上它以 DPAPI 加密后写入
`settings.json` 的 `apiKeyEnc`，磁盘与快照里只有密文；其它平台没有等价机制，会退回明文并在
日志与面板里注明。

直连那条的端点与 Cline 自家客户端一致（`api.cline.bot` + `/api/v1`），key 以
`Authorization: Bearer <key>` 发送，不需要改路径或加 header。

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

这些数字 —— 模型清单、上下文窗口、输出上限、能力、思考档位 —— 都取自 **Cline 官方目录**，
不是第三方索引：

- `sdk/packages/llms/src/catalog/catalog.generated.ts` 的 `"cline-pass"` 块：
  `contextWindow`、`maxInputTokens`、`maxTokens`、`capabilities`、`reasoningOptions`；
- `sdk/packages/llms/src/catalog/cline-recommended.generated.ts` 的 `clinePass` 推荐列表；
- 实时端点 `GET https://api.cline.bot/api/v1/ai/cline/recommended-models`（交叉核对）。

**两个长度都能自己改。** 在 **设置 → Providers → ClinePass** 里，每个模型行都有自己的
上下文窗口与最大输出字段：默认跟随上表的公布值（`contextWindowSource: "catalog"`），
你一旦编辑就变成你的值（`"user"`）。可以改的是 PI-Desktop 据以规划的长度；真实上限仍然由
Cline 一侧决定，所以把数字调高于公布值并不会真的多出上下文。

官方目录里**没有**下面这些 slug，所以这里不声明：`cline-pass/glm-5.2`、
`cline-pass/kimi-k2.6`、`cline-pass/kimi-k2.7-code`、`cline-pass/deepseek-v4-flash`
（更早下线），以及 `cline-pass/mimo-v2.5`、`cline-pass/mimo-v2.5-pro`（2026-10 下线）。
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

1. **不声明 `off`。** 宿主**能**声明 `off`，而 `off` 的含义正是「什么都不发」（不发
   `reasoning_effort`）；但 Cline 的「不思考」是档位 `none`，由它的客户端**明确发送该值**。
   两者对网关不是同一个请求，所以这里不声明 `off`，也不声明 `none`（后者不是宿主的合法档位，
   会被静默丢弃）。代价是 `deepseek-v4-pro`、`deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017`、
   `kimi-k3`、`kimi-k3.1-pro` 这五个（阶梯以 `none` 起步的）无法从 PI-Desktop 进入「不思考」。
2. **只有开关的模型不给档位。** 上面五个模型官方只提供「开 / 关」开关，没有档位阶梯；
   `thinkingLevels` 是一列档位，表达不了开关，所以这些模型不声明档位，而不是编造一组档位。
   它们照样会思考，只是 PI-Desktop 不为它们发送 `reasoning_effort`。
3. **既有开关又有阶梯的模型**只有 `qwen3.8-max`（`toggle` + `low`/`medium`/`xhigh` +
   `budget_tokens` 0–262,144）。按阶梯声明：那个「彻底关掉思考」的开关在 manifest 里没有
   对应物，`budget_tokens` 也表达不了，PI-Desktop 发的是 `reasoning_effort`。

「默认」列是本地选择（各阶梯的首选档，Muse Spark 1.3 Contributor 与 MiniMax-M3.1-Flash
取 `medium`）；官方目录不公布每模型的默认档。**在上游面板里可以给每个模型另选一个默认档**，
保存后写进「ClinePass Upstream」那一行的声明，重启 PI 生效（见下）。

## 上游观察

ClinePass 的同一个模型背后挂着二十多个上游（DeepSeek 官方、Fireworks、Baseten、DigitalOcean…），
客户端看不见这一次到底落在谁身上。网关在**每个响应**里都带回自己的 `routing` 对象，而 PI-Desktop
不解析它（`finalProvider` 在应用代码里出现 0 次），所以想看见就只能站在请求路径上——这就是第二个
服务商存在的理由。

**怎么用**：把模型切到 **ClinePass Upstream** 的任意 `cline-pass/*`，正常发消息；用命令
**「ClinePass: 打开上游面板」** 看结果（或用 **「ClinePass: 清空上游检测记录」** 清空）。

面板是只读的观察器，写入都在面板里点**保存**：

| 列 | 说明 |
| --- | --- |
| 时间 / 模型 | 请求落地时刻；模型 id 完整不截断，改写过会显示 `→ 实际发送的 id` |
| 实际落点 | 本次真正服务的上游；绿色=与目标一致，红色=不一致 |
| 钉住 | 网关自己报告的会话钉选上游 |
| 备选 | `fallbacksAvailable` 数量：大于 0 表示上游不可用时仍会降级 |
| 缓存命中 | `promptCacheHitTokens`；该通道不返回就显示 `—` |
| 成本 | 优先 `marketCost`，其次 `inferenceCost`，最后 `cost`（走私有通道时 `cost` 恒为 0） |
| 校验 | 仅观察 / 落点一致 / 网关忽略 / 无元数据 |

日志按请求逐条记录，只保留最近 60 条（插件数据目录里 200 条），不含请求内容。

### 目标上游与「网关忽略」

勾选目标上游并打开「写入 routing（实验）」，插件会加 `provider: { only: [...] }`（可选
`allow_fallbacks: false`），再用响应的 `finalProvider` 比对。**实测网关忽略该字段**，面板会显示
「网关忽略」——这是当前的预期结果，不是配置错误。Cline 公开文档的 `POST /chat/completions`
也只列 5 个 body 参数，没有 provider 路由字段。

### 锚定上游（只能靠改写模型 id）

实测两条硬事实：

1. `clientSessionId` 由 API Key 决定 —— body 里传 `sessionId` / `clientSessionId`，或加
   `x-session-id` / `x-cline-session-id` 头，网关一律忽略，所以无法靠换会话重掷。
2. 落点是 **(key, 模型 id)** 的函数：同一个 id 连发多次永远是同一家，换 id 才会换家。

所以锚定的做法是：**探测候选 id，选定一个落在目标上游的 id，插件在转发时改写 `model` 字段。**
面板里每个模型行右侧的第二个下拉就是它（「原样转发」= 不改写），旁边的**探测**按钮会为该模型试跑
几个同族 id 并列出各自落点；每次探测会产生几次真实调用（每次约 $0.00003）。探测结果分两类：
**可锚定**（有 id 主选它）与**仅备选**（只在主选失败时被降级使用，客户端无法指定）。

代价要清楚：**id 变了，实际服务的模型变体也会变**（同族，但可能是不同版本或量化）。想零风险，
就把下拉留在「原样转发」，只当观察器用。

### 启用哪些模型 / 每个模型的默认思考强度

面板里的勾选会写进插件设置，并且插件会**改写自己安装目录里的 `manifest.json`**，把
「ClinePass Upstream」这一行的模型表缩成你勾选的那批：

| 层 | 谁控制 | 什么时候生效 |
| --- | --- | --- |
| 列表显示 | PI —— 启动时按 `manifest.json` 写进服务商行 | **重启 PI 之后** |
| 是否可用 | 本插件（白名单） | 保存即生效，未勾选的模型一律 `404 model_not_enabled` |

注意：被改写的是**安装副本**，仓库里的 `manifest.json`（由同步脚本生成）不受影响；
重新安装会把这一行恢复成官方 15 个，再保存一次即可。直连的 **ClinePass** 那一行永远保持官方 15 个。

候选清单只增不减：拉取失败时退回「官方声明 ∪ 已知模型」，不会因为清单被缩过就跟着缩水。
面板上的**「全选官方」**按钮可以把 15 个一次性勾回来。

### 边界（平台事实，不是本插件缺陷）

- 插件拿不到宿主里其它服务商的 key（宿主明文规定 "The plugin never receives it"），所以观察那条
  行需要自己填一次 key——但填的是**宿主侧**（设置 → Providers），插件只透传宿主发来的头。
- 面板不能访问本机端点（panel egress 一律拒绝），所以面板数据经插件设置通道传递。
- 必须保留流式响应：插件会去掉 `accept-encoding` 以便读取 `routing`（体积换可观测性）。
- 回环端口固定 `127.0.0.1:41892`；若被占用，插件日志会报错，观察那条服务商将不可用（直连那条不受影响）。

## 权限与隐私

- 权限：`provider.register`、`ui.panel`、`background.service`
- 出站只有一处：`api.cline.bot`（转发你的模型请求、拉取模型目录、探测上游）
- 落盘只有插件数据目录：`routing-state.json`（每个模型最近一次的路由结果 + 最近 200 条日志，
  不含请求内容与凭据）；可选的插件 key 以 DPAPI 密文存放在插件设置里
- 插件进程不是操作系统级沙箱（宿主目前只隔离 host API），所以只装你信任的插件

## 开发

```
main.js                        回环转发 + routing 解析 + 面板通道 + 声明改写
renderer/                      面板（index.html / panel.css / panel.js）
manifest.json                  两个 provider + 面板/命令/服务/设置
scripts/sync-clinepass.mjs     从 Cline 官方目录同步两个 provider 的模型表
dist/                          打包产物（store-only zip，扩展名 .piplug）
```

同步：

```
node scripts/sync-clinepass.mjs --check   # 只报告漂移
node scripts/sync-clinepass.mjs           # 改写 manifest.json（两个 provider）
```

打包含 `PluginPack`（store-only zip），不要用 `zip`/`tar`。

## 许可

本仓库未附许可文件。上游观察部分来自
[moyunliuyin/pi-desktop-cline-upstream](https://github.com/moyunliuyin/pi-desktop-cline-upstream)，
MIT，许可原文见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
