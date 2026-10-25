<div align="center">

# antigravity-browser

**Google Antigravity 辅助面板内置网页浏览器与 DOM 视觉审查插件**

<!-- 徽章栏 -->
<p align="center">
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/releases"><img src="https://img.shields.io/github/v/release/zhonggl951-prog/antigravity-browser?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/actions/workflows/validate.yml"><img src="https://img.shields.io/github/actions/workflow/status/zhonggl951-prog/antigravity-browser/validate.yml?branch=main&style=flat-square" alt="Build Status"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser"><img src="https://img.shields.io/github/stars/zhonggl951-prog/antigravity-browser?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square" alt="License"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome"></a>
  <img src="https://img.shields.io/badge/platform-Antigravity%20Plugin-blue.svg?style=flat-square" alt="Platform">
</p>

<!-- 语言切换 -->
<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

</div>

---

`antigravity-browser` 是专为 Google Antigravity 辅助面板（Aux Pane）设计的内置浏览器、前端元件审查与控制台报错自动捕获插件。支持直接在 IDE 右侧浏览外部文档与本地 Web 服务，点击页面任意 DOM 元件即可生成 CSS 选择器、HTML 片段及渲染快照，实时拦截 JS 运行时异常与报错堆栈，直接将修改诉求一键派发给对话中的 AI Agent。

<p align="center">
  <img src="assets/preview.svg" alt="Antigravity Browser 界面预览" width="100%">
</p>

## 核心特性

- **辅助面板内置浏览（Aux Pane）**：运行在 Antigravity 右侧辅助面板中，浏览文档或本地页面无需切出窗口，亦不占用主代码编辑区。
- **元件点选审查与提问（Inspect）**：鼠标悬停自动高亮页面 DOM 元件。点击选定后弹出轻量输入框，将 CSS 选择器、HTML 片段与 Canvas 局部渲染快照打包成结构化提示词发送给 Agent。
- **JS 控制台报错自动捕获（🐞）**：自动拦截未捕获异常（`window.onerror`）、Promise 拒绝与 `console.error` 日志。顶部工具栏红标显示错误频次，展开控制台抽屉即可查看报错位置与完整堆栈，并提供 **Send to Agent 🚀** 按钮一键派发修 Bug。
- **本地响应式应用长连接路由**：内置 WebSocket 目标拦截重定向，支持 R Shiny、Streamlit、Jupyter、Vite HMR 等本地响应式框架在代理下正常建立长连接，杜绝频繁掉线。
- **双运行模式**：
  - `🛡️ Proxy` 穿透模式：通过 Node 后端代理并注入检查器脚本，支持全套 DOM 点选、控制台捕获与视觉快照功能。
  - `⚡ Direct` 直连模式：原生 iframe 嵌入，适合高吞吐计算、纯看报表或大文件上传等无需审查的场景。
- **跨平台兼容**：在 macOS、Windows 10/11 与 Linux 上均可开箱即用。Windows 环境下内置 `curl.exe` 命令调用、盘符规范化与系统浏览器唤起回退。
- **安全边界防护**：默认拦截云厂商元数据端点（如 `169.254.169.254`），强校验会话 ID 格式防止路径遍历，并限制响应体积上限。

## 适用场景

- **点选式界面修改**：在本地运行的 Web 服务中点击想要修改的按钮、表格或卡片，直接描述修改诉求，Agent 即可精准定位对应组件代码开始调整。
- **前端 Bug 秒级排查**：本地应用发生脚本崩溃或组件未渲染时，无需打开笨重的外部 DevTools，直接一键把错误堆栈打包投喂给 Agent 定位源码修复。
- **科研与数据分析工具实时预览**：在侧边栏并排运行 R Shiny 单细胞分析仪表盘、Streamlit 算法工具或 Gradio 模型界面。
- **API 与文档边查边写**：在右侧快速查阅 MDN Web Docs、GitHub 代码或包文档，省去在浏览器与 IDE 间反复切换。

## 快速开始

### 方式 1：在 Agent 对话中一键安装

复制以下指令直接发送给你的 Antigravity Agent：

```text
请帮我安装 antigravity-browser 插件。克隆仓库 https://github.com/zhonggl951-prog/antigravity-browser.git 至本地插件目录（macOS/Linux: ~/.gemini/config/plugins/browser，Windows: $env:USERPROFILE\.gemini\config\plugins\browser），执行 agy plugin validate 校验，并打开侧边栏体验链接 sidecar://browser/web_browser/ui.html。
```

### 方式 2：手动安装

克隆本仓库至 Antigravity 插件目录：

#### macOS / Linux
```bash
git clone https://github.com/zhonggl951-prog/antigravity-browser.git ~/.gemini/config/plugins/browser
```

#### Windows (PowerShell)
```powershell
git clone https://github.com/zhonggl951-prog/antigravity-browser.git $env:USERPROFILE\.gemini\config\plugins\browser
```

使用 `agy` 命令行校验插件完整性：
```bash
agy plugin validate ~/.gemini/config/plugins/browser
```

## 使用方法

在 Antigravity 对话中点击或输出以下 Sidecar 链接以打开侧边栏浏览器：

```markdown
[Web Browser](sidecar://browser/web_browser/ui.html)
```

1. **输入网址**：在顶部地址栏输入外部网址（如 `https://github.com`）或本地开发地址（如 `http://127.0.0.1:7123`），按回车打开；
2. **开启检查**：点击工具栏右侧的 `🎯` 按钮进入 Inspect 模式；
3. **点选组件**：鼠标移动到页面上想要调整的 UI 区域并点击；
4. **派发修改**：在弹出的卡片中描述你希望 Agent 进行的调整，按 `Cmd/Ctrl + Enter` 发送。Agent 即可接收该组件的选择器、HTML 源码与视觉快照进行精准修改；
5. **控制台抓虫**：当页面发生 JavaScript 报错时，工具栏会自动亮起 `🐞` 红标提示错误频次。点击展开控制台抽屉即可查看报错来源与堆栈，点击 **Send to Agent 🚀** 即可直接让 Agent 定位并修复代码 Bug。

## 目录结构

```
antigravity-browser/
├── plugin.json               # Antigravity 插件配置清单
├── sidecars/
│   └── web_browser/
│       ├── sidecar.json      # Sidecar 启动规格与视图配置
│       ├── server.mjs        # 后端代理与快照存储服务 (Node.js)
│       ├── ui.html           # 辅助面板纯白前端界面
│       ├── inspector-runtime.js # DOM 检查、截屏与 WebSocket 拦截运行时
│       └── html2canvas.min.js   # 离线 Canvas 截屏库
├── assets/
│   └── preview.svg           # 高清矢量界面预览图
├── .github/
│   └── workflows/
│       └── validate.yml      # CI 配置与语法校验流水线
├── CONTRIBUTING.md           # 贡献准则
├── LICENSE                   # MIT 开源协议
├── README.md                 # 英文文档 (English)
└── README_zh-CN.md           # 中文文档 (Simplified Chinese)
```

## 环境依赖

- **Node.js** (v18+)
- **curl**（macOS / Linux 内置；Windows 10 1803+ 与 Windows 11 已内置）
- [html2canvas](https://github.com/niklasvh/html2canvas) (已内置)

## 开源协议

[MIT License](LICENSE)
