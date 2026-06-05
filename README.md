# 自由鸟3.0 — 桌面AI助手

> Electron + OpenClaw + 自定义四栏暗色UI
> macOS优先 | 纯HTML/CSS/JS | 零框架
> 2026-06-05 | 宋墨鑫 & ziyouniao-3.0团队

---

## 架构

```
┌───────────────────────────────────────────┐
│  Electron 壳                               │
│  ┌─────────────────────────────────────┐  │
│  │ 自定义四栏UI (loadFile)             │  │
│  │ fetch → localhost:18789/v1          │  │
│  │ (AUTH_TOKEN 认证)                   │  │
│  └───────────────┬─────────────────────┘  │
│                  │                         │
│  main.js: spawn('openclaw', ...)          │
└──────────────────┼─────────────────────────┘
                   │ HTTP (127.0.0.1:18789)
┌──────────────────┴─────────────────────────┐
│  OpenClaw Gateway                          │
│  auth: token "ziyouniao-local-token-2026"  │
│  http.endpoints.chatCompletions: enabled   │
│  ┌──────────────────────────────────────┐  │
│  │ models.providers.openai → deepseek   │  │
│  │ apiKey via DEEPSEEK_API_KEY env var  │  │
│  │ model: deepseek-chat                 │  │
│  └──────────────────────────────────────┘  │
└──────────────────┬─────────────────────────┘
                   │ API Key (OpenClaw 统一管理)
┌──────────────────┴─────────────────────────┐
│  DeepSeek API                              │
└────────────────────────────────────────────┘
```

### 3.0 关键演进

| 方面 | 2.0/早期 | 3.0 (当前) |
|------|---------|-----------|
| 窗口加载 | `loadURL` → 加载OpenClaw原生UI | `loadFile('src/index.html')` → 自定义四栏UI |
| API 调用 | 直连 DeepSeek (前端配 Key) | 经 OpenClaw 网关代理 (统一管 Key) |
| 认证 | 用户 Key 硬编码在前端 | AUTH_TOKEN 认证 + 环境变量 |
| 设置面板 | 含 API Key 输入框 | 无 Key 字段，Key 由 OpenClaw 管理 |

---

## 文件结构

```
ziyouniaoAI2.0/
├── package.json              # Electron + electron-builder
├── electron-builder.yml      # macOS(.dmg) + Windows(nsis)
├── .gitignore
├── main.js                   # 主进程：spawn OpenClaw → 等就绪 → 开窗
├── preload.js                # 安全桥接（contextBridge）
├── assets/
│   └── icon.png              # 512x512 应用图标源文件
├── scripts/
│   └── generate-icons.sh     # png → .icns 生成脚本
└── src/
    ├── index.html            # 四栏布局骨架
    ├── css/
    │   ├── theme.css         # 暗色/亮色CSS变量体系
    │   ├── layout.css        # 四栏Grid布局 + 顶栏
    │   ├── chat.css          # 消息气泡 + 代码块 + 打字动画
    │   ├── sidebar.css       # 导航栏 + 会话列表
    │   └── components.css    # Toast/右键菜单/设置控件/滚动条
    ├── js/
    │   ├── utils.js          # generateId, escapeHtml, debounce
    │   ├── storage.js        # localStorage统一接口 (zyn3:*)
    │   ├── gateway.js        # 网关状态检查
    │   ├── api.js            # API通信 + SSE流式解析
    │   ├── chat.js           # 核心对话引擎
    │   ├── tabs.js           # 多标签页管理
    │   ├── sidebar.js        # 侧栏会话列表
    │   ├── settings.js       # 设置面板 (无API Key)
    │   ├── context-menu.js   # 右键上下文菜单
    │   └── app.js            # 应用入口 (最后加载)
    └── lib/
        ├── marked.min.js     # Markdown渲染 (placeholder)
        └── prism.min.js      # 代码高亮 (placeholder)
```

**总计**：25个文件，~4300行代码

---

## 快速开始

### 前置条件

```bash
# 1. Node.js >= 22
node -v

# 2. 安装 OpenClaw CLI
curl -fsSL https://openclaw.ai/install.sh | bash

# 3. 配置 OpenClaw（设置 DeepSeek API Key）
openclaw onboard
# → 工作目录: 任意路径
# → API Key: 粘贴 DeepSeek API Key
# → 端口: 18789

# 4. 创建 workspace + 配置人格
openclaw workspace init --name ziyouniao

# 5. 测试 OpenClaw
openclaw run "你好，测试连接"
```

### 启动项目

```bash
git clone https://github.com/huasu133/ziyouniaoAI2.0.git
cd ziyouniaoAI2.0
npm install
npm start
```

> `npm start` 会自动：
> 1. 在多路径查找 openclaw CLI（which → ~/.openclaw/bin → /usr/local/bin）
> 2. 检查端口18789是否被占用，未占用则 spawn openclaw serve
> 3. 轮询 `/health` 等待就绪（500ms间隔，最多10秒）
> 4. 加载自定义四栏UI
> 5. 恢复上次对话

---

## 功能清单

### P0 — 核心功能（已全部实现）

| # | 功能 | 实现 |
|---|------|------|
| 1 | 自定义四栏UI加载 | `win.loadFile('src/index.html')` |
| 2 | Gateway自动启动+等待就绪 | main.js 轮询 /health |
| 3 | macOS PATH多路径查找openclaw | which → ~/.openclaw/bin → /usr/local/bin |
| 4 | SSE流式对话 | api.js POST + ReadableStream + 流式渲染 |
| 5 | 多标签页+独立持久化 | tabs.js + storage.js (zyn3:tab:{id}) |
| 6 | 停止生成 | AbortController + fetch signal |
| 7 | 退出全量保存 | before-quit IPC → saveAll → kill网关 |
| 8 | 窗口崩溃自动恢复 | render-process-gone → 重新loadFile |
| 9 | 自动滚动+手动滚动暂停 | suppressAutoScroll + scrollTop检查 |
| 10 | 暗色/亮色主题切换 | CSS变量 + data-theme属性切换 |
| 11 | macOS .dmg打包 | electron-builder.yml mac配置 |
| 12 | .icns图标生成 | scripts/generate-icons.sh (sips+iconutil) |
| 13 | 设置面板（无API Key） | 引导去openclaw CLI配置 |

### P1 — 体验功能

| 功能 | 描述 |
|------|------|
| 消息复制按钮 | hover显示📋，点击变✅ |
| 输入历史 | ↑↓浏览历史输入 |
| 长对话裁剪 | 保留system prompt + 最近50条 |
| 会话右键菜单 | 重命名/导出/删除 |
| 搜索过滤 | 侧栏实时过滤会话列表 |
| 导出Markdown | 一键导出当前对话为.md |
| 状态指示器 | 顶栏🟢/🔴每30秒检查连接 |
| 对话自动命名 | 生成标题+摘要 |
| Markdown渲染 | **粗体**/*斜体*/`代码`/```代码块``` |

### P2 — 增强功能

| 功能 | 描述 |
|------|------|
| API自动重试 | 连接阶段重试2次（1s/2s），5xx + 网络错误可重试 |
| 4种风格预设 | 默认/高效/创意/专业/友好 |
| 托盘图标 | macOS菜单栏Tray |
| Git快照 | 启动后每小时commit |
| 免费搜索 | Claw主搜索 + Tavily/Serper补充（Key可选） |
| 消息删除 | 右键删除单条消息 |
| 对话导入/导出 | JSON格式完整备份（导入前确认）

---

## localStorage Schema

所有键以 `zyn3:` 为前缀：

| Key | 类型 | 说明 |
|-----|------|------|
| `zyn3:tabs` | Array | 标签页元数据 [{id, title, createdAt, updatedAt}] |
| `zyn3:tab:{id}` | Array | 单个标签的消息历史 [{role, content, timestamp}] |
| `zyn3:activeTab` | String | 当前活跃标签ID |
| `zyn3:settings` | Object | {theme, fontSize, model, style, temperature, maxTokens} |
| `zyn3:inputHistory` | Array | 输入历史（最近50条） |
| `zyn3:lessons` | Array | 经验教训（最近100条） |
| `zyn3:memories` | Array | AI记忆键值对 |

---

## JS模块架构

采用 `window.ZYN3` 命名空间，IIFE模式挂载：

```
加载顺序（index.html script标签）：
  1. utils.js         → window.ZYN3.Utils
  2. storage.js       → window.ZYN3.Storage
  3. gateway.js       → window.ZYN3.Gateway
  4. api.js           → window.ZYN3.API
  5. chat.js          → window.ZYN3.Chat
  6. tabs.js          → window.ZYN3.Tabs
  7. sidebar.js       → window.ZYN3.Sidebar
  8. settings.js      → window.ZYN3.Settings
  9. context-menu.js  → window.ZYN3.ContextMenu
 10. app.js           → window.ZYN3.App（入口）
```

各模块通过 `window.ZYN3.Xxx` 互相调用，无ES module依赖。

---

## CSS变量体系

```css
/* 暗色（默认） */
--bg: #1e1e1e;  --bg2: #252526;  --bg3: #2d2d2d;
--border: rgba(255,255,255,0.06);
--t1: #d2d3e0;  --t2: #858699;  --t3: #a0a0a0;
--accent: #6c4dff;  --accent-bg: rgba(108,77,255,0.12);
--green: #28b894;

/* 亮色 [data-theme="light"] */
--bg: #ffffff;  --bg2: #f5f5f5;  --bg3: #e8e8e8;
--border: rgba(0,0,0,0.1);
--t1: #1a1a1a;  --t2: #666666;  --t3: #999999;
--accent-bg: rgba(108,77,255,0.08);  --green: #1a8a6a;
```

---

## API约定

| 项 | 值 |
|----|-----|
| 端口 | 18789 (127.0.0.1) |
| 健康检查 | `GET /health` |
| 聊天补全 | `POST /v1/chat/completions` |
| 请求格式 | `{model, messages: [{role, content}], stream: true}` |
| 响应格式 | SSE: `data: {JSON}\n\n` |
| 终止标记 | `data: [DONE]` |
| 默认模型 | `openclaw`（网关内部路由到 deepseek-chat） |

---

## 打包

### macOS

```bash
# 生成 .icns 图标
bash scripts/generate-icons.sh

# 打包为 .dmg
npm run pack
# → release/自由鸟-1.0.0-arm64.dmg
```

### Windows

```bash
# 打包为 .exe
npx electron-builder --win
# → release/自由鸟 Setup 1.0.0.exe
```

---

## 5天实施路线

| 天 | 主题 | 产出 |
|----|------|------|
| D1 | 环境准备 | OpenClaw安装 + Node.js确认 + API Key配置 |
| D2 | Electron壳 | main.js (spawn+wait+loadFile) + preload.js |
| D3 | 四栏UI | index.html + 5个CSS + 核心对话引擎 (api/chat/tabs) |
| D4 | 功能完善 | 侧栏 + 设置面板 + 右键菜单 + 导出 |
| D5 | 打包测试 | 图标生成 + electron-builder + 集成测试 |

---

## 常见问题

**Q: 启动后窗口空白？**
→ 确认 OpenClaw 已安装：`which openclaw`
→ 确认能启动：`openclaw serve --port 18789`
→ 确认 API Key 有效：`openclaw run "测试"`

**Q: 对话没回复？**
→ 确认 OpenClaw 已配置 DeepSeek API Key
→ 查看终端是否有错误日志

**Q: Mac 打包失败？**
→ 确保已准备 512x512 icon.png 到 assets/
→ 运行 `bash scripts/generate-icons.sh` 生成 .icns

---

> 3.0基于2.0逐行实施手册重构，经PM→架构师→工程师→QA四轮团队协作，
> 修复13项P0硬伤，4300行代码完整可用。
