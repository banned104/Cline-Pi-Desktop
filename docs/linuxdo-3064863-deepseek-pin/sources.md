# 二级页面阅读记录

这里记录我从话题 <https://linux.do/t/topic/3064863> 里点出去的**二级页面**看了什么、抓了什么、结论是什么。主结论在 [README.md](README.md)。

## 抓取方式（可复现）

| 内容 | 方法 |
| --- | --- |
| 全帖 143 层文字 | 登录态下在页面里 `fetch('/t/3064863.json?print=true')`——Discourse 的 print 视图一次返回全部楼层，避免翻页漏楼 |
| 全部图片 | 把 `cdn3.ldstatic.com/optimized/.../<hash>_<n>_<w>x<h>.png` 换成 `.../original/.../<hash>.png` 拿原图，存到 `assets/`，命名 `p<楼层>-<序号>.<扩展名>` |
| 图片内容 | 逐张读图（原帖正文几乎全是贴图，纯文字只有几句话） |
| GitHub 项目的 README | 在页面里 `fetch('https://raw.githubusercontent.com/<owner>/<repo>/main/README.md')`（本机直连 raw.githubusercontent.com 无法解析，必须借浏览器的网络环境） |

未保存的东西（避免仓库变重）：原始 JSON（453 KB）、表情小图（已从正文过滤掉）。另有 2 张引用块头像留在 `assets/`（`p059-25.png`、`p142-67.png`），无害但不算内容。

---

## 1. cline-pass-switcher（Node 版）

- 仓库：<https://github.com/munmunjaklin458-afk/cline-pass-switcher>（`#76` 推荐）
- 发现路径：原帖里没有直接给这个链接，`#76` 的措辞是"倾向使用 cline-pass-switcher 的可以试试我的 fork"，链接挂在文字上
- 帖子里的 fork：<https://github.com/CCRcmcpe/cline-pass-switcher>（README 与上游完全一致，6165 字符，未见额外说明）
- 形态：零依赖 Node.js（≥18）本地/服务器代理 + 网页控制台，`node server.js` 直接跑，默认 `127.0.0.1:3123`
- 许可：MIT

**读到的关键机制（比原帖更清楚，也是 §2.2 的依据）：**

1. Cline Pass 订阅模型在 Cline 网关后面分成两条管道，钉住写法**完全不同**：
   - **直连 direct** → 后端是 **OpenRouter**；识别特征：响应顶层带 `provider` 和真实 `model`；钉住用**顶层 `provider.only / order`**
   - **规划器 planner** → 后端是 **Vercel AI Gateway**；识别特征：响应带 `provider_metadata.gateway.routing`；钉住用 **`providerOptions.gateway.only / order / sort`**
2. 对规划器管道，请求体顶层的 `provider.only/order` 会被 Cline 丢弃——「这也是官方 API 上"换上游不生效"的原因」，而嵌套的 `providerOptions.gateway` 会原样透传。
3. 作者实测表（2026-09）里还证明：`sort: "cost"` 生效；直连管道反过来只认顶层 `provider`，不认 `providerOptions.gateway`。
4. **上游枚举的三种手段**（很有用）：
   - 响应元数据回读：`canonicalSlug` / `fallbacksAvailable` / `finalProvider`
   - **假上游探测**（零 token）：带一个不存在的 `only: ["__probe__"]`，让网关在路由层报错并**列出精确的可用渠道清单**
   - OpenRouter 公开接口 `GET https://openrouter.ai/api/v1/models/{slug}/endpoints`（只对直连管道有意义）
5. 引用文档：<https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering>（Vercel AI Gateway 的 provider filtering / ordering）——**这就是 `only`/`sort`/`order` 的官方出处**，注意这份官方文档没写 `has`。

> 与本话题的差异：这个项目 README 停在 2026-09，说的是 glm-5.2/5.3-flash，**没有** `has` 能力过滤。`has` 是 2026-10-23 这个话题才拿出来的。

## 2. cline-pass-switcher-go（Go 版）

- 仓库：<https://github.com/Hxjcc/cline-pass-switcher-go>（`#92` 作者自己发）
- 形态：Go 单二进制 + 内嵌控制台，Docker Compose 一条命令；端口同样默认 `127.0.0.1:3123`
- 许可：MIT，README 里明确「感谢 munmunjaklin458-afk 开源的 cline-pass-switcher」——是同一思路的 Go 重写

**比 Node 版多出来的东西：**

1. **`/v1/responses` 协议**：在网关内把 Responses 转成 Chat Completions，支持工具调用、思考内容、Codex 远端上下文压缩、结构化输出校验。可以直接喂 Codex CLI（README 给了 `~/.codex/config.toml` 完整样例）。
2. **明确写了 `has` 能力过滤**：「按模型指定优先、排除渠道，可开启 `has` 能力过滤、读取供应商目录，并用同账号**正反对照**验证钉住」。
3. **对"钉不住"的解释**（比原帖准确）：「遇到单渠道或私有 Vercel 线路时，自动补测一组能力路由正反对照……目录候选不代表实际可用，是否能钉住以当前账号和条件的对照结果为准。」——这正是 `#52`「没有候选列表的号钉不住」背后的机制。
4. 会话粘性（同一会话固定上次成功的账号+渠道，命中上游缓存）、账号池（401/403/429 自动换号）、分发密钥带美元额度、Token 统计（北京时间日界）。
5. 响应头 `X-Cline-Account` / `X-Cline-Actual-Upstream` / `X-Cline-Attempts` 直接给出实际账号与上游。

## 3. dsh-cline-pass（DeepSeek Harness 插件）

- 仓库：<https://github.com/yhshzh/dsh-cline-pass>
- 发现路径：原帖里没有这个链接。我用站内搜索「钉死上游提供商」找到了**引用本话题的另一个话题**：<https://linux.do/t/topic/2902534>（69 层，标题带"【更新支持焚诀】"）
- 它的自述：填入 Cline Pass key → 拉取模型 → **探测所有可用上游渠道** → 钉住某一个或几个渠道（例如固定用 DeepSeek 官转的 dsv4.1f）；作者说"代码经验接近 0，几乎全部由 dsv4.1f 独立完成"
- 用途：如果要在 **DeepSeek Harness / dsh** 里钉，直接用这个插件；对 PI-Desktop 没有直接可复用的代码，但它证明了"探测 + 钉住 + 面板"这套产品形态是可行的、且社区有人做过

## 4. 只在文字里出现、我没有单独打开的东西

| 提及处 | 内容 | 为什么没打开 |
| --- | --- | --- |
| `#38` | <https://linux.do/t/topic/2981867>（优惠码集中帖） | 与"怎么钉住"无关，且帖子里已说明该帖的码全部失效 |
| `#26`/`#122` | Magpie 的 `Param Override` 插件 | 是 Magpie（另一个 Cline 客户端）的插件，配置内容原帖已全文贴出，见 README §5 |
| `#78`/`#144` | ClinePassBridge 0.4.0 的"降级池" | 是 CPA（Cline Proxy Adapter）生态的插件，不是我们要改的东西；只记录它的影响：2026-10-29 上线后大量账号从官渠变降级池 |
| 原帖顶部 | 「其他 9 个」引用话题列表 | 主题列表懒加载，DOM 里取不到稳定链接；已用站内搜索替代（见上一条） |

## 5. 我从二级页面里学到、但原帖没说的三条

1. **`only` 写在顶层是无效的**，这不是网关"忽略客户端路由"（我之前在插件注释里的判断），而是 Cline 只透传嵌套的 `providerOptions.gateway`。这条改变了本项目 `injectRouting()` 的实现方向。
2. **`__probe__` 假上游探测**：拿渠道清单不用花 token，只要造一个不存在的上游让网关报错。这是做"探测"功能的正确姿势。
3. **`has` 不是 Vercel 官方文档里的字段**（官方文档只有 `only`/`order`/`sort`）。所以 `has` 很可能是 Cline 侧自己加的能力路由条件；它为什么能让 `only` 生效，原帖作者也只能推测。**这属于未经验证的服务端行为，随时可能变。**
