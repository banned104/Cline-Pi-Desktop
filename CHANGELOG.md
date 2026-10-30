# 更新说明

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
