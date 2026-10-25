# antigravity-browser

<p align="left">
  <a href="https://github.com/zhonggl951-prog/antigravity-browser"><img src="https://img.shields.io/github/stars/zhonggl951-prog/antigravity-browser?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square" alt="License"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome"></a>
  <img src="https://img.shields.io/badge/platform-Antigravity%20Plugin-blue.svg?style=flat-square" alt="Platform">
</p>

Google Antigravity 辅助面板（Aux Pane）内置网页浏览器与前端审查插件。支持网页浏览、DOM 元素点选审查、局部视觉快照生成与 Agent 联动。

## 功能

- **辅助面板浏览**：在 Antigravity 右侧 Aux Pane 内直接打开外部网站与本地 Web 开发服务，不抢占主工作区。
- **组件点选与修改（Inspect）**：开启检查模式后，鼠标悬停可高亮 DOM 元素；点击元素即可弹出输入框，提交后将 CSS 选择器、HTML 片段与视觉快照一键发送给对话中的 Agent。
- **本地应用 WebSocket 路由**：内置 WebSocket 拦截重定向逻辑，支持 R Shiny、Streamlit、Vite HMR 等本地响应式框架在代理下正常建立长连接并实时更新数据。
- **双浏览模式切换**：
  - `🛡️ Proxy` 穿透模式：通过 Node 后端代理并注入检查器脚本，支持全套 DOM 点选与快照功能。
  - `⚡ Direct` 直连模式：原生 iframe 嵌入，适合重型计算或大文件上传等无需审查的纯操作场景。
- **跨平台支持**：支持 macOS、Windows 10/11 与 Linux。Windows 环境下内置 `curl.exe` 代理兼容、盘符路径规范化与系统浏览器唤起回退。
- **安全防护**：默认拦截云厂商元数据端点（`169.254.169.254` 等），校验会话 ID 格式防止路径遍历，并限制响应与快照体积上限。

## 安装

将本仓库克隆至 Antigravity 的插件配置目录下：

### macOS / Linux

```bash
git clone https://github.com/zhonggl951-prog/antigravity-browser.git ~/.gemini/config/plugins/browser
```

### Windows (PowerShell)

```powershell
git clone https://github.com/zhonggl951-prog/antigravity-browser.git $env:USERPROFILE\.gemini\config\plugins\browser
```

克隆完成后，使用 `agy` 命令行工具验证插件完整性：

```bash
agy plugin validate ~/.gemini/config/plugins/browser
```

## 使用方法

在 Antigravity 对话中点击或输出以下 Sidecar 链接以打开侧边栏浏览器：

```markdown
[Web Browser](sidecar://browser/web_browser/ui.html)
```

1. **浏览页面**：在顶部地址栏输入外部网址（如 `https://github.com`）或本地服务地址（如 `http://127.0.0.1:7123`），按回车访问；
2. **审查组件**：点击工具栏的 `🎯` 按钮进入检查模式；
3. **选择元素**：鼠标移动到想要修改的页面区域，点击选定目标；
4. **提交给 Agent**：在弹出的卡片中输入修改要求，按 `Cmd/Ctrl + Enter` 发送。Agent 即可获取组件层级、代码片段与渲染快照并开始调整代码。

## 目录结构

```
antigravity-browser/
├── plugin.json               # Antigravity 插件配置清单
├── sidecars/
│   └── web_browser/
│       ├── sidecar.json      # Sidecar 启动规格与视图配置
│       ├── server.mjs        # 代理与后端服务（Node.js / sidecar_sdk）
│       ├── ui.html           # 辅助面板纯白前端界面
│       ├── inspector-runtime.js # DOM 检查、截屏与 WebSocket 拦截运行时
│       └── html2canvas.min.js   # 离线 Canvas 截屏库
├── LICENSE                   # MIT 开源许可
└── README.md                 # 项目说明文档
```

## 依赖说明

- **Node.js** (v18+)
- **curl**（macOS / Linux 自带；Windows 10 1803+ 及 Windows 11 已内置）
- [html2canvas](https://github.com/niklasvh/html2canvas) (MIT)

## 开源协议

[MIT License](LICENSE)
