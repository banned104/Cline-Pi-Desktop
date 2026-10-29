# 更新说明

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
