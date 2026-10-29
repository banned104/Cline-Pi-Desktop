# 第三方组件与许可

本仓库包含来自下列第三方项目的代码，按原许可使用。

## moyunliuyin/pi-desktop-cline-upstream

- 来源：https://github.com/moyunliuyin/pi-desktop-cline-upstream （插件 `io.github.moyunliuyin.cline-upstream` v0.7.8）
- 许可：MIT
- 本仓库中使用其代码的位置：
  - `main.js` —— 回环转发端点、网关 `routing` 元数据解析、上游探测与模型 id 锚定、
    白名单转发拦截、DPAPI 加密存放 key、把结果经设置通道发布给面板、按选择改写自身
    `manifest.json` 的模型表
  - `renderer/` —— 面板（`index.html` / `panel.css` / `panel.js`）
- 本仓库做的改动：模型清单不再内置，改为读 `manifest.json`（由 `scripts/sync-clinepass.mjs`
  从 Cline 官方目录生成）；观察用的服务商 id 改为 `clinepass-upstream`、回环端口改为
  `127.0.0.1:41892`；转发时优先使用宿主为该服务商行发送的 `Authorization` 头（上游插件要求
  把 key 单独填进插件设置）；`enabled` 开关现在真的会拒绝转发；去掉无效的 `/v1/responses`
  路由与未认证的 `__settings` 写接口。

### MIT License

```
MIT License

Copyright (c) 2026 moyunliuyin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
