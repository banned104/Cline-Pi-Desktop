# 更新说明

## 2.2.2 — 把上一轮没修的重构补上

审查报告里我列为「后续」的那几条，这轮全部做完，行为不变、靠测试守住：

- **两个渲染页的重复代码合并**：新增 `renderer/shared.js`（classic script，不能用 ES module ——
  沙箱 `file://` 页面被 CORS 挡），收纳 bridge/invoke/readSettings、`snapshotOf`、
  `splitList`、`fmtCount`/`fmtCost`/`fmtClock`/`fmtStamp`，以及落点判定的 `verdictClass`
  与 `verdictTone`。`panel.js`、`view.js` 改为解构使用，两份各约 70 行的复制消失。
  两个 HTML 都先加载 `shared.js`；测试新增「加载顺序」断言与该模块的 smoke 运行。
- **`main.js` 三处重复的 JSON 设置解析 → `readJsonSetting(key)`**，两处重复的逗号/空格拆分 →
  `splitSettingList(value)`。
- **「档位→默认档」只保留一处**：新增 `resolveDefaultLevel(meta, levels, want)`，面板数据与
  发布声明共用。顺带修掉 `publishModels` 在「官方没有阶梯」时**凭空塞 `off`** 的行为
  ——那会声明一个文档明确说不声明、宿主也表达不了的档位；现在无阶梯就只写 id/名字/长度/图片。
- **同步脚本去重**：`fetchText` 那种「返回字符串或对象」的联合返回拆成 `fetchJson` +
  `decodeContentsPayload`；两段字符串感知的括号遍历合成 `closingDelimiter(source, i, open, close)`；
  删掉永远只会抛错的 `--remote` 开关。测试新增两条：同步脚本按 id 命中两个 provider、
  只改写被点名的那一块并保留视图/权限。

**升级方式**：装 `pi.clinepass-2.2.2.piplug`，重启 PI。权限未变。


## 2.2.1 — 代码审查发现的问题

2.2.0 之后对 `4704737..HEAD` 做了一次双轴代码审查（标准 / 规格分开跑）。以下是被证实并修掉的：

- **状态视图「最近一次请求」的模型名是空白**：`recordResult` 写的条目里没有 `model`，
  视图却按 `entry.model` 渲染；而测试夹具自己补了这个字段，所以冒烟测试看不出来。
  现在条目带上 `model`，视图再用 map 的 key 兜底；夹具不再补该字段，并新增一条断言
  「必须渲染出模型名」。
- **保存确认与探测失败提示会被立刻抹掉**：`refresh()` 会重建整块提示，写进 `el.hint`
  的一句话活不过一次渲染。改成 `flash` 机制（面板与视图都有）。
- **长回答记不到落点**：原来保留响应的**开头** 8 MB，而网关的 `routing` 块在**末尾**，
  任何超过 8 MB 的响应都会丢掉它。改成保留末尾 8 MB（环形修剪，不重复拷贝）。
- **网关返回 5xx 时 `lastError` 被清空**：只有 2xx 才清。
- **面板目录提示又说「还没有可用的 key」**：插件读不到宿主的 key，这句不成立，改成
  「还没拿到 key（发一条消息后会自动带上宿主的 key 再拉）」。
- **删掉 `readState` 面板通道**：没有渲染页在用，而且它会回传明文 `apiKey`。
- **`hydrateKey` 不再阻塞 `onLoad`**：解封要起 PowerShell（最多 20 秒），会把回环端点的
  启动拖后，期间的请求直接失败。
- **README**：完整面板的表格是快照里的 60 条（不是 200）；并写明用「Install from folder」
  安装时，被插件改写的那份 `manifest.json` 就是本目录的文件，可用同步脚本恢复。

**升级方式**：装 `pi.clinepass-2.2.1.piplug`，重启 PI。权限未变。


## 2.2.0 — 修正「面板永远空着」的设计错误

2.0–2.1 的设计是**反的**：`ClinePass` 直连 `api.cline.bot`（不经过插件，所以永远没有数据），
另加一条 `ClinePass Upstream` 才记录 —— 但那条要**单独再填一次 key**，而且还要手动把模型切过去。
结果就是：面板和状态视图一直是空的。这不是 bug，是设计错。

**本版把两条服务商的位置对调**：

| 服务商 | 现在 | 说明 |
| --- | --- | --- |
| `clinepass`（名字仍是 ClinePass） | `http://127.0.0.1:41892/v1` | 被观察。**id 没变**，所以你原来存的 key 继续有效 |
| `clinepass-direct`（新） | `https://api.cline.bot/api/v1` | 直连备用，不记录；插件停用或出问题时用它 |

升级后：重启 PI → 照常用 ClinePass 发一条消息 → 落点就出现在视图里。**不用切服务商，不用重填 key。**

**同时修的**

- 空状态文案不再谎报「没有 API Key」。插件读不到宿主里的 key，之前那句是错的；现在改成
  「还没有请求经过 + 如果报错就去填 key」的可操作提示（面板与视图都改了）。
- 面板/视图里指向旧服务商名（`ClinePass Upstream`）的文案全部更新。
- README 重写：开头是「30 秒用起来」四步 + 常见问题，不再从架构讲起。
- 自测扩到 38 项：新增「`clinepass` 必须是回环那条、`clinepass-direct` 必须是直连那条」的角色断言，
  防止这次的对调被后续改动再翻回去。

**升级方式**：装 `pi.clinepass-2.2.0.piplug`。权限没变，不用重新授权；**但要重启 PI**，
因为服务商行的 baseUrl 只能在启动时重建。


## 2.1.1 — 修复状态视图读不出来

2.1.0 的状态视图打开后只显示「读取失败」加一行 `.for is not iterable`，什么都看不到。
原因在 `renderer/view.js` 的 `renderFacts()`：`factRow()` 返回的是**一对** `[dt, dd]`，
却被写成 `for (const [dt, dd] of factRow(...))`，于是它去解构一个 HTML 元素并抛
`TypeError`，整块「当前状态」渲染中断，页面只剩错误提示。

- 改成 `pushFact(frag, 标题, 值)` 直接往文档片段里塞 `<dt>/<dd>`，不再有那层错误的迭代。
- 顺带补上防回归：测试里加了**渲染冒烟测试** —— 用真实快照跑 `view.js` 与 `panel.js` 的
  `render()`，抛错或出现「读取失败」即失败。之前只检查「能解析 + 元素 id 对得上」，
  所以这个运行时错误溜了过去。
- 测试自测端口改为 41899：PI 运行时会占用插件的 41892。
- 这套检查进了仓库：`node scripts/test-plugin.mjs`（36 项，含 6 个渲染场景）。

升级方式：装 `pi.clinepass-2.1.1.piplug`（权限没变，不用重新授权）。

## 2.1.0 — 右侧状态面板

除了独立窗口的完整面板，新增一个**停靠在 PI-Desktop 右侧工作面板里的状态视图**
（`contributes.views`，需要 `ui.view` 权限）：

- 命令「ClinePass: 在右侧显示状态」打开它，也可以从右侧工作面板的插件视图菜单进入。
- 内容是同一份快照的紧凑版：当前状态（端点是否在跑、开关、Key 来源、模型与目录、目标上游、
  最近错误）、最近一次请求（落点 / 钉住 / 备选 / 缓存命中 / 成本 / 次数）、最近 20 条请求。
- 底部按钮：打开完整面板、清空记录。
- 视图是只读的；勾选、探测与保存仍然只在完整面板里做。

**权限**：新增 `ui.view`，升级后宿主会要求重新授权。

**其它**：快照里补了 `listening` 与 `lastError`，状态视图据此显示端点是否在跑；
清单里声明的命令与插件注册的处理函数现在一一对应（新增的 `clinepass.status.reveal`
一开始漏了处理函数，一并补上）。

## 2.0.0 — 融入上游观察（Cline Upstream）

把 [moyunliuyin/pi-desktop-cline-upstream](https://github.com/moyunliuyin/pi-desktop-cline-upstream)
的能力并进本插件：多一个服务商 **ClinePass Upstream**（`http://127.0.0.1:41892/v1`），
走它就能看见每个请求真实落在哪个上游。

**新增**

- 第二个服务商 `clinepass-upstream`：同样 15 个 `cline-pass/*` 模型，转发到 `api.cline.bot`，
  并读取网关在每个响应里返回的 `routing` 元数据。
- 面板（命令「ClinePass: 打开上游面板」）：逐条请求的实际落点、钉住、备选数、缓存命中、成本。
- 上游探测与锚定：探测同族 id 各自的落点，选定后由插件改写 `model` 字段。
- 启用哪些模型（白名单，未勾选一律 `404 model_not_enabled`）+ 每个模型的默认思考强度。
- 可选：把 key 也填进插件设置（Windows DPAPI 加密）。**通常不需要**——转发时直接用宿主
  为该服务商行发送的 `Authorization` 头。

**权限**

- 新增 `ui.panel`、`background.service`；升级后宿主会要求重新授权。

**相对上游插件的改动**

- 模型清单不再内置，改读 `manifest.json`（由同步脚本从 Cline 官方目录生成）。
- 服务商 id 用 `clinepass-upstream`、端口用 `127.0.0.1:41892`，避开原插件的 41891，两者可共存。
- `enabled` 开关现在真的会拒绝转发（`503 observer_disabled`）。
- 去掉无效的 `/v1/responses` 路由，以及未认证即可写设置的 `__settings` 接口。
- 同步脚本改为按 provider id 定位，两个 provider 一起同步。

**说明**

- 直连的 `ClinePass` 服务商不受影响：官方 15 个模型、key 仍在宿主安全存储里。
- 面板改写的是**安装副本**的 `manifest.json`；重装会把那一行恢复成官方 15 个。

## 1.3.0 — 对齐 Cline 当前的 ClinePass 目录

Cline 的订阅模型清单更新了，本版把插件声明的模型同步到官方目录（15 个模型）。

**新增**

| 模型 | Model ID |
| --- | --- |
| Kimi K3.1 Pro | `cline-pass/kimi-k3.1-pro` |
| MiniMax-M3.1-Flash | `cline-pass/minimax-m3.1-flash` |
| DeepSeek V4.1 Flash 1017 | `cline-pass/deepseek-v4.1-flash-1017` |

**下线**（官方目录已移除，选了只会得到 model not found）

| 模型 | Model ID |
| --- | --- |
| MiMo-V2.5 | `cline-pass/mimo-v2.5` |
| MiMo-V2.5-Pro | `cline-pass/mimo-v2.5-pro` |

**修正**

- Qwen 3.8 Max：窗口 128,000 → 262,144，输出上限 8,192 → 128,000，现在支持图片，
  并新增 `low` / `medium` / `xhigh` 思考档位。

**升级方法**

1. 设置 → 插件 → 安装 `pi.clinepass-1.3.0.piplug`（或 Install from folder 选本目录）。
2. 重启 PI-Desktop，模型列表即刷新为 15 个。
3. 设置 → Providers → ClinePass 确认 API Key 仍在。

**其余不变**

端点仍是 `https://api.cline.bot/api/v1`，Key 仍以 `Authorization: Bearer` 发送；
思考档位仍只按官方公布的阶梯声明，`off` 依旧不声明。

包：`dist/pi.clinepass-1.3.0.piplug`（20,272 字节，
sha256 `e6f40f2365abde929abeead522e332bc0e1a33c8eae932fdaea9afb3f08e33e5`）。
