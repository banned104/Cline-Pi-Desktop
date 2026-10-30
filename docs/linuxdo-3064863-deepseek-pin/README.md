# 怎么把 `cline-pass/deepseek-v4.1-flash-1017` 钉到 DeepSeek 官方上游

> 来源：<https://linux.do/t/topic/3064863>（2026-10-23 发帖，143 层，2026-10-30 抓取）
> 原文全文与全部图片：[topic.md](topic.md)、[assets/](assets/)、[assets.index.md](assets.index.md)
> 帖子内指向的二级页面（GitHub 项目）阅读笔记：[sources.md](sources.md)
> 本文件是**我的整理与判断**，不是原帖内容；有争议或未经验证的地方我都标了。

---

## 1. 一句话结论

模型 ID 用**带 `-1017` 的那个**，并把这个结构放进**请求体顶层**：

```json
"providerOptions": {
  "gateway": {
    "only": ["deepseek"],
    "has": ["vision", "implicit-caching"]
  }
}
```

- `only`：只允许 `deepseek` 这一个上游（白名单）。
- `has`：要求上游必须**具备某个能力**（这里是"能看图"和"支持自动缓存"）。
- 两个一起写才有稳定效果——**只写 `only` 在不少账号上是无效的**，这点是整帖最关键的信息（原帖图 1、图 4 都在讲这件事）。

判定成功的唯一凭据是响应里的 `provider_metadata.gateway.routing.finalProvider` 等于 `deepseek`，**不是**响应顶层的 `model` 字段。

---

## 2. 三个硬性条件（缺一个就不生效）

### 2.1 模型 ID 必须是 `cline-pass/deepseek-v4.1-flash-1017`

- `#13`：「只能对 1017 有用，V4.1flash 不行」
- `#45`：加了参数没效果，是因为模型名写的是 `cline-pass/deepseek-v4.1-flash`，改成 `...-1017` 就好了
- `#105`：「必须是 1017 那个模型，没有 1017 的那个钉不住」
- 原帖图 2 的措辞：「目前仅验证完整 1017 入口」

`cline-pass/deepseek-v4.1-flash`（不带 1017）与 `-1017` 在网关里是**两个不同的虚拟模型**，背后的上游池不一样。

### 2.2 字段位置：`providerOptions.gateway`，不是顶层 `provider`

这条来自二级页面 [cline-pass-switcher 的 README](sources.md#1-cline-pass-switcher-node版)：Cline Pass 订阅模型在 Cline 网关后面其实有**两条路由管道**：

| 管道 | 真正的后端 | 识别特征 | 钉住写法 |
| --- | --- | --- | --- |
| 直连 direct | OpenRouter | 响应顶层带 `provider` 和真实 `model` | 顶层 `provider.only / order` |
| 规划器 planner | **Vercel AI Gateway** | 响应带 `provider_metadata.gateway.routing` | **`providerOptions.gateway.only / order / sort`** |

对**规划器**这条管道，Cline 会在转发时**丢掉**请求体顶层的 `provider.only` / `provider.order`——这正是"照着文档写 `provider.only` 却不生效"的原因；而嵌套的 `providerOptions.gateway` 会原样透传给 Vercel 网关。

DeepSeek V4.1 Flash **走的是规划器管道**（响应里能看到 `provider_metadata.gateway.routing`），所以必须用嵌套写法。

### 2.3 必须带 `has` 能力过滤（这才是"焚决"的新东西）

原帖图 4 的自述推导过程（我照抄结论，标注为作者推测）：

1. 先确认**单独写 `only` 在这把 key 上无效**——填入不存在的上游名照样成功，说明 `only` 根本没被当回事。
2. 查文档后发现：**服务端给虚拟模型配的兜底配置可以覆盖客户端的路由限制**（原帖说法）。
3. 于是加 `has` 能力过滤，行为立刻稳定改变：同一把 key、同一个模型，不加 `has` 落到私有上游，加了 `has` 落到 DeepSeek，填入不存在的上游名则直接报错。
4. 作者的推测（明确写了"没有服务端源码，不能断言"）：能力过滤先把当前那条私有落点排除掉，请求才进入"会执行 `only`"的那条路由。

原帖图 2 给了可选的 5 个能力值，**任选其一即可，作者称五个都实测有效**：

```
reasoning       思考/推理
tool-use        工具调用
vision          图片输入
implicit-caching 自动缓存（隐式 prompt cache）
structured-output 结构化输出
```

> 注意：图 4 里另有一句"`only` 是硬约束，官方渠道没有可用节点会直接 4xx/5xx，绝不静默降级"，和作者自己"单独 `only` 无效"的实测**互相矛盾**。我的判断：`only` 只在请求已经进入"会执行 `only` 的那条路由"时才是硬约束；在那之前它可能被虚拟模型的兜底配置盖掉。所以两条一起写。

---

## 3. 可直接复制的请求

请求地址：`https://api.cline.bot/api/v1/chat/completions`（OpenAI 兼容）

最小 curl：

```bash
curl https://api.cline.bot/api/v1/chat/completions \
  -H "Authorization: Bearer $CLINE_PASS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cline-pass/deepseek-v4.1-flash-1017",
    "messages": [{ "role": "user", "content": "只回复 OK" }],
    "stream": true,
    "providerOptions": {
      "gateway": { "only": ["deepseek"], "has": ["vision", "implicit-caching"] }
    }
  }'
```

Python OpenAI SDK——注意 **`providerOptions` 要放在 `extra_body` 里**（SDK 不认这个字段，必须原样塞进 HTTP 体）：

```python
import openai
client = openai.OpenAI(api_key=KEY, base_url="https://api.cline.bot/api/v1")
client.chat.completions.create(
    model="cline-pass/deepseek-v4.1-flash-1017",
    messages=[{"role": "user", "content": "只回复 OK"}],
    extra_body={
        "providerOptions": {
            "gateway": {"only": ["deepseek"], "has": ["vision", "implicit-caching"]}
        }
    },
)
```

要求：顶层 `providerOptions` 必须**在 HTTP 请求体顶层**。任何中间层（中转、代理、客户端插件）只要把不认识的字段吃掉，就不会生效（图 4 明说）。

---

## 4. 怎么确认真的钉住了

响应顶层 `model` 字段**永远不可信**：不管你钉没钉住，它都只是原样回显请求里的包装名，通常显示成 `vmc/...-fallbacks`（`#104`、图 5）。据此判断会误判。

按可靠性从高到低看这几处（全部来自 `#104` 的长图）：

| # | 看什么 | 钉住（官渠） | 没钉住（私有/备援池） |
| --- | --- | --- | --- |
| 1 | `provider_metadata.gateway.routing.finalProvider` | `deepseek` | 第三方算力商名，或 `openai-compatible-private` |
| 2 | `gateway.routing.canonicalSlug` | `deepseek/deepseek-v4.1-flash-1017` | `private/...` |
| 3 | `provider_metadata` 的顶层 key | 含 `deepseek`，带官方 `systemFingerprint` | `openai-compatible-private` |
| 4 | `cached_tokens`（缓存命中） | **64 的整数倍**（DeepSeek 官方 prompt cache 按 64 token 对齐） | 一般对不齐 |

第 4 条是"从协议层区分官渠和私有池"的硬特征，很有用：私有池基本不满足 64 对齐。

**反向对照实验**（原帖推荐的验伪方式，图 4）：

```jsonc
{ "providerOptions": { "gateway": { "only": ["not-a-real-provider"], "has": ["reasoning"] } } }
```

必须报"没有匹配上游"之类的错、不能正常生成。如果它**照样成功**，说明你的 `only` 根本没被网关采纳——要么字段位置错了（写成顶层 `provider.only`），要么中间层把它吞了。

另外：流式请求即使 HTTP 200，也可能在 SSE 里回错误；要找流**尾部**的元数据块，不能只看第一包。

---

## 5. 各个客户端往哪里塞这两个字段

不同工具入口不同，但最终 HTTP 体必须一样。原帖里被验证过的：

| 客户端 | 入口 | 说明 |
| --- | --- | --- |
| Magpie | 装 `Param Override` 插件（就是 new-api 的覆写功能，Magpie 里当插件/中间件） | `#26`、`#122` 给了完整 JSON；`#81` 说同一份配置在 Magpie 里钉不住、在 CPA 里可以 |
| new-api | 渠道的"参数覆写 / 覆写请求体" | `#57` 给了 ops 数组写法（`path: providerOptions.gateway.only`、`has`，还能顺手设 `reasoning_effort`） |
| axonhub | 渠道"覆盖请求体" | `#89` 截图：同时设 `providerOptions.gateway.only`、`.order`、`.has`，用 Go 模板条件 `{{eq .Model "cline-pass/deepseek-v4.1-flash-1017"}}` 只对这一个模型生效 |
| ZCode | 模型供应商 → 编辑模型配置 → 高级设置 → 推理参数映射 | `#128`，用 `reasoningLevel` 条件拼 `thinking` + `providerOptions`；作者自己说看不到 finalProvider，"心理安慰下" |
| ClinePassBridge / CPA | 额外请求体 | `#29`、`#54`、`#64` |
| cline-pass-switcher | 控制台勾渠道"严格钉住" | `#76`、`#92` 两个开源项目直接代劳 |
| 自己写代码 | 请求体顶层 / Python SDK 的 `extra_body` | `#26`、图 4 |

`#29` 有个细节：请求体里 `gateway` 也可以直接写成顶层对象（`{"gateway": {"only": ...}}`）——那是下游 Pi 里配的，不是所有工具都支持，**标准写法还是 `providerOptions.gateway`**。

---

## 6. 为什么你会失败（排障清单，按出现频率排）

1. **只写了 `only`，没写 `has`** —— 有些账号的虚拟模型兜底会盖掉 `only`。补上 `has` 再试（图 1、图 4）。
2. **模型名没带 `-1017`** —— `#45`、`#105`。
3. **字段放在了顶层 `provider.only`** —— 被 Cline 丢弃（见 §2.2）。
4. **中转/客户端吃掉了扩展字段** —— Magpie 这类工具要看请求详情里有没有真的发出去（`#47`、`#87`）。
5. **账号"体质"问题** —— `#52`：「我有个账号也钉不住，在 CPA 中用 clinepassbridge 查看后，上游只有一个托管方，没有候选列表」；`#108` 同理。只有一个托管商的号本来就没得选。
6. **2026-10-29 之后 Cline 上线了"降级池"** —— `#141`「焚诀也失效了」、`#142`「全是降级池」、`#144`「这个降级池是昨天 ClinePassBridge 更新刚加的，合了一个佬的 PR」、`#146`「cline 官方更新了」。`#134` 当天仍说能钉住。**这一招不是永久的**。
7. **判定位置错了** —— 你看的是响应顶层 `model` 或客户端的当前渠道列，不是 `finalProvider`（`#85`、`#104`）。

---

## 7. 副作用与实测数字（供对照）

- **计费**：原帖图 1 说账单 `creditsUsed: 0`、Credits 余额不变，即仍走订阅套餐；`#118` 则说自己那边改成走 API 积分、余额用完就失败。两个现象都存在，取决于账号/时间。
- **吞吐（tps）**：官方约 200–300（`#124` 深夜早上 300，11 点掉到 30）；`vmc` 私有约 130；降级池约 60–80 甚至 7–80（`#116`、`#144`）。
- **质量**：`#144` 说降级池"弱智一点"，同一道数学题慢 60%；`#136` 说钉住后模型自称 Claude、tps 不到 100 —— 说明**光看"钉住"两个字不够，模型本身也可能被换掉**。
- **缓存**：官渠缓存命中高、省额度（`#73`、`#134`）。

---

## 8. 名词解释（给完全不懂的人）

| 词 | 意思 |
| --- | --- |
| Cline Pass | Cline 出的包月套餐，用一把 `sk_` 开头的 key 调 Cline 的网关 |
| 上游 / 提供商 | 真正跑模型的算力方。同一个 Cline Pass 模型背后可能挂着好几家（DeepSeek 官方、Together、Fireworks、某个私有池…） |
| 钉住 / 钉死 | 强制让网关只用**指定的那一家**上游，不让它自动换 |
| 路由 / 管道 | Cline 网关内部决定"这条请求交给谁"的通道。V4.1 Flash 走的是"规划器"管道（底层是 Vercel AI Gateway） |
| `only` | 白名单：只许这些上游 |
| `has` | 能力过滤：要求上游必须具备某种能力（能看图、能调工具、有缓存…） |
| `providerOptions` | 请求体里给"网关"看的扩展配置箱；和 `messages`（给模型看的话）是两回事，不是提示词 |
| `provider_metadata` | 响应里网关回写的"我实际怎么走"的记录，钉没钉住就看它 |
| `finalProvider` | 最终干活的那家上游。`deepseek` = 官方 |
| `canonicalSlug` | 最终模型的规范名，官渠是 `deepseek/deepseek-v4.1-flash-1017` |
| `vmc/...-fallbacks` | Cline 给"降级/备援池"起的虚拟模型名，响应顶层 `model` 永远是它，**不代表实际上游** |
| 降级池 | Cline 后来加的兜底池，官渠不可用时自动落到这里；质量与速度都差一档 |
| `cached_tokens` | 命中提示缓存的 token 数；DeepSeek 官方按 64 token 对齐，可当"官渠指纹" |
| `extra_body` | Python OpenAI SDK 的逃生门，用来自定义不认识的顶层字段 |

---

## 9. 这件事对本项目（`pi.clinepass`）的直接意义

当前 `main.js` 里的 `injectRouting()` 写的是**顶层** `payload.provider = { only, allow_fallbacks }`，并在注释里断言"网关忽略客户端路由字段"。**这个断言是错的**——忽略的只是顶层写法；`providerOptions.gateway` 会被透传。这是本次调研最值钱的一条。

据此可做的三件事（下一步会按这个顺序做）：

1. **改注入位置**：`injectRouting()` 改成写 `payload.providerOptions.gateway = { only: [...], has: [...] }`，并新增 `has` 设置项（默认 `["vision","implicit-caching"]`）。
2. **加"探测"命令**：`only: ["__probe__"]` 这种不存在的上游会让网关在路由层直接报错并列出**当前可用渠道清单**，零 token 成本（见 [sources.md](sources.md)）。
3. **面板判定升级**：面板已经在显示 `finalProvider`；再补 `canonicalSlug` 与 `cached_tokens % 64 === 0` 两条，就能一眼看出"真官渠 / 私有池 / 降级池"，而不是看那个永远骗人的顶层 `model`。

---

## 10. 时间线（证据链）

| 时间 | 事件 | 出处 |
| --- | --- | --- |
| 2026-10-23 | 楼主发帖，图 1 给出 `only` + `has` 的写法与对照实验 | `#1` |
| 同日 | 陆续反馈成功；`#13` 指出只对 `-1017` 有效 | `#9`–`#44` |
| 同日 | `#26`/`#29`/`#57`/`#89` 分别给出 Magpie / Pi / new-api / axonhub 的具体配置 | 见 §5 |
| 同日 | `#52`/`#108` 指出"没有候选渠道清单的账号钉不住" | `#52` |
| 2026-10-24 | `#88`–`#104` 明确判定标准：看 `provider_metadata.gateway.routing.finalProvider` | `#104` |
| 之后几天 | 大量"还能钉住"反馈，同时开始讨论限速 | `#123`–`#140` |
| 2026-10-29 | ClinePassBridge 更新加入"降级池"，大量账号失效 | `#141`–`#146` |

结论：**方法是 2026-10-23 那两天在两把 key 上实测有效的**，作者自己写的是"长期稳定性尚未确认"。看到这份文档时请先自己跑一遍 §4 的对照实验，再决定要不要依赖它。
