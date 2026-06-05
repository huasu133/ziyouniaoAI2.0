# 自由鸟2.0 逐行实施手册

> 照着做就行，每行命令都能直接复制粘贴
> 2026-06-04

---

## 第1天：装 OpenClaw + 跑通

### 1.1 打开终端（Windows 用 PowerShell 或 CMD）

```bash
# 检查 Node.js 版本（需要 ≥ 22）
node -v

# 如果低于 22，先升级 Node.js
# Windows: 去 https://nodejs.org 下载 v22 LTS 安装
# macOS: brew install node@22
```

### 1.2 安装 OpenClaw

```bash
# Windows PowerShell（管理员模式）
iwr -useb https://openclaw.ai/install.ps1 | iex

# macOS / Linux
curl -fsSL https://openclaw.ai/install.sh | bash
```

### 1.3 配置向导

```bash
openclaw onboard
```

> 向导会问3个问题：
> 1. 工作目录 → 输入 `C:\自由鸟`（或你想要的路径）
> 2. API Key → 粘贴你的 DeepSeek API Key
> 3. 端口 → 输入 `18789`（默认，直接回车）

### 1.4 创建工作区

```bash
openclaw workspace init --name ziyouniao
```

### 1.5 替换 SOUL.md

> 打开 OpenClaw 工作目录。如果你在 1.3 设的工作目录是 `C:\自由鸟`，1.4 建的工作区叫 `ziyouniao`，那 SOUL.md 的完整路径是：
> **`C:\自由鸟\ziyouniao\SOUL.md`**

找到这个文件，用以下内容替换默认的 SOUL.md：

```markdown
# 我是谁

宋墨新的 AI 搭档。结论先行，废话免谈。

## 格式铁律

1. **结论第一行**。不要铺垫。
2. **表格 > 列表 > 段落**。能用表格绝不用文字。
3. **单次不超过 3 个段落块**。超过就用表格或拆轮。
4. **短指令 1 行回复**。

## 禁止

- "好的，让我来..." / "以下是..." / "总结一下..."
- 超过 3 句的段落
- 在结论前放背景信息

## 结构模板（示例）

结论（1行），下面跟表格：

| 项 | 状态 |
|----|------|
| A  | ✅   |
| B  | ❌ 原因 |

最后一行：下一步干什么。
```

### 1.6 测试对话

```bash
openclaw run "你好，测试连接"
```

> 如果返回正常文字回复，第1天结束。
> 如果报错：检查 API Key 是否有效、网络是否通畅。

### 1.7 安全配置

找到 OpenClaw 配置文件（通常在 `~/.openclaw/config.yaml` 或工作目录下），确保：

```yaml
# 只监听本地，不暴露到公网
bind: "127.0.0.1"

# 端口
port: 18789
```

> 检查 Windows 防火墙：确保 18789 端口没有被开放到公网。

---

## 第2天：Electron 壳

### 2.1 初始化项目

```bash
# 在工作目录下新建 Electron 项目
mkdir ziyouniao-desktop
cd ziyouniao-desktop
npm init -y
npm install electron electron-builder --save-dev

# Windows 国内用户可能超时，设置镜像:
# $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# ⚠️ 设置 Electron 入口（npm init -y 不会自动设）
npm pkg set main="electron/main.js"

# 加常用脚本
npm pkg set scripts.start="npx electron ."
npm pkg set scripts.dev="npx electron ."
npm pkg set scripts.pack="electron-builder --win"

# 创建 .gitignore（防提交 node_modules / .env）
# Windows PowerShell 用户改用: New-Item .gitignore; 然后手动写入内容
cat > .gitignore << 'GITIGNORE'
node_modules/
release/
dist/
.env
*.log
GITIGNORE
```

### 2.2 创建 electron/main.js（完整文件）

在 `ziyouniao-desktop/` 下新建 `electron/main.js`：

```javascript
const { app, BrowserWindow, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

let mainWindow;
let gatewayProcess;
let isQuitting = false;

// 防多开
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
else { app.on('second-instance', () => { if (mainWindow) mainWindow.show(); }); }

// 启动 OpenClaw 网关
function startGateway() {
  // 先检查端口是否已占用
  const testSocket = new net.Socket();
  testSocket.setTimeout(1000);
  testSocket.on('connect', () => {
    testSocket.destroy();
    console.log('Gateway port 18789 already in use, skipping spawn');
  });
  testSocket.on('error', () => {
    // 端口空闲，启动 OpenClaw
    gatewayProcess = spawn('openclaw', ['serve', '--port', '18789'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    gatewayProcess.stdout.on('data', (data) => {
      console.log('[Gateway]', data.toString());
    });

    gatewayProcess.stderr.on('data', (data) => {
      console.error('[Gateway Error]', data.toString());
    });

    // 崩溃自动重启（3秒后）
    gatewayProcess.on('exit', (code) => {
      if (!isQuitting) {
        console.log(`Gateway exited (${code}), restarting in 3s...`);
        setTimeout(startGateway, 3000);
      }
    });
  });
  testSocket.connect(18789, '127.0.0.1');
}

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  // 加载 OpenClaw 前端
  const url = 'http://localhost:18789';
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startGateway();
  createWindow();

  // 全局快捷键
  globalShortcut.register('Alt+Space', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (gatewayProcess) gatewayProcess.kill();
});

// macOS dock 点击恢复窗口
app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});
```

### 2.3 创建 electron/preload.js（LESSONS.md 安全桥接）

> 替代原来的 bridge/lessons.js——渲染进程不能直接 require('fs')，必须通过 preload 桥接。

```javascript
const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');

function loadLessons() {
  const lessonsPath = path.join(__dirname, '..', 'LESSONS.md');
  if (!fs.existsSync(lessonsPath)) return '';
  const content = fs.readFileSync(lessonsPath, 'utf-8');
  const lines = content.split('\n');
  return lines.slice(-40).join('\n');
}

// Node.js HTTP GET（绕过浏览器 CORS）
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ziyouniao/2.0)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

contextBridge.exposeInMainWorld('electronAPI', {
  getLessons: () => loadLessons(),
  httpGet: (url) => httpGet(url),
});
```

同时在 `main.js` 的 `BrowserWindow` 配置里加 `preload`：

```javascript
// 找到 createWindow() 函数里的 webPreferences，改成：
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),  // ← 加这行
  nodeIntegration: false,
  contextIsolation: true,
},
```

### 2.4 项目结构确认（第2天结束时应该长这样）

```
ziyouniao-desktop/
├── package.json           ← {"main": "electron/main.js", ...}
├── electron/
│   ├── main.js
│   └── preload.js         ← 安全桥接（将来暴露文件操作）
├── src/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── lib/               ← Prism.js 放这里
└── build/
    └── icon.ico
```

> ⚠️ 不需要自己的 gateway/ 目录。OpenClaw 通过 CLI `openclaw serve` 启动，不需要复制 server.js。

### 2.5 测试启动

```bash
npx electron .
```

> 应该弹出 Electron 窗口，加载 OpenClaw 界面。如果能正常对话，第2天结束。

### 2.6 验证 OpenClaw API 格式（必须做，再做 UI）

> ⚠️ **先做完这步再做第3天的 UI！** 如果不先确认 API 能通，前端写完发不出消息。

```bash
# 1. 测试健康检查
curl http://localhost:18789/health

# 2. 测试聊天 API（非流式）
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":false}'
```

- **返回 404** → 试 `/api/chat`、`/v1/chat`、`/api/v1/chat/completions`
- **返回正常 JSON** → 记下 `model` 字段名，前端要用
- **验证通过后** → 如果实际路径和 `/v1` 不同，改 `app.js` 的 `API_URL`

```javascript
const API_URL = 'http://localhost:18789/v1';  // 按验证结果修改
```

---

## 第3天：四栏暗色 UI

### 3.1 创建 src/index.html（完整文件）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>自由鸟</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div id="app">
  <!-- 顶栏 -->
  <header class="topbar">
    <button class="tb-btn">☰</button>
    <div class="logo">◆ 自由鸟</div>
    <div class="tb-right">
      <input class="search-global" placeholder="搜索...">
      <button class="tb-btn">⚙</button>
      <div class="avatar">墨</div>
    </div>
  </header>

  <div class="main">
    <!-- 导航栏 52px -->
    <nav class="nav">
      <button class="nav-item active" title="新建">+</button>
      <button class="nav-item" title="总控">⊞</button>
      <button class="nav-item active" title="对话">💬</button>
      <button class="nav-item" title="专家">👥</button>
      <button class="nav-item" title="技能">★</button>
      <button class="nav-item" title="设置">🔗</button>
      <button class="nav-item" title="自动化">⚙</button>
      <div class="nav-spacer"></div>
      <button class="nav-item" title="帮助">?</button>
    </nav>

    <!-- 侧栏 240px -->
    <aside class="sidebar">
      <div class="sb-header">
        <select><option>对话</option></select>
        <button class="sb-add">+</button>
      </div>
      <div class="sb-search">
        <input placeholder="搜索历史...">
      </div>
      <div class="sb-list" id="sessionList">
        <div class="sb-date">今天</div>
        <div class="session-item active">
          <div class="session-title">新对话</div>
        </div>
        <!-- 动态生成 -->
      </div>
    </aside>

    <!-- 聊天区 -->
    <main class="chat">
      <div class="chat-toolbar">
        <div class="search-bar">
          <input placeholder="在当前对话中搜索... (⌘F)">
          <span class="counter">0/0</span>
        </div>
      </div>
      <div class="messages" id="messages">
        <!-- 对话气泡动态生成 -->
      </div>
      <div class="input-area">
        <div class="input-box">
          <button class="add-btn">+</button>
          <textarea id="input" rows="1" placeholder="给自由鸟发消息..."></textarea>
          <button class="send-btn" id="sendBtn">➤</button>
        </div>
        <div class="input-bar">
          <div class="input-tools">
            <button>🔍搜索</button>
            <button>📄文件</button>
            <button>👤专家</button>
          </div>
          <select class="model-select">
            <option value="deepseek-chat">DeepSeek-V4-Pro</option>
            <option value="deepseek-reasoner">DeepSeek-V4-Flash</option>
          </select>
        </div>
      </div>
    </main>

    <!-- 详情面板 280px -->
    <aside class="detail">
      <div class="dt-header">
        <span>当前会话</span>
        <button>▼</button>
      </div>
      <div class="dt-body" id="detailPanel">
        <div class="dt-section">
          <div class="dt-label">会话信息</div>
          <div class="kv"><span class="k">模型</span><span class="v">DS-V4-Pro</span></div>
          <div class="kv"><span class="k">消息</span><span class="v">0</span></div>
        </div>
        <div class="dt-section">
          <div class="dt-label">产物</div>
          <div id="artifacts"><!-- 动态 --></div>
        </div>
        <div class="dt-section">
          <div class="dt-label">经验教训</div>
          <div id="lessonsPanel"><!-- 动态 --></div>
        </div>
      </div>
    </aside>
  </div>
</div>
<script src="app.js"></script>
</body>
</html>
```

### 3.2 创建 src/style.css（暗色主题）

```css
:root {
  --bg: #1e1e1e;  --bg2: #252526;  --bg3: #2d2d2d;
  --border: rgba(255,255,255,0.06);
  --t1: #d2d3e0;  --t2: #858699;  --t3: #a0a0a0;
  --accent: #6c4dff;
  --accent-bg: rgba(108,77,255,0.12);
  --green: #28b894;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: Menlo, Monaco, 'Courier New', monospace;
}

/* 亮色主题 */
[data-theme="light"] {
  --bg: #ffffff;  --bg2: #f5f5f5;  --bg3: #e8e8e8;
  --border: rgba(0,0,0,0.1);
  --t1: #1a1a1a;  --t2: #666666;  --t3: #999999;
  --accent: #6c4dff;
  --accent-bg: rgba(108,77,255,0.08);
  --green: #1a8a6a;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--font); font-size: 13px; color: var(--t1);
  background: var(--bg); height: 100vh; overflow: hidden;
}

/* 顶栏 */
.topbar {
  display: flex; align-items: center; height: 56px; padding: 0 8px;
  background: var(--bg); border-bottom: 1px solid var(--border);
}
.logo { font-size: 14px; font-weight: 600; margin-left: 8px; flex: 1; }
.tb-right { display: flex; align-items: center; gap: 8px; }
.tb-btn { width: 36px; height: 36px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; color: var(--t2); font-size: 16px; }
.tb-btn:hover { background: rgba(255,255,255,0.04); }
.avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--accent);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 11px; cursor: pointer; }
.search-global { height: 28px; border: none; background: var(--bg3);
  border-radius: 6px; padding: 0 10px; color: var(--t1); font-size: 12px;
  width: 200px; outline: none; }

/* 主体四栏 */
.main { display: flex; height: calc(100vh - 56px); }

/* 导航 */
.nav { width: 52px; background: var(--bg2); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center; padding: 8px 0; }
.nav-item { width: 36px; height: 36px; border-radius: 8px; border: none;
  background: transparent; cursor: pointer; color: var(--t2); margin: 2px 0;
  display: flex; align-items: center; justify-content: center; }
.nav-item:hover { background: rgba(255,255,255,0.04); }
.nav-item.active { background: var(--accent-bg); color: var(--accent); }
.nav-spacer { flex: 1; }

/* 侧栏 */
.sidebar { width: 240px; background: var(--bg2); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; }
.sb-header { padding: 12px; display: flex; gap: 4px; }
.sb-header select { flex: 1; height: 28px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg3); color: var(--t1); font-size: 13px; padding: 0 6px; }
.sb-add { width: 28px; height: 28px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; color: var(--t2); font-size: 16px; }
.sb-search { padding: 0 12px 8px; }
.sb-search input { width: 100%; height: 28px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg3); color: var(--t1); padding: 0 8px; font-size: 12px; outline: none; }
.sb-list { flex: 1; overflow-y: auto; padding: 0 8px; }
.sb-date { font-size: 11px; color: var(--t3); padding: 8px 4px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px; }
/* 会话列表项（app.js 动态生成） */

/* 聊天区 */
.chat { flex: 1; display: flex; flex-direction: column; background: var(--bg); }
.chat-toolbar { display: flex; align-items: center; height: 40px; padding: 0 8px;
  border-bottom: 1px solid var(--border); }
.search-bar { display: flex; align-items: center; flex: 1; height: 28px;
  border-radius: 6px; background: var(--bg3); padding: 0 8px; }
.search-bar input { border: none; background: transparent; color: var(--t1);
  flex: 1; outline: none; font-size: 13px; }
.counter { font-size: 12px; color: var(--t2); }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex;
  flex-direction: column; gap: 16px; }

/* 消息气泡 */
.msg { display: flex; gap: 10px; align-items: flex-start; }
.msg.reverse { flex-direction: row-reverse; }
.msg-avatar { width: 28px; height: 28px; min-width: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 11px; }
.msg-avatar.ai { background: var(--accent); color: #fff; }
.msg-avatar.user { background: var(--bg3); color: var(--t2); }
.msg-body { flex: 1; min-width: 0; }
.msg-name { font-size: 12px; font-weight: 500; color: var(--t1); margin-bottom: 4px; }
.msg.reverse .msg-text {
  background: var(--bg3);
  padding: 10px 14px;
  border-radius: 12px;
  border-bottom-right-radius: 4px;
  display: inline-block;
  max-width: 80%;
}

/* 输入区 */
.input-area { padding: 8px 14px 12px; border-top: 1px solid var(--border); }
.input-box { display: flex; align-items: center; gap: 4px;
  border: 1px solid var(--border); border-radius: 8px; padding: 0 4px 0 8px; }
.input-box textarea { flex: 1; border: none; background: transparent; color: var(--t1);
  font-size: 13px; resize: none; height: 32px; outline: none; padding: 6px 0; }
.send-btn { width: 28px; height: 28px; border: none; border-radius: 6px;
  background: var(--accent); color: #fff; cursor: pointer; }
.input-bar { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.input-tools { display: flex; gap: 4px; }
.input-tools button { padding: 0 8px; height: 22px; border: 1px solid var(--border);
  border-radius: 4px; background: transparent; color: var(--t2); font-size: 11px; cursor: pointer; }
.model-select { height: 22px; border: 1px solid var(--border); border-radius: 4px;
  background: transparent; color: var(--t1); font-size: 11px; }

/* 详情面板 */
.detail { width: 280px; background: var(--bg2); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; }
.dt-header { display: flex; align-items: center; padding: 0 8px; height: 40px;
  border-bottom: 1px solid var(--border); }
.dt-header span { flex: 1; font-size: 13px; font-weight: 500; }
.dt-body { flex: 1; overflow-y: auto; padding: 12px; }
.dt-section { margin-bottom: 20px; }
.dt-label { font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--t3); margin-bottom: 8px; }
.kv { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.kv .k { color: var(--t2); } .kv .v { color: var(--t1); }

/* 工具调用卡片 */
.tool-card { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.tool-hdr { display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  background: var(--bg3); border-bottom: 1px solid var(--border); }
.tool-dot { width: 8px; height: 8px; border-radius: 50%; }
.tool-dot.ok { background: var(--green); }
.tool-body { padding: 8px 12px; font-size: 12px; color: var(--t2);
  font-family: var(--font-mono); }

/* 代码高亮 */
pre code { font-family: var(--font-mono); font-size: 12px; }

/* 滚动 */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
```

### 3.3 创建 src/app.js（完整前端逻辑）

```javascript
// 自由鸟2.0 前端
const API_URL = 'http://localhost:18789/v1';
let sessionId = Date.now();
let suppressAutoScroll = false;
let searchIndex = 0;

// 发送消息
let messages = []; // 维护完整对话历史

async function sendMessage() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text) return;

  // 记录用户消息到历史
  messages.push({ role: 'user', content: text });
  addMessage('user', text);
  input.value = '';
  document.getElementById('sendBtn').disabled = true;
  let reply = ''; // 提到 try 外，catch 里也能读到

  try {
    const res = await fetch(`${API_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: document.querySelector('.model-select').value,
        messages: messages, // ← 传完整历史
        stream: true,
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    addMessage('ai', '');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 未完成的行放回 buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || '';
            reply += content;
          } catch (e) {}
        }
      }
      updateLastMessage(reply);
    }
  } catch (e) {
    // AbortError（用户点停止）不报错
    if (e.name === 'AbortError') {
      console.log('用户停止了生成');
    } else {
      addMessage('system', `错误: ${e.message}`);
    }
  }
  document.getElementById('sendBtn').disabled = false;
  // 记录 AI 回复到历史
  const lastText = document.querySelectorAll('.msg:not(.reverse)');
  const lastReply = lastText[lastText.length - 1]?.dataset?.text || '';
  if (lastReply) messages.push({ role: 'assistant', content: lastReply });
  // 流结束：Markdown 渲染 + 代码高亮 + 自动生成摘要
  setTimeout(() => {
    const lastMsg = document.querySelectorAll('.msg-text');
    if (lastMsg.length && typeof marked !== 'undefined') {
      const raw = lastMsg[lastMsg.length - 1].textContent;
      lastMsg[lastMsg.length - 1].innerHTML = marked.parse(raw);
    }
    if (window.Prism) Prism.highlightAll();
  }, 100);
  setTimeout(() => { generateSummaryAndName(); }, 500);
  document.getElementById('sendBtn').disabled = false;
}

// 添加消息到界面
function addMessage(role, text) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'reverse' : ''}`;
  div.dataset.text = text;

  const avatar = role === 'user' ? '你' : role === 'ai' ? '◆' : '⚠';
  const avatarClass = role === 'user' ? 'user' : role === 'ai' ? 'ai' : '';

  div.innerHTML = `
    <div class="msg-avatar ${avatarClass}">${avatar}</div>
    <div class="msg-body">
      <div class="msg-name">${role === 'user' ? '你' : role === 'ai' ? '自由鸟' : '系统'}</div>
      <div class="msg-text">${renderMessage(text) || '...'}</div>
    </div>`;
  container.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function updateLastMessage(text) {
  const msgs = document.querySelectorAll('.msg');
  const last = msgs[msgs.length - 1];
  if (last) {
    last.querySelector('.msg-text').textContent = text;
    last.dataset.text = text;
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// 键盘事件
document.getElementById('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'F' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    document.querySelector('.search-bar input').focus();
  }
});

// 通过 preload 桥接加载 LESSONS.md
if (window.electronAPI?.getLessons) {
  const lessons = window.electronAPI.getLessons();
  document.getElementById('lessonsPanel').innerHTML = lessons
    ? `<pre style="font-size:12px;color:var(--t2);white-space:pre-wrap">${lessons}</pre>`
    : '<div style="color:var(--t3);font-size:12px;">暂无经验教训</div>';
}

// ---------- Markdown 渲染（流式结束才触发） ----------
// 在 sendMessage 流结束后调用 marked.parse，替换 textContent
// 前提：index.html 已加载 marked.min.js
// 修改 updateLastMessage：流式期间保持 textContent（快），
// 流结束后在 Markdown 渲染步骤触发：
// last.querySelector('.msg-text').innerHTML = marked.parse(reply);

// ---------- 文件拖拽 ----------
const dropZone = document.getElementById('input');
dropZone.addEventListener('dragover', (e) => e.preventDefault());
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const text = await file.text();
  document.getElementById('input').value = text;
});

// ---------- 粘贴图片 ----------
document.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result;
        // 以图片 URL 形式插入输入框
        document.getElementById('input').value += `\n![图片](${base64})\n`;
      };
      reader.readAsDataURL(file);
    }
  }
});
```

### 对话持久化（在 sendMessage 末尾流结束后加）

```javascript
// 持久化对话到 localStorage
localStorage.setItem('ziyouniao-session', JSON.stringify({
  id: sessionId,
  messages: messages,
  updatedAt: new Date().toISOString(),
}));
```

### 在 app.js 顶部加 sessionId

```javascript
(function restoreSession() {
  try {
    const saved = localStorage.getItem('ziyouniao-session');
    if (saved) {
      const session = JSON.parse(saved);
      messages = session.messages || [];
      const container = document.getElementById('messages');
      if (container) {
        container.innerHTML = '';
        suppressAutoScroll = true;
        messages.forEach(m => {
          addMessage(m.role === 'user' ? 'user' : 'ai', m.content);
        });
        suppressAutoScroll = false;
      }
      const title = localStorage.getItem(`session-name-${session.id}`) || '上次对话';
      const firstItem = document.querySelector('.session-item:first-child .session-title');
      if (firstItem) firstItem.textContent = title;
    }
  } catch (e) { /* 静默失败，从头开始 */ }
})();
```

### 3.4 测试 UI

```bash
# 在 Electron 项目根目录运行
npx electron .
```

> 应该看到四栏暗色界面，能输入对话。

---

## 第4天上午：可视化收尾

### 4.1 下载 Prism.js + marked.js

```bash
# 下载代码高亮库到 src/lib/
mkdir -p src/lib
cd src/lib/
curl -O https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js
curl -O https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.min.css
# Markdown 渲染库
curl -O https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js
cd ../..
```

### 4.2 在 index.html 里引入

在 `</head>` 之前：

```html
<link rel="stylesheet" href="lib/prism-okaidia.min.css">
```

在 `<script src="app.js">` 之前：

```html
<script src="lib/marked.min.js"></script>
<script src="lib/prism.min.js"></script>
```

### 4.3 让代码高亮 + Markdown 渲染生效

Prism 已在 app.js 的 `sendMessage` 流式结束后自动调用（见 `setTimeout(() => Prism.highlightAll(), 100)`）。

Markdown 渲染在流式结束后触发。在 `sendMessage` 末尾的 `setTimeout()` 前加一行：

```javascript
// 流结束：将最后一条消息渲染为 Markdown
const lastMsg = document.querySelectorAll('.msg-text');
if (lastMsg.length && typeof marked !== 'undefined') {
  const raw = lastMsg[lastMsg.length - 1].textContent;
  lastMsg[lastMsg.length - 1].innerHTML = marked.parse(raw);
}
```

如果代码块没高亮，检查 Prism.js 和 marked.js 确实加载到了 `src/lib/`。

### 4.3b JSON 树视图（加到 app.js 末尾）

```javascript
// JSON 树视图（递归上限 10 层，防止循环引用爆栈）
function renderJSON(data, depth = 0) {
  if (depth > 10) return '<span style="color:#ce9178">[...太深]</span>';
  if (typeof data !== 'object' || data === null) {
    return `<span style="color:#ce9178">${escapeHtml(String(data))}</span>`;
  }
  const isArray = Array.isArray(data);
  const entries = isArray ? data : Object.entries(data);
  const indent = depth * 20;

  if (entries.length === 0) return isArray ? '[]' : '{}';

  let html = `<details ${depth < 1 ? 'open' : ''} style="margin-left:${indent}px">`;
  html += `<summary>${isArray ? `[${entries.length}项]` : `{${Object.keys(data).length}个键}`}</summary>`;
  for (const [key, val] of isArray ? entries.entries() : entries) {
    const k = isArray ? key : escapeHtml(key);
    html += `<div style="margin-left:${indent + 20}px">`;
    html += `<span style="color:#569cd6">${k}</span>: `;
    html += renderJSON(val, depth + 1);
    html += `</div>`;
  }
  html += `</details>`;
  return html;
}

// 消息渲染时检测 JSON
function renderMessage(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object') {
      return renderJSON(parsed);
    }
  } catch (e) {}
  return escapeHtml(text);
}
```

---

## 第4天下午：快捷键 + 导出 + 打包

### 4.4 快捷键（已写在 main.js 和 app.js 里）

| 快捷键 | 位置 | 实现 |
|-------|------|------|
| Alt+Space | electron/main.js | 全局快捷键，显示/隐藏窗口 |
| Ctrl+F / ⌘F | app.js | 聚焦搜索框 |
| Enter 发送 | app.js | 输入框 Enter 发送 |
| Ctrl+N 新对话 | app.js（需要时加） | `globalShortcut.register('CommandOrControl+N', ...)` |

### 4.5 对话导出（加到 app.js）

```javascript
// 导出对话为 Markdown
function exportMarkdown() {
  const msgs = document.querySelectorAll('.msg');
  let md = `# 对话导出\n\n日期: ${new Date().toISOString().slice(0, 10)}\n\n`;
  msgs.forEach(m => {
    const role = m.classList.contains('reverse') ? '你' : '自由鸟';
    const text = m.dataset.text || '';
    md += `### ${role}\n\n${text}\n\n`;
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `对话_${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 4.7 风格切换（4种预设）

在 `src/styles/` 下创建 4 个风格文件，用户在输入框底部下拉可以选择。

**src/styles/efficient.md（高效）**
```
- 每条回复不超过 3 句话
- 结论在第一句
- 不要"好的""让我来"等废话
- 用表格代替段落
```

**src/styles/creative.md（创意）**
```
- 可以适当使用比喻和故事
- 鼓励多角度思考
- 回复可以长一些，但要有洞察
- 语气轻松，可以用感叹
```

**src/styles/professional.md（专业）**
```
- 正式、有条理
- 结论后跟论据
- 引用数据和标准
- 不省略步骤
```

**src/styles/friendly.md（友好）**
```
- 像朋友聊天一样
- 可以用"你"和自然语气
- 适当共情
- 回复温暖但有干货
```

**实现：** 在 `sendMessage` 里读取当前风格选择，拼到 messages[0] 的 system prompt 中：

```javascript
const style = document.getElementById('styleSelect')?.value || '';
if (style && messages.length === 0) {
  messages.push({ role: 'system', content: style });
}
```

**UI 添加：** 在输入框底部模型选择器旁边加：

```html
<select id="styleSelect">
  <option value="">默认</option>
  <option value="高效">⚡高效</option>
  <option value="创意">🎨创意</option>
  <option value="专业">📋专业</option>
  <option value="友好">💬友好</option>
</select>
```

### 4.8b 自动汇总 + 自动命名（合并为一次 API 调用）

```javascript
// 合并生成摘要 + 对话标题，省一次 API 调用
async function generateSummaryAndName() {
  if (messages.length < 2) return;
  const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n')
    + '\n\n请分别回复以下两项（用 --- 分隔）：\n'
    + '1. 给这个对话起一个 5 字以内的标题\n'
    + '2. 用以下格式总结本次对话：\n'
    + '## 总结\n3-5句话概述\n'
    + '## 分析\n列出关键决策和变化\n'
    + '## 推荐\n2-3条下一步行动';

  const res = await fetch(`${API_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: document.querySelector('.model-select').value,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    }),
  });
  const data = await res.json();
  const result = data.choices?.[0]?.message?.content || '';
  const parts = result.split('---');

  // 第一部分：标题（侧栏更新）
  const title = parts[0]?.replace(/["""]/g, '').trim().slice(0, 10) || '新对话';
  const firstItem = document.querySelector('.sb-list .session-item:first-child .session-title');
  if (firstItem) firstItem.textContent = title;
  localStorage.setItem(`session-name-${sessionId}`, title);

  // 第二部分：摘要（右侧面板）
  const summary = parts[1]?.trim() || result;
  const html = summary
    .replace(/## (.+)/g, '<h3>$1</h3>')
    .replace(/- (.+)/g, '<li>$1</li>');
  document.getElementById('lessonsPanel').innerHTML = html;

  // 追加到历史 + 保存记忆
  const log = `\n## ${new Date().toISOString().slice(0,16).replace('T',' ')}\n${summary}\n---\n`;
  localStorage.setItem('ziyouniao-summaries',
    (localStorage.getItem('ziyouniao-summaries') || '') + log);
  saveMemory('上次对话', summary.slice(0, 100));
}

// 在 sendMessage 末尾的 setTimeout 里，改为只调这一个函数：
//   setTimeout(() => { generateSummaryAndName(); }, 500);
// 删掉原来的 generateSummary() 和 autoNameSession() 调用
```

**HTML 侧栏项加 class：**
```html
<div class="session-item active">
  <div class="session-title">新对话</div>  ← AI 自动替换为 5 字标题
</div>
```

### 4.9 错误恢复（加到 app.js）

```javascript
// 失败→toast→重试按钮→自动重连
function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${message} <button onclick="this.parentElement.remove();sendMessage()">重试</button>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

// CSS 加 toast 样式
// .toast { position:fixed;bottom:20px;right:20px;padding:10px 16px;
//   border-radius:8px;font-size:13px;z-index:9999; }
// .toast-error { background:#442;color:#faa;border:1px solid #622; }
// .toast-success { background:#244;color:#afa;border:1px solid:#262; }

// 在 sendMessage 的 catch 块里：
// catch(e) { showToast(`对话失败: ${e.message}`); }
```

### 4.10 托盘菜单

在 main.js 顶部加 `const { Tray, Menu, nativeImage } = require('electron');`，并在 `app.whenReady()` 内添加：

```javascript
// 托盘（最小化到任务栏）
const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico'));
tray = new Tray(icon);
const contextMenu = Menu.buildFromTemplate([
  { label: '显示自由鸟', click: () => mainWindow?.show() },
  { type: 'separator' },
  { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
]);
tray.setToolTip('自由鸟');
tray.setContextMenu(contextMenu);
tray.on('click', () => mainWindow?.show());
```

### 4.11 记忆面板（加到 app.js）

右下角滑动侧板，查看/编辑/删除 AI 对你的记忆。

```javascript
// 记忆面板
let memoryItems = [];
function loadMemoryPanel() {
  const items = JSON.parse(localStorage.getItem('ziyouniao-memories') || '[]');
  memoryItems = items;
  renderMemoryPanel();
}

function saveMemory(key, value) {
  memoryItems = memoryItems.filter(m => m.key !== key);
  memoryItems.push({ key, value, time: Date.now() });
  localStorage.setItem('ziyouniao-memories', JSON.stringify(memoryItems.slice(-50)));
  renderMemoryPanel();
}

function deleteMemory(key) {
  memoryItems = memoryItems.filter(m => m.key !== key);
  localStorage.setItem('ziyouniao-memories', JSON.stringify(memoryItems));
  renderMemoryPanel();
}

function renderMemoryPanel() {
  const el = document.getElementById('memoryPanel');
  el.innerHTML = memoryItems.length === 0
    ? '<div style="color:var(--t3);font-size:12px;padding:8px;">暂无记忆</div>'
    : memoryItems.slice(-10).reverse().map(m => `
      <div class="mem-item">
        <div class="mem-key">${escapeHtml(m.key)}</div>
        <div class="mem-val">${escapeHtml(m.value)}</div>
        <button class="mem-del" onclick="deleteMemory('${m.key}')">✕</button>
      </div>
    `).join('');
}

// CSS
// .mem-item { padding:8px; border-bottom:1px solid var(--border); position:relative; }
// .mem-key { font-size:11px; color:var(--accent); margin-bottom:2px; }
// .mem-val { font-size:12px; color:var(--t1); }
// .mem-del { position:absolute; right:8px; top:8px; background:none; border:none;
//   color:var(--t3); cursor:pointer; font-size:12px; }

// 记忆由 generateSummaryAndName() 自动保存，无需额外调用

loadMemoryPanel();
```

**HTML 在详情面板加：**
```html
<div class="dt-section">
  <div class="dt-label">记忆</div>
  <div id="memoryPanel" style="max-height:300px;overflow-y:auto;"></div>
</div>
```

### 4.12 打包前检查

```bash
# 必须全部通过
cat package.json | grep '"main"'          # 应该有 "main": "electron/main.js"
which openclaw                           # 确认 openclaw CLI 可用
ls build/icon.ico                        # 确认图标文件存在
```

### 4.13 Electron Builder 配置

创建 `electron-builder.yml`：

```yaml
appId: com.freebird.ziyouniao
productName: 自由鸟
directories:
  output: release
files:
  - "src/**/*"
  - "electron/**/*"
  - "build/**/*"
  - "package.json"
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  unicode: true
```

### 4.14 创建桌面图标

```bash
# 方式1：用任意 256x256 的 PNG 转 ICO
# 在线工具: https://icoconvert.com/
# 保存到 build/icon.ico

# 方式2：用 npm 包一键转换
npx png-to-ico icon.png > build/icon.ico
```

### 4.15 打包

```bash
npx electron-builder --win
```

> 打包完成后在 `release/` 目录下找到 `自由鸟 Setup 1.0.0.exe`。

---

## 第5天：丝滑体验优化

> 对标 WorkBuddy 的 11 项体验优化 + 设置面板 + 多标签页，P0~P2 按优先级排列。
> 总新增代码 ~315 行，约 2.5 天。

---

## 第6天：设置面板 + 多标签页 + 免费搜索

> 按需加的补充功能。不做也行，做了更顺手。
> 新增代码 ~180 行。

### 6.1 设置面板

在右侧详情面板加「设置」模式，切出来显示配置项。

**HTML：** 在详情面板加切换按钮和设置内容区：

```html
<button class="dt-toggle" onclick="toggleSettings()">⚙️ 设置</button>
<div id="settingsPanel" style="display:none;padding:12px;">
  <div class="set-group">
    <label>API Key</label>
    <input id="setApiKey" type="password" placeholder="sk-..." class="set-input">
  </div>
  <div class="set-group">
    <label>默认模型</label>
    <select id="setModel" class="set-input">
      <option value="deepseek-chat">DeepSeek-V4-Pro</option>
      <option value="deepseek-reasoner">DeepSeek-V4-Flash</option>
      <option value="gpt-4o">GPT-4o</option>
    </select>
  </div>
  <div class="set-group">
    <label>主题</label>
    <select id="setTheme" class="set-input">
      <option value="dark">暗色</option>
      <option value="light">亮色</option>
    </select>
  </div>
  <button class="set-save" onclick="saveSettings()">保存</button>
</div>
```

**CSS：**
```css
.set-group { margin-bottom: 12px; }
.set-group label { display:block; font-size:12px; color:var(--t2); margin-bottom:4px; }
.set-input {
  width:100%; height:30px; background:var(--bg3); border:1px solid var(--border);
  border-radius:6px; padding:0 8px; font-size:13px; color:var(--t1); outline:none;
}
.set-input:focus { border-color:var(--accent); }
.set-save {
  width:100%; height:32px; background:var(--accent); color:#fff; border:none;
  border-radius:6px; font-size:13px; cursor:pointer; margin-top:8px;
}
.set-toggle { background:none; border:none; color:var(--accent); cursor:pointer; font-size:13px; padding:0; }
```

**JS：**
```javascript
function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) loadSettings();
}

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('ziyouniao-settings') || '{}');
  document.getElementById('setApiKey').value = s.apiKey || '';
  document.getElementById('setModel').value = s.model || 'deepseek-chat';
  document.getElementById('setTheme').value = s.theme || 'dark';
}

function saveSettings() {
  const s = {
    apiKey: document.getElementById('setApiKey').value,
    model: document.getElementById('setModel').value,
    theme: document.getElementById('setTheme').value,
  };
  localStorage.setItem('ziyouniao-settings', JSON.stringify(s));
  if (s.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const modelSelect = document.querySelector('.model-select');
  if (modelSelect) modelSelect.value = s.model;
  document.getElementById('settingsPanel').style.display = 'none';
  showToast('设置已保存', 'success');
}
```

### 6.2 多标签页

在侧栏上方加标签栏，可以同时开多个对话。

**HTML：** 在侧栏顶部加：

```html
<div class="tab-bar" id="tabBar">
  <div class="tab active" data-tab="0">对话 1</div>
  <div class="tab-add" onclick="newTab()">+</div>
</div>
```

**CSS：**
```css
.tab-bar {
  display:flex; align-items:center; gap:2px; padding:6px 6px 0 6px;
  border-bottom:1px solid var(--border);
}
.tab {
  padding:4px 10px; font-size:12px; border-radius:6px 6px 0 0;
  cursor:pointer; color:var(--t2); background:transparent;
  max-width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.tab.active { color:var(--t1); background:var(--bg3); }
.tab:hover { background:var(--bg3); }
.tab-close { margin-left:4px; font-size:10px; color:var(--t3); cursor:pointer; }
.tab-add { padding:4px 8px; font-size:14px; cursor:pointer; color:var(--t2); flex-shrink:0; }
.tab-add:hover { color:var(--t1); }
```

**JS：**
```javascript
let tabs = [{ id: Date.now(), messages: [], name: '对话 1' }];
let currentTab = 0;

function renderTabs() {
  const bar = document.getElementById('tabBar');
  // 只移除 .tab 元素，保留 addBtn
  bar.querySelectorAll('.tab').forEach(el => el.remove());
  tabs.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'tab' + (i === currentTab ? ' active' : '');
    div.innerHTML = `${t.name}<span class="tab-close" onclick="event.stopPropagation();closeTab(${i})">×</span>`;
    div.onclick = () => switchTab(i);
    bar.appendChild(div);
  });
  bar.appendChild(addBtn);
}

function switchTab(index) {
  // 保存当前对话
  tabs[currentTab].messages = [...messages];
  currentTab = index;
  messages = tabs[index].messages;
  // 重新渲染界面（抑制自动滚动）
  const container = document.getElementById('messages');
  container.innerHTML = '';
  suppressAutoScroll = true;
  messages.forEach(m => addMessage(m.role === 'user' ? 'user' : 'ai', m.content));
  suppressAutoScroll = false;
  renderTabs();
}

function newTab() {
  tabs.push({ id: Date.now(), messages: [], name: `对话 ${tabs.length + 1}` });
  switchTab(tabs.length - 1);
}

function closeTab(index) {
  if (tabs.length <= 1) return;
  tabs[currentTab].messages = [...messages]; // 先保存当前对话
  tabs.splice(index, 1);
  currentTab = Math.min(currentTab, tabs.length - 1);
  switchTab(currentTab);
}
```

### 6.3 免费搜索（取代 OpenClaw 付费搜索）

从 v4 移植，**Claw Search → DuckDuckGo**，全部免费无 Key。

```javascript
// ---------- 免费搜索 ----------
const SEARCH_CACHE = {};
const CACHE_TTL = 3600 * 1000;
const MAX_CACHE = 100;
let cacheKeys = [];

async function clawSearch(query) {
  const url = `https://www.claw-search.com/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.web?.results?.length) return [];
  return data.web.results.slice(0, 5).map(r => ({
    title: r.title, url: r.url, snippet: r.description || '',
  }));
}

async function duckduckgoSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ziyouniao/2.0)' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const results = [];
  const regex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null && results.length < 5) {
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    if (title) results.push({ title, url: match[1] });
  }
  return results;
}

async function searchWeb(query) {
  const cached = SEARCH_CACHE[query];
  if (cached && Date.now() - cached.time < CACHE_TTL)
    return { results: cached.results, source: 'cache' };
  const claw = await clawSearch(query).catch(() => []);
  if (claw.length > 0) {
    SEARCH_CACHE[query] = { results: claw, time: Date.now() };
    cacheKeys.push(query); if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
    return { results: claw, source: 'claw' };
  }
  const ddg = await duckduckgoSearch(query).catch(() => []);
  if (ddg.length > 0) {
    SEARCH_CACHE[query] = { results: ddg, time: Date.now() };
    cacheKeys.push(query); if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
    return { results: ddg, source: 'duckduckgo' };
  }
  return { error: '搜索无结果' };
}
```

在输入框上方加搜索按钮：

```html
<button onclick="(async()=>{
  const q=prompt('搜索什么？'); if(!q) return;
  const r=await searchWeb(q);
  addMessage('ai',JSON.stringify(r.results?.slice(0,3),null,2));
})()">🔍 免费搜索</button>
```

### 6.4 免费抓取网页（freeFetchURL）

从 v4 的 extractURL 改造的免费版，直接 `fetch` 抓 HTML 提纯文本，零成本。

```javascript
// ---------- 免费抓网页 ----------
async function fetchURL(url) {
  try {
    let raw;
    if (window.electronAPI?.httpGet) {
      raw = await window.electronAPI.httpGet(url); // preload 绕过 CORS
    } else {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ziyouniao/2.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      raw = await res.text();
    }
    const title = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || url;
    const cleaned = raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { title, content: cleaned.slice(0, 5000) };
  } catch (e) {
    return { error: `抓取失败: ${e.message}` };
  }
}
```

### 6.5 自动记录教训（reflectLesson）

v4 的 reflect_lesson 移植到前端，对话结束后自动记录经验教训到本地。

```javascript
// ---------- 自动记录教训 ----------
function reflectLesson(category, lesson) {
  const lessons = JSON.parse(localStorage.getItem('ziyouniao-lessons') || '[]');
  lessons.push({ category, lesson: (lesson || '').slice(0, 500), time: new Date().toISOString() });
  localStorage.setItem('ziyouniao-lessons', JSON.stringify(lessons.slice(-100)));
  // 记忆面板由 renderMemoryPanel() 统一渲染
}

// 在 generateSummaryAndName() 里自动调（对话结束后）
// 在函数末尾加：
// reflectLesson('对话总结', summary.slice(0, 200));
```

在 soul.md 的规则里加一条（已在 5.9 中配置）。

### 6.6 自动 Git 快照（备份）

从 v4 移植的自动备份，启动后每小时 git commit + push 一次。

在 `electron/main.js` 的 `app.whenReady()` 末尾加：

```javascript
// 自动 Git 快照（启动后 10s + 每小时）
function gitSnapshot() {
  const { exec } = require('child_process');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const projectRoot = app.getAppPath(); // 使用 app.getAppPath() 而非 __dirname
  exec(`cd "${projectRoot}" && git add -A && git commit -m "snapshot: ${timestamp}" && git push`, {
    timeout: 30000,
  }, (err, stdout, stderr) => {
    if (err && !stderr?.includes('nothing to commit')) {
      console.error('[快照] 失败:', err.message);
    }
  });
}
setTimeout(gitSnapshot, 10000);
setInterval(gitSnapshot, 60 * 60 * 1000);
```

> ⚠️ **前提**：项目目录必须已初始化 Git 并关联 remote（`git init && git remote add origin ...`）。如果没有关联 remote，快照只在本地 commit，不会 push。
>
> `.gitignore` 已在第 2 天创建，会自动排除 `node_modules/`、`release/`、`.env`。

---

---

## 第5天（续）：具体实现

### P0 — 丝滑度（半天，40 行代码）

#### 5.1 对话自动滚动

在 app.js 的 `updateLastMessage` 函数末尾加：

```javascript
// 自动滚动到底部（恢复对话期间不跳）
if (!suppressAutoScroll) {
  const chatContainer = document.getElementById('messages');
  if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
}
```

#### 5.2 输入框 ↑ 历史记录

在 app.js 的 input 事件绑定处加：

```javascript
let inputHistory = [];
let historyIndex = -1;

document.getElementById('input').addEventListener('keydown', (e) => {
  const input = document.getElementById('input');
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (historyIndex === -1) {
      // 首次按↑，保存当前输入
      inputHistory.unshift(input.value);
      historyIndex = 0;
    }
    if (historyIndex < inputHistory.length - 1) {
      historyIndex++;
      input.value = inputHistory[historyIndex] || '';
    }
    // 光标移到末尾
    setTimeout(() => input.setSelectionRange(input.value.length, input.value.length));
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      input.value = inputHistory[historyIndex] || '';
    } else if (historyIndex === 0) {
      historyIndex = -1;
      input.value = '';
    }
  }
});

// 发送成功后记录当前输入到历史
// 在 sendMessage 开头，保存输入:
// inputHistory.unshift(text);
// if (inputHistory.length > 50) inputHistory.pop();
// historyIndex = -1;
```

#### 5.3 消息复制按钮

在 app.js 的 `addMessage` 函数中，给消息气泡加悬浮复制按钮：

```javascript
// 在 msg-div 内加复制按钮（在 .msg-text 之后）
copyBtn = document.createElement('button');
copyBtn.className = 'msg-copy';
copyBtn.innerHTML = '📋';
copyBtn.title = '复制消息';
copyBtn.onclick = () => {
  navigator.clipboard.writeText(text);
  copyBtn.innerHTML = '✅';
  setTimeout(() => { copyBtn.innerHTML = '📋'; }, 2000);
};
msgDiv.appendChild(copyBtn);
```

CSS 在 style.css 加：

```css
.msg { position: relative; }
.msg-copy {
  position: absolute; right: -4px; top: 0;
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer; font-size: 12px;
  padding: 2px 4px; opacity: 0; transition: opacity 0.2s;
  color: var(--t2); line-height: 1;
}
.msg:hover .msg-copy { opacity: 1; }
.msg.reverse .msg-copy { right: auto; left: -4px; }
```

#### 5.4 截断长对话

在 app.js 的 `sendMessage` 中，AI 回复完成后裁剪历史：

```javascript
// 在流结束后，历史 push 之前执行裁剪
const MAX_HISTORY = 50;
if (messages.length > MAX_HISTORY) {
  // 保留第1条（system prompt）+ 最近 MAX_HISTORY-2 条
  const systemMsg = messages[0]?.role === 'system' ? messages.shift() : null;
  messages = messages.slice(-(MAX_HISTORY - (systemMsg ? 1 : 0)));
  if (systemMsg) messages.unshift(systemMsg);
}
```

---

### P1 — 体验感（1 天，85 行代码）

#### 5.5 侧栏右键菜单

在 app.js 加：

```javascript
// 侧栏会话右键菜单
document.addEventListener('contextmenu', (e) => {
  const sessionItem = e.target.closest('.session-item');
  if (!sessionItem) return;
  e.preventDefault();
  // 移除旧菜单
  document.querySelector('.ctx-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <div class="ctx-item" data-action="rename">✏️ 重命名</div>
    <div class="ctx-item" data-action="export">📥 导出对话</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" data-action="delete" style="color:#faa;">🗑️ 删除</div>
  `;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);

  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.onclick = () => {
      // 根据 data-action 执行对应操作
      const action = item.dataset.action;
      if (action === 'delete') {
        if (confirm('确定删除这个对话？')) sessionItem.remove();
      } else if (action === 'rename') {
        const newName = prompt('新名称:', sessionItem.querySelector('.session-title')?.textContent);
        if (newName && sessionItem.querySelector('.session-title')) {
          sessionItem.querySelector('.session-title').textContent = newName;
        }
      } else if (action === 'export') {
        exportMarkdown();
      }
      menu.remove();
    };
  });
});

// 点击其他地方关闭菜单
document.addEventListener('click', () => {
  document.querySelector('.ctx-menu')?.remove();
});
```

CSS 加：

```css
.ctx-menu {
  position: fixed; z-index: 9999; background: var(--bg2);
  border: 1px solid var(--border); border-radius: 8px;
  min-width: 140px; padding: 4px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.ctx-item { padding: 8px 14px; font-size: 13px; cursor: pointer; color: var(--t1); }
.ctx-item:hover { background: rgba(255,255,255,0.04); }
.ctx-divider { height: 1px; background: var(--border); margin: 4px 0; }
```

#### 5.6 对话中停止按钮

在 app.js 加停止功能：

```javascript
let abortController = null; // 全局，用于中断 fetch

// 在 sendMessage 开头创建新的 AbortController
abortController = new AbortController();
// 把 fetch 的 options 加上 signal
// fetch(url, { ..., signal: abortController.signal })

// 显示停止按钮
document.getElementById('stopBtn').style.display = 'inline-block';

// 在 catch 块中处理 abort 错误
// catch (e) {
//   if (e.name === 'AbortError') {
//     console.log('用户停止了生成');
//     // 不报错，保留已输出的内容
//   } else {
//     showToast(`对话失败: ${e.message}`);
//   }
// }

// 无论成功/失败/中止，都隐藏停止按钮
// document.getElementById('stopBtn').style.display = 'none';
// abortController = null;
```

HTML 在输入框旁边加：

```html
<button id="stopBtn" style="display:none;" onclick="abortController?.abort()">■ 停止</button>
```

#### 5.7 跨会话搜索

在 app.js 加侧栏搜索逻辑：

```javascript
// 侧栏搜索框：过滤所有历史会话
document.getElementById('sidebarSearch')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.session-item').forEach(item => {
    const title = item.querySelector('.session-title')?.textContent?.toLowerCase() || '';
    item.style.display = title.includes(q) ? '' : 'none';
  });
});
```

HTML 侧栏搜索框：

```html
<div class="sb-search">
  <input id="sidebarSearch" type="text" placeholder="🔍 搜索历史对话...">
</div>
```

#### 5.8 状态指示器

在 app.js 加：

```javascript
// 定期检查 OpenClaw 连接状态
async function checkConnection() {
  const indicator = document.getElementById('statusIndicator');
  if (!indicator) return;
  try {
    const res = await fetch('http://localhost:18789/health', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      indicator.innerHTML = '🟢';
      indicator.title = '已连接 OpenClaw';
    } else throw new Error();
  } catch {
    indicator.innerHTML = '🔴';
    indicator.title = 'OpenClaw 未连接';
  }
}
// 每 30 秒检查一次
checkConnection();
setInterval(checkConnection, 30000);
```

HTML 顶栏加：

```html
<span id="statusIndicator" title="检查连接中..." style="font-size:14px;cursor:default;">⏳</span>
```

---

### P2 — 工作精细化（1 天，改造 soul.md + 10 行代码）

#### 5.9 任务分解执行 + 5.10 结果自验证

修改 `SOUL.md`，在规则里加入：

```markdown
## 工作流程

1. **复杂任务先拆步骤** — 超过 3 步的任务，先列出步骤清单，逐条执行。
   ```
   任务：分析此项目并优化
   步骤：
   ├─ 1/3 读取文件结构
   ├─ 2/3 识别性能瓶颈
   └─ 3/3 输出优化方案并应用
   ```
2. **每步完成后自验证** — 执行命令后检查：
   - 退出码是否为 0？
   - 输出中有没有 Error/Fail？
   - 结果是否符合预期？
   如果失败，先尝试修复，修复不了再报告。
3. **结果输出格式**：
   ```
   ┌─ 步骤 1/3 ─────────────────────┐
   │ 执行: ls project/               │
   │ 结果: 12 个文件                 │
   │ 状态: ✅ 通过                   │
   └────────────────────────────────┘
   ```
```

#### 5.11 API 自动重试

在 app.js 的 `sendMessage` 中，把 `fetch` 调用改为带重试的版本：

```javascript
// 只重试连接阶段，流式开始后不再重试（防止内容重复）
async function connectWithRetry(url, options, maxRetries = 2) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status < 500) return res; // 4xx 不重试
    } catch (e) {
      if (i === maxRetries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('连接失败');
}

// 在 sendMessage 里：
// const res = await connectWithRetry(...)  ← 只重试连接
// const reader = res.body.getReader()      ← 流式读取，断了就断了
```

---

## 常见问题

### Q1: 第1步 openclaw 报错说找不到命令

```bash
# Windows 重启终端再试
# macOS: 检查 ~/.bash_profile 或 ~/.zshrc 有没有 OpenClaw 的 PATH
export PATH="$HOME/.openclaw/bin:$PATH"
```

### Q2: Electron 窗口空白

```bash
# 先确认 OpenClaw 是否在运行
curl http://localhost:18789/health
# 如果没返回，手动启动 OpenClaw
openclaw serve --port 18789
# 然后再启动 Electron
npx electron .
```

### Q3: 对话发出去没有回复

```bash
# 检查 API Key 是否有效
curl https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY"
# 如果返回 401，去 DeepSeek 官网重新生成 Key
# 查看 OpenClaw 终端是否有错误日志
```

### Q4: gateway 启动失败 / SOUL.md 找不到

```bash
# 确认 SOUL.md 在正确位置
ls "C:\自由鸟\ziyouniao\SOUL.md"
# 确认 OpenClaw workspace 路径
openclaw workspace list
# 重新创建 workspace
openclaw workspace init --name ziyouniao --force
# 然后重新复制 SOUL.md
```

### Q5: 打包时报 `package.json main field not set`

```bash
# 在 package.json 中加入
"main": "electron/main.js"
```

### Q6: 打包后安装报毒

```bash
# 需要购买代码签名证书（EV 证书约 $300/年）
# 临时方案：在杀毒软件中添加排除项
# Windows Defender: 设置 → 病毒和威胁防护 → 排除项
```

### Q7: 安装后打开是空白窗口

```bash
# 按 F12 打开 DevTools Console，查看错误
# 最常见原因：openclaw CLI 没安装或不在 PATH
# 确认在终端能运行: openclaw --version
# 如果 CLI 没装，重新执行第1天的安装步骤
```
