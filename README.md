# Figma Local Bridge

一个开源的本地桥接工具，让 MCP 客户端通过经过配对的 Figma 开发插件读取和修改当前打开的设计文件。

> 本项目与 Figma 或 OpenAI 无隶属、授权或背书关系。Figma 是其各自权利人的商标。

[![CI](https://github.com/A1tolia/figma-local-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/A1tolia/figma-local-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**v1.0.5 更新**：六个 MCP 工具现在完整声明只读、破坏性、幂等性和开放世界风险提示；自动测试逐个通过真实 stdio MCP、HTTP broker 与模拟 Figma 插件完成往返，避免工具只被枚举但没有实际调用覆盖。

**v1.0.4 更新**：`figma_local_document` 现在返回描边、圆角和效果信息；`figma_local_apply` 新增 `effects` 写入，并校验 Figma 原生 `GLASS` 效果的光照、折射、深度、色散与半径参数。

**v1.0.3 更新**：增加安全区适配所需的固定/自动布局定位、伸缩、约束和滚动方向属性，并在文档读取结果中返回这些布局信息。

**v1.0.2 更新**：修订 Figma 主线程与界面之间的消息握手，处理文件名 undefined、连接后无结果的情况。原目录已更新，关闭并重新运行插件，再输入现有桥接配对码；无需停止现有桥接。界面应先显示“Figma 已就绪 · 文件名”，才能连接。若没有出现文件名，不要提交编辑操作。真实 Figma 执行效果仍待重新连接验证。

**v1.0.1 更新**：修复 Figma 报 `Invalid value for devAllowedDomains` 的问题。插件白名单和请求地址改用官方文档示例形式 `http://localhost:19429`，桥接同步接受该 Host。若使用本次交付的原始目录，文件已经更新：停止旧桥接后重新启动，重新导入 `figma/manifest.json` 并配对。若使用解压副本，用 v1.0.1 更新整个目录（保留你自己的 Figma 插件 ID），再重新运行安装脚本注册路径。

通过 **Codex → 本机桥接服务 → Figma 开发插件 → Plugin API**，创建和修改当前打开的 Figma 设计。运行代码不调用官方 Figma MCP、Figma REST API，也不需要个人访问令牌。Node.js 22+，无第三方运行依赖。

## 能力与边界

支持读取页面结构、选区、描边、圆角和效果；创建页面、Frame、矩形、椭圆、可编辑文字和组件；修改位置、尺寸、填色、描边、原生效果、文字、字体及基础自动布局；复制和删除普通节点；选择定位；导出 PNG / SVG。

**顶层文件仍需在 Figma 中手动新建，然后运行插件生成内容。** 插件不能后台打开任意云端文件、突破编辑权限或解除套餐页面数限制。本版本也没有图片上传、变量系统、组件变体和原型连线工具。

这是独立的操作通道，不是重置或破解官方 MCP 额度。它没有经过 Figma Community 发布审核，按本地开发插件安装。

## 1. 安装 Figma 端（需要 Figma 桌面应用）

1. 将整个目录放在一个长期保留的位置。
2. 在 Figma 打开一个你有编辑权限的文件，或者新建空白 Design 文件。
3. 打开 Plugins → Development → Import plugin from manifest，选择本目录的 `figma/manifest.json`。
4. 运行 **Figma Local Bridge**。

本包没有冒用其他插件的 Figma ID。如果 Figma 要求提供 `id`，先通过 Development → New plugin 创建你自己的插件，从它生成的 manifest 复制数字 ID，然后在本目录 PowerShell 中执行：

```powershell
.\Set-Figma-Id.ps1 -PluginId '你从Figma获得的数字ID'
```

重新导入本包的 manifest。菜单名称可能随 Figma 客户端语言变化。

## 2. 启动和配对

在本目录打开 PowerShell：

```powershell
.\Start-Bridge.ps1
```

保持终端窗口开启，将终端显示的 **Pairing code** 粘贴到 Figma 插件，点击“连接当前文件”。每次重启桥接服务配对码都会更换。

若系统的脚本执行策略阻止 `.ps1`，不用更改系统策略，直接执行等价命令：

```powershell
node .\server\broker.mjs
```

桥接仅绑定 IPv4 回环地址 `127.0.0.1:19429`；Figma 端通过 `http://localhost:19429` 访问，MCP 控制端继续通过 IP 访问。端口被占用时退出并提示，不会自动结束其他进程。首次连接若客户端要求本地网络权限，请为此连接授权；真实 Figma 客户端的本地网络限制仍需实机确认，优先使用桌面版。

## 3. 连接 Codex

当前这台电脑已完成注册，可直接打开新任务；如果移动目录或在另一台电脑使用，再执行下面的安装步骤。

在本目录运行一次：

```powershell
.\Install-Codex.ps1
```

该脚本通过 `codex mcp add` 注册名为 `figma-local-bridge` 的服务，指向当前目录中的源码。此后请保留目录位置；移动后重新运行脚本。不要同时启用同名打包插件和直接 MCP 配置，以免重复注册。

脚本受执行策略限制时，可直接运行：

```powershell
codex mcp add figma-local-bridge -- node "$PWD\server\mcp.mjs"
```

打开新的 Codex 任务，让它调用 `figma_local_status`。连接成功后会列出当前文件名及会话 ID。多个文件同时连接时，要选择正确的会话。

可复制给 Codex：

> 使用 figma-local-bridge，先读取连接状态和当前文件结构，再在当前页面创建一张 400×260 的卡片，标题是 Hello from Codex。使用可编辑文字，完成后读取节点并导出预览验证。

包内 `skills/figma-local-edit/SKILL.md` 提供使用规范。直接注册 MCP 不会自动安装该 Skill；工具本身已包含操作说明，可以要求 Codex 读取该文件。`.codex-plugin/plugin.json` 与 `.mcp.json` 作为后续插件分发结构保留，本版主要安装入口是上述脚本。

## 工具及调用示例

| 工具 | 用途 |
| --- | --- |
| `figma_local_status` | 列出连接文件会话 |
| `figma_local_document` | 读取页面、选区、节点树；深度最多 5 层、500 个节点 |
| `figma_local_apply` | 按顺序执行 1–100 个操作 |
| `figma_local_fonts` | 查询可用字体；最多返回 200 条 |
| `figma_local_export` | 导出单个节点为 PNG 或 SVG；大小有限制 |
| `figma_local_job` | 查询超时或未确认任务的状态 |

`figma_local_apply` 参数示例；sessionId 替换为状态工具返回的值，requestId 为每次新操作生成新的 UUID：

```json
{
  "sessionId": "连接状态中返回的会话ID",
  "requestId": "card-demo-001",
  "operations": [
    {"op":"create","type":"FRAME","ref":"card","props":{"name":"我的卡片","width":400,"height":260}},
    {"op":"create","type":"TEXT","parentId":"$card","ref":"title","props":{"characters":"Hello","fontSize":32,"x":24,"y":24}},
    {"op":"select","nodeIds":["$card"]}
  ]
}
```

操作种类：`create_page`（name）、`create`（type / props / parentId）、`update`（nodeId / props）、`clone`（nodeId / props）、`delete`（nodeId）、`select`（nodeIds）。创建和复制可提供 ref。批内通过 `$ref` 引用刚创建的节点；跨批次使用返回的真实节点 ID。

颜色使用 Figma 原生格式，如 `fills: [{"type":"SOLID","color":{"r":0.2,"g":0.4,"b":1}}]`。尺寸为画布像素，颜色通道为 0–1。字体示例为 `{"family":"Inter","style":"Bold"}`；先查询字体，再使用可用的 family/style。完整卡片操作见 `examples/card.json`。

原生玻璃示例：`effects: [{"type":"GLASS","visible":true,"radius":16,"refraction":0.25,"depth":41,"lightAngle":-45,"lightIntensity":0.8,"dispersion":0.16}]`。这是 Figma 效果面板中的玻璃效果，不是渐变填充。

支持的 props：name、x、y、width、height、fills、strokes、strokeWeight、cornerRadius、effects、opacity、visible、locked、rotation、characters、fontName、fontSize、textAlignHorizontal、textAutoResize、layoutMode、itemSpacing、paddingTop、paddingBottom、paddingLeft、paddingRight、primaryAxisSizingMode、counterAxisSizingMode、primaryAxisAlignItems、counterAxisAlignItems、clipsContent。具体属性是否适用于节点，由插件与 Figma API 检查。更新文字会先加载字体。

## 执行语义

- 批次不是事务：失败时停止，返回 completed / failedIndex / error。此前成功的修改保留，失败的 update 也可能部分生效；失败的 create 会清理新节点。需要时在 Figma 使用撤销。
- 同一个 requestId 的相同内容，在桥接运行期间最多入队一次；不同内容复用 ID 会拒绝。结果不明时查询任务，不能换 ID 盲目重试。
- 排队超过 30 秒的任务不会继续执行。已经发给插件的任务不会自动重发或宣称已取消；若插件关闭，可能一直显示 running。请核对画布再重启服务。
- MCP 等待约 25 秒后可能返回 pending；这不代表任务失败。桥接重启会清除会话、任务记录和去重记录。
- 单次启动最多记录 500 个任务；达到后先检查未确认操作，再重启并重新配对。最多同时连接 16 个插件会话。
- 删除页面/文档根节点被禁用，普通节点删除可用。插件窗口关闭后不再接收新操作。

## 数据与本机权限

控制端令牌保存在本目录 `.runtime/connection.json`，不提交、不打包、不分享；用户主动输入的配对码与控制端令牌分离。不要把此目录放在其他用户可读写的共享目录。插件不执行来自工具参数的 JavaScript，也不发送到第三方服务；通过 Codex 请求的文档内容会作为工具结果交给 Codex，按你使用的 Codex 服务设置处理。

## 验证

```powershell
node --test tests/*.test.mjs
```

自动测试覆盖 HTTP 鉴权、来源/Host 检查、重复请求、会话隔离、断开/过期、真实 stdio MCP 到本地 HTTP 的往返，以及模拟 Figma API 的编辑、字体加载、失败清理和读取上限。**模拟测试不等于真实 Figma 联调或云端写入成功。** 本次交付尚未完成真实 Figma 导入、画布效果和云端保存验证，见 `VERIFICATION.md`。

## 卸载

停止桥接终端（Ctrl+C），在 Codex 运行 `codex mcp remove figma-local-bridge`，在 Figma Development 中移除本地开发插件。卸载不会删除已经生成的设计节点。

## 参与贡献

欢迎提交问题和改进。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。本项目使用 [MIT License](LICENSE)。

## 官方依据

- [Figma Plugin API 概览](https://developers.figma.com/docs/plugins/)：在编辑器中读取和修改文件内容。
- [Plugin Manifest](https://developers.figma.com/docs/plugins/manifest/)：插件清单、Figma 分配的 ID 与开发网络白名单。
- [createPage](https://developers.figma.com/docs/plugins/api/properties/figma-createpage/)：创建的是文档内页面，仍受套餐限制。
- [loadFontAsync](https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/)：修改文字前加载字体。
- [Codex MCP 配置](https://developers.openai.com/codex/mcp)：注册本地 stdio MCP 服务。
