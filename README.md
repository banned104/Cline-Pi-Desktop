# PI-Desktop ClinePass 插件

把 Cline 的 **ClinePass** 订阅接进 PI-Desktop，并且**顺手把每次请求真实落在 Cline 网关的哪个上游**显示出来
（同一模型背后挂着 deepseek / fireworks / baseten / alibaba 等二十多家，客户端平时看不见）。

[English](./README.en.md) | **简体中文**

> ⚠️ 第三方非官方插件，与 Cline（cline.bot）官方无关系。你需要有效的 ClinePass 订阅。
>
> 上游观察部分移植自 [moyunliuyin/pi-desktop-cline-upstream](https://github.com/moyunliuyin/pi-desktop-cline-upstream)（MIT，见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)）。

---

## 30 秒用起来

1. **装**：设置 → 插件 → 安装 `dist/pi.clinepass-2.2.0.piplug`（或 Install from folder 选本目录），
   批准 4 个权限（`provider.register`、`ui.panel`、`ui.view`、`background.service`）。
2. **重启 PI-Desktop**（清单变了，宿主只在启动时重建服务商与视图列表）。
3. **照常发一条消息**：模型仍然选 **ClinePass** 里的任意一个 —— **不用切换服务商，也不用重新填 key**。
4. **看结果**：右侧工作面板点「新建」→ 选 **ClinePass 状态**（等价命令：`ClinePass: 在右侧显示状态`）。

表格里出现 `实际落点 fireworks` 这类值，就说明在记录了。

> 想看更多细节（逐条日志、勾选模型、上游探测与锚定）：命令面板跑 **`ClinePass: 打开上游面板`**。

---

## 你会在哪看到什么

**右侧「ClinePass 状态」视图**（窄栏，每 3 秒刷新）：

| 区块 | 内容 |
| --- | --- |
| 当前状态 | 观察端点是否在跑、开关、key 从哪来、启用/官方模型数、目录刷新时间、目标上游、最近错误 |
| 最近一次请求 | 模型、**实际落点**、网关钉住的上游、备选数、缓存命中、成本、累计次数、校验结论 |
| 最近请求 | 最近 20 条一行一条：时间 / 模型 / 落点 / 备选·缓存·成本 |
| 底部按钮 | 打开完整面板、清空记录 |

**完整面板**（独立窗口，`ClinePass: 打开上游面板`）：上面那些 + 逐条表格（快照里的最近 60 条）、启用哪些模型的勾选、
每个模型的默认思考强度、目标上游、**探测**与**锚定**（见下）。

---

## 看懂面板上的这些词

**一句话**：ClinePass 只是一个入口；同一个模型（比如 `cline-pass/kimi-k3`）背后有二十多家公司在真正跑它。
你每发一次请求，Cline 替你挑一家去算 —— 挑到哪家，平时看不见。这个插件就是把「挑到哪家」摊开给你看。

把它想成**同一个型号的货有很多发货仓**：下的单一样，从哪个仓发出、走哪条线、有没有备用的仓，平时都不告诉你。

| 词 | 什么意思 |
| --- | --- |
| **上游** | 真正跑模型的那家（一台/一群机器）。`deepseek`、`fireworks`、`baseten`、`alibaba`、`novita`、`gmicloud`、`togetherai`… 都是第三方推理服务商（租算力跑开源模型的平台）。 |
| **`openai-compatible-private`** | 网关自己的一条**私有通道**，不是公开厂商。闻到它通常伴随「成本 $0、备选 0」——不是出错。 |
| **实际落点** | 这一次请求最后是哪家算的。这是网关自己在响应里报的（`finalProvider`），不是插件猜的。 |
| **钉住** | 网关给这个会话**钉住**的那家。一般等于实际落点；两者不同，说明中途降级了或钉住的那家没接。 |
| **备选** | 除了落点之外，这个模型还能落到几家的**数量**。`0` = 没有退路，这家出问题这次就失败；`>0` = 还能降级到别家。 |
| **缓存命中** | 这次有多少输入 token 直接命中了对方的 prompt 缓存、没重新算。越大越省钱省时。`—` = 这条通道不报这个数。 |
| **成本** | 这一次的开销。取 `marketCost` → `inferenceCost` → `cost` 里第一个非零的。**只看 `cost` 会一直显示 $0**，因为私有通道把 `cost` 置 0。 |
| **校验：仅观察** | 你没指定目标上游，没得比。 |
| **校验：落点一致** | 你指定了目标，实际就落在它上面。 |
| **校验：网关忽略** | 你指定了目标，实际落在别家 —— **实测 Cline 网关不认这个字段**，属预期，不是你配错了。 |
| **校验：无元数据** | 响应里没有 `routing` 块（或响应过大没读到），判断不了。 |
| **次数** | 这个模型累计发出过多少次请求（本插件记的，重启后仍在）。 |
| **改写模型 id（锚定）** | 落点其实是 *(key, 模型 id)* 的函数：同一个 id 永远落在同一家。所以想换家只能把 id 换成同族、但落在目标上游的那个（面板每行右侧的下拉，点「探测」先试给你看）。**代价**：可能换到同族的另一个版本或量化。 |

面板表格的**列标题悬停**有同样的解释；表格下方还有一段「这些词是什么意思？」可以点开对照。

## 两个服务商，只有一个会记录

| 服务商 | 请求走哪 | 有记录吗 | 什么时候用 |
| --- | --- | --- | --- |
| **ClinePass** | 本机 `127.0.0.1:41892` → `api.cline.bot` | **有** | 日常就用这条 |
| **ClinePass Direct (备用)** | 直连 `api.cline.bot` | 没有 | 插件被停用/出问题时临时继续用 |

**为什么这样设计**：要看落点就必须站在请求路径上，所以被观察的那条服务商必须指向本机端点。
2.2.0 让「你原来一直在用的那条 **ClinePass**」变成被观察的那条 —— 它的 id 没变，所以你之前存的
key 原样继续有效。

> 2.1.x 及更早版本是反的：`ClinePass` 直连、另加一条 `ClinePass Upstream` 才记录。那条要**单独再填一次
> key**，于是绝大多数人一直是空的 —— 这是 2.2.0 要修的错。

---

## 常见问题

**表格一直是空的？**
按顺序排除：① 这条服务商发过消息了吗（发一条试试）；② 设置 → Providers → **ClinePass** 有没有 key
（没有会在对话里报“没有 API Key”）；③ 你选的是不是 **ClinePass Direct**（那条直连、不记录）；
④ 插件是不是被停用了（停用后 `ClinePass` 会 503）。

**key 填哪？**
设置 → Providers → **ClinePass**（就是你原来填的那一把）。插件设置里那个 `apiKey` 一般**不用填**，
它只在宿主没发 `Authorization` 头时兜底。插件读不到宿主里的 key（宿主明文规定不给插件），所以它只能
**透传宿主发来的头**。

**为什么表里没有“直连那条”的记录？**
`ClinePass Direct` 走的是宿主自己的直连，不经过插件，所以没法记录 —— 它存在的意义就是“插件不行时还能用”。

**会把模型藏起来吗？会不会拖慢？**
勾选模型后只影响 **ClinePass** 那一条（重启 PI 生效），`ClinePass Direct` 永远保留官方 15 个。
速度上多一次本机转发；另外插件会去掉 `accept-encoding` 以便读取网关返回的路由信息（体积换可观测性）。

**插件坏了/停用了怎么办？**
把模型切到 **ClinePass Direct (备用)** 即可继续用，只是不记录。停用插件时 `ClinePass` 会返回
`503 observer_disabled`，面板里也会提示。

---

## 上游观察

ClinePass 的同一个模型背后挂着二十多个上游，客户端看不见这一次落在谁身上；而网关在**每个响应**里都带回
自己的 `routing` 对象（`finalProvider`、`pinnedProvider`、`fallbacksAvailable`、`promptCacheHitTokens`、
成本），PI-Desktop 本身不解析它。插件因此在请求路径上把这个对象读出来。

| 列 | 说明 |
| --- | --- |
| 实际落点 | 本次真正服务的上游；绿=与目标一致，红=不一致 |
| 钉住 | 网关自己报告的会话钉选上游 |
| 备选 | `fallbacksAvailable` 数量：>0 表示上游不可用时仍会降级 |
| 缓存命中 | `promptCacheHitTokens`；该通道不返回就显示 `—` |
| 成本 | 优先 `marketCost`，其次 `inferenceCost`，最后 `cost`（私有通道 `cost` 恒为 0） |
| 校验 | 仅观察 / 落点一致 / 网关忽略 / 无元数据 |

日志按请求一条，视图里显示最近 20 条（快照 60 条，插件数据目录 200 条），不含请求内容。

### 钉住上游（providerOptions.gateway）

勾选目标上游（写进 `only`）+ 填「能力过滤 has」，再打开「钉住上游」开关，插件会在**请求体顶层**写入：

```json
"providerOptions": { "gateway": { "only": ["deepseek"], "has": ["vision", "implicit-caching"] } }
```

两条实测结论决定了必须这么写：

- **顶层的 `provider.only` 会被 Cline 丢掉**。所以 2.2.x 及更早那一版看起来"网关忽略客户端路由"，其实是字段位置错了；`allow_fallbacks` 网关根本不认。
- **只写 `only` 在不少账号上不生效**：服务端给虚拟模型配的兜底会盖过它，补上 `has`（能力过滤）才稳定。

`has` 可填 `reasoning` / `tool-use` / `vision` / `implicit-caching` / `structured-output`，任选其一即可。

判断有没有真的钉住，看响应里的 `provider_metadata.gateway.routing.finalProvider`（就是面板的「实际落点」），
**不要**看转发给客户端的顶层 `model` —— 它恒为 `vmc/...-fallbacks`，钉没钉住都一样。缓存命中数能被 64 整除
（面板缓存列后面那个「64」小标记）也是一条官渠指纹。

模型行末尾的「候选」按钮可以**免费**问网关「这个模型有几家上游可选」：插件发一个指定不存在上游的请求，
网关会在报错里把清单吐回来，不产生 token。要是目标上游不在清单里，这个账号本来就钉不住。

来龙去脉与对照实验：[docs/linuxdo-3064863-deepseek-pin](docs/linuxdo-3064863-deepseek-pin/README.md)。

### 锚定上游（只能靠改写模型 id）

实测两条硬事实：① `clientSessionId` 由 API Key 决定，body 里的 `sessionId` 或 `x-session-id` 头一律被忽略；
② 落点是 **(key, 模型 id)** 的函数，同一个 id 永远落在同一家，换 id 才换家。

所以锚定的做法是：**探测同族 id → 选一个落在目标上游的 id → 插件转发时改写 `model` 字段**。面板每行右侧
第二个下拉就是它（「原样转发」= 不改写），旁边的**探测**按钮会试跑几个同族 id 并列出各自落点（每次探测
产生几次真实调用，约 $0.00003/次）。结果分**可锚定**与**仅备选**（只在主选失败时降级使用，客户端指定不了）。

代价要清楚：**id 变了，实际服务的模型变体可能也变**（同族，但可能是不同版本或量化）。想零风险就把下拉
留在「原样转发」，只当观察器用。

### 启用哪些模型 / 默认思考强度

面板里的勾选会写进插件设置，并**改写插件安装目录里的 `manifest.json`**，把 `clinepass` 这一行的模型表缩成
你勾选的那批：

| 层 | 谁控制 | 什么时候生效 |
| --- | --- | --- |
| 列表显示 | PI —— 启动时按 `manifest.json` 写进服务商行 | **重启 PI 之后** |
| 是否可用 | 本插件（白名单） | 保存即生效，未勾选的模型一律 `404 model_not_enabled` |

被改写的是**插件安装副本**里的 `manifest.json`（用 `node scripts/sync-clinepass.mjs` 可恢复成官方 15 个）。
如果你是用「Install from folder」直接选本目录安装的，那份副本就是本目录的文件，同样会被改写。
面板上的「全选官方」可一键勾回。

---

## 模型

请求里的 `model` 用完整 slug。Claude **不属于** ClinePass（它在 `anthropic/*` 下按量付费）。

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

这些数字都取自 **Cline 官方目录**：`sdk/packages/llms/src/catalog/catalog.generated.ts` 的 `"cline-pass"`
块（`contextWindow`、`maxTokens`、`capabilities`、`reasoningOptions`）、`cline-recommended.generated.ts`
的 `clinePass` 列表，并用实时端点 `GET /api/v1/ai/cline/recommended-models` 交叉核对。

**两个长度都能自己改**：设置 → Providers → ClinePass 里每个模型行都有上下文窗口与最大输出字段，默认跟随
公布值（`contextWindowSource: "catalog"`），你编辑后变成你的值（`"user"`）。真实上限仍在 Cline 一侧，
调高于公布值不会真的多出上下文。

官方目录里**没有**这些 slug，所以不声明：`glm-5.2`、`kimi-k2.6`、`kimi-k2.7-code`、`deepseek-v4-flash`
（更早下线）、`mimo-v2.5`、`mimo-v2.5-pro`（2026-10 下线）。选了只会得到 model not found。

## 思考强度

只在 Cline 公布了档位阶梯时才声明档位，沿用官方档位名：

| 模型 | 档位 | 默认 |
| --- | --- | --- |
| GLM-5.3、GLM-5.3-Flash、Kimi K3、Kimi K3.1 Pro、DeepSeek V4.1 Flash、DeepSeek V4.1 Flash 1017 | `low` `high` `max` | `high` |
| DeepSeek V4 Pro | `high` `xhigh` | `high` |
| MiniMax-M3.1-Flash | `low` `medium` `high` `xhigh` `max` | `medium` |
| Muse Spark 1.3 Contributor | `minimal` `low` `medium` `high` `xhigh` `max` | `medium` |
| Qwen 3.8 Max | `low` `medium` `xhigh` | `medium` |
| MiMo-V2.6-Flash、MiMo-V2.6-Pro、MiniMax-M3、Qwen3.7 Max、Qwen3.7 Plus | —（只有开/关） | — |

1. **不声明 `off`**：宿主能声明 `off`，其含义正是「什么都不发」；但 Cline 的「不思考」是档位 `none`，
   由它的客户端**明确发送该值**。两者对网关不是同一请求，所以既不声明 `off` 也不声明 `none`（后者不是
   宿主合法档位，会被静默丢弃）。代价：`deepseek-v4-pro`、`deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017`、
   `kimi-k3`、`kimi-k3.1-pro` 这五个无法从 PI-Desktop 进入「不思考」。
2. **只有开关的模型不给档位**：`thinkingLevels` 表达不了开关，就不编造档位；它们照样会思考，只是不发
   `reasoning_effort`。
3. **既有开关又有阶梯**的只有 `qwen3.8-max`（`toggle` + `low`/`medium`/`xhigh` + `budget_tokens`），
   按阶梯声明。

「默认」列是本地选择；官方不公布默认档。**面板里可以给每个模型另选默认档**，保存后写进 `clinepass` 的声明，
重启 PI 生效。

## 权限与隐私

- 权限：`provider.register`、`ui.panel`、`ui.view`、`background.service`
- 出站只有一处：`api.cline.bot`（转发请求、拉模型目录、探测上游）
- 落盘只有插件数据目录：`routing-state.json`（每模型最近一次路由结果 + 最近 200 条日志，不含请求内容与凭据）
- key 默认不落插件盘：转发直接用宿主发来的 `Authorization`；只有你手动填了插件设置里的 `apiKey` 才会
  以 DPAPI 密文（Windows）或明文（其它平台，会提示）保存
- 插件进程不是操作系统级沙箱（宿主只隔离 host API），只装你信任的插件

## 开发

```
main.js                        回环转发 + routing 解析 + 面板通道 + 声明改写
renderer/                      共享管道（shared.js）+ 完整面板（index/panel.*）+ 右侧状态视图（view.*）
manifest.json                  两个 provider + 面板/视图/命令/服务/设置
scripts/sync-clinepass.mjs     从 Cline 官方目录同步两个 provider 的模型表
scripts/test-plugin.mjs        43 项自测（端点、通道、解析、两个页面真实 render、同步脚本按 id 改写）
dist/                          打包产物（store-only zip，扩展名 .piplug）
```

```
node scripts/sync-clinepass.mjs --check   # 只报告漂移
node scripts/sync-clinepass.mjs           # 改写 manifest.json（两个 provider）
node scripts/test-plugin.mjs              # 跑自测（会给副本换端口，避免撞上运行中的 PI）
```

打包含 `PluginPack`（store-only zip），不要用 `zip`/`tar`。

## 许可

本仓库未附许可文件。上游观察部分来自
[moyunliuyin/pi-desktop-cline-upstream](https://github.com/moyunliuyin/pi-desktop-cline-upstream)（MIT），
许可原文见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
