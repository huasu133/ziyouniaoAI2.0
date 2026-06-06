const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const http = require('http');
const https = require('https');

const execFileAsync = promisify(execFile);

// ─── P0: 防多开 ─────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── 常量 ────────────────────────────────────────────────────────────────
const API_BASE = 'http://127.0.0.1:18789'; // 本地网关，无需HTTPS
const GATEWAY_HEALTH_URL = API_BASE + '/health';
const GATEWAY_MAX_WAIT_MS = 10000;
const GATEWAY_POLL_MS = 500;
const QUIT_TIMEOUT_MS = 5000; // P1-5: 退出超时常量，避免硬编码

// ─── 状态 ────────────────────────────────────────────────────────────────
let mainWindow = null;
let gatewayProcess = null;
let isQuitting = false;
let _quitTimer = null;
let _restartCount = 0;
let _restartWindowStart = 0;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60000;
let _renderCrashCount = 0;
let _renderCrashWindowStart = 0;
const MAX_RENDER_CRASHES = 3;
const RENDER_CRASH_WINDOW_MS = 30000;
let tray = null;
let _gitSnapshotTimer = null;

// ─── CSP 策略说明 ────────────────────────────────────────────────────────
// CSP 策略在 src/index.html 的 <meta http-equiv="Content-Security-Policy">
// 中定义。实际策略:
//   default-src 'self'; script-src 'self' 'unsafe-inline';
//   style-src 'self' 'unsafe-inline';
//   connect-src http://127.0.0.1:18789 https://www.claw-search.com;
//   img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self';
// 说明: Tavily/Serper 域名已从 connect-src 移除（P1-1），搜索请求通过 IPC 代理。
//       Claw 免费搜索仍保留在 connect-src 因为其直接通过浏览器 fetch 调用。
//       unsafe-inline 因架构约束保留。
// 若需进一步放宽，请修改 index.html 中的 meta 标签。

// ─── 辅函数 ──────────────────────────────────────────────────────────────

/**
 * 查找 openclaw 可执行文件路径（异步版）
 * 依次尝试: which openclaw → ~/.openclaw/bin/openclaw → ~/.local/bin/openclaw
 *           → /usr/local/bin/openclaw → /opt/homebrew/bin/openclaw → /usr/bin/openclaw
 * @returns {Promise<string|null>}
 */
async function findOpenClaw() {
  // 1. which openclaw (异步 execFile)
  try {
    const { stdout } = await execFileAsync('which', ['openclaw'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    const whichResult = stdout.trim();
    if (whichResult && fs.existsSync(whichResult)) {
      console.log('[main] Found openclaw via which:', whichResult);
      return whichResult;
    }
  } catch (_) {
    // which 失败，继续尝试
  }

  // 2. 硬编码候选路径
  const homeDir = os.homedir();
  const candidates = [
    path.join(homeDir, '.openclaw', 'bin', 'openclaw'),
    path.join(homeDir, '.local', 'bin', 'openclaw'),
    '/usr/local/bin/openclaw',
    '/opt/homebrew/bin/openclaw',
    '/usr/bin/openclaw',
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        console.log('[main] Found openclaw at candidate path:', candidate);
        return candidate;
      }
    } catch (_) {
      // 忽略
    }
  }

  return null;
}

/**
 * 轮询 /health 端点检查网关是否就绪
 * @returns {Promise<boolean>}
 */
function waitForGateway() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let _polling = false; // 防双重轮询

    function poll() {
      if (_polling) return;
      _polling = true;
      // P1-4: 独立超时，防止TCP连接hang导致_polling永久true
      setTimeout(function() { _polling = false; }, 5000);
      const req = http.get(GATEWAY_HEALTH_URL, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString('utf8'); });
        res.on('end', () => {
          _polling = false;
          console.log('[main] Gateway health check response:', data);
          resolve(res.statusCode === 200);
        });
      });

      req.on('error', () => {
        _polling = false;
        const elapsed = Date.now() - startTime;
        if (elapsed >= GATEWAY_MAX_WAIT_MS) {
          console.error('[main] Gateway health check timed out after', elapsed, 'ms');
          resolve(false);
        } else {
          setTimeout(poll, GATEWAY_POLL_MS);
        }
      });

      req.setTimeout(2000, () => {
        req.destroy();
        // 不要在这里调 poll —— error 事件会处理（因为 destroy 会触发 error）
      });
    }

    poll();
  });
}

/**
 * 启动网关子进程
 * @param {string} openclawPath
 * @returns {ChildProcess}
 */
function startGateway(openclawPath) {
  // P1: macOS GUI PATH 扩展
  const homeDir = os.homedir();
  const env = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || homeDir,
    USER: process.env.USER || '',
  };
  const extraPaths = [
    path.join(homeDir, '.openclaw', 'bin'),
    path.join(homeDir, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const currentPath = env.PATH || '';
  env.PATH = [...extraPaths, currentPath].filter(Boolean).join(path.delimiter);

  console.log('[main] Starting OpenClaw gateway from:', openclawPath);
  const proc = spawn(openclawPath, ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env,
  });

  proc.stdout.on('data', (data) => {
    console.log('[gateway stdout]', data.toString().trim());
  });

  proc.stderr.on('data', (data) => {
    console.log('[gateway stderr]', data.toString().trim());
  });

  proc.on('error', (err) => {
    console.error('[main] Failed to spawn openclaw:', err.message);
    gatewayProcess = null;
  });

  // P0: gateway 崩溃自动重启（带次数限制）
  proc.on('exit', (code, signal) => {
    console.log('[main] OpenClaw gateway exited with code', code, 'signal', signal);
    gatewayProcess = null;
    if (!isQuitting && code !== 0) {
      const now = Date.now();
      if (now - _restartWindowStart > RESTART_WINDOW_MS) {
        _restartCount = 0;
        _restartWindowStart = now;
      }
      _restartCount++;
      if (_restartCount > MAX_RESTARTS) {
        console.error('[main] Gateway crashed too many times, giving up');
        dialog.showErrorBox('网关异常', 'OpenClaw 网关反复崩溃（60秒内崩溃超过3次）。\n请检查配置或手动运行 "openclaw serve" 排查。');
        return;
      }
      console.log('[main] Gateway crashed, attempting restart (', _restartCount, '/', MAX_RESTARTS, ')...');
      const delay = Math.min(3000 * Math.pow(2, _restartCount - 1), 60000);
      setTimeout(function () {
        if (isQuitting) return;
        const p = startGateway(openclawPath);
        gatewayProcess = p;
        waitForGateway().then(function (ready) {
          if (ready) {
            console.log('[main] Gateway restarted successfully');
            _restartCount = 0;
          } else {
            console.error('[main] Gateway restart failed');
          }
        });
      }, delay);
    }
  });

  return proc;
}

/**
 * 尝试结束网关进程
 */
function killGateway() {
  var procToKill = gatewayProcess; // 捕获当前引用，防闭包过期
  if (procToKill) {
    try {
      console.log('[main] Killing gateway process PID:', procToKill.pid);
      procToKill.kill('SIGTERM');
      setTimeout(function () {
        if (procToKill && !procToKill.killed) {
          try {
            procToKill.kill('SIGKILL');
          } catch (_) {}
        }
      }, 2000);
    } catch (err) {
      console.error('[main] Failed to kill gateway:', err.message);
    }
    gatewayProcess = null;
  }
}

// ─── 统一退出逻辑 ────────────────────────────────────────────────────────

/**
 * 快速检查网关健康状态（用于热启动检测）
 * @returns {Promise<boolean>}
 */
function healthCheck() {
  return new Promise((resolve) => {
    var req = http.get(GATEWAY_HEALTH_URL, function (res) {
      resolve(res.statusCode === 200);
    });
    req.on('error', function () {
      resolve(false);
    });
    req.setTimeout(2000, function () {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 统一退出: 先杀网关，再退应用
 * save-all-complete IPC 和 before-quit timeout 都走这个入口，避免竞态
 */
function doFinalQuit() {
  if (_quitTimer) {
    clearTimeout(_quitTimer);
    _quitTimer = null;
  }
  killGateway();
  app.quit();
}

// ─── 窗口创建 ────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '自由鸟AI',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  // P0: loadFile 加错误处理 + 失败时显示窗口
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))
    .catch(function (err) {
      console.error('[main] Failed to load index.html:', err.message);
      dialog.showErrorBox('加载失败', 'UI文件损坏或缺失');
    });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[main] Render process gone:', details.reason);
    if (isQuitting) return;

    // P0: 崩溃次数限制，防无限重启循环
    var now = Date.now();
    if (now - _renderCrashWindowStart > RENDER_CRASH_WINDOW_MS) {
      _renderCrashCount = 0;
      _renderCrashWindowStart = now;
    }
    _renderCrashCount++;

    if (_renderCrashCount > MAX_RENDER_CRASHES) {
      console.error('[main] Render crashed too many times, giving up');
      dialog.showErrorBox('界面崩溃', '渲染进程反复崩溃（30秒内超过3次）。\n请重启应用。');
      isQuitting = true;
      doFinalQuit();
      return;
    }

    if (details.reason === 'launch-failed') {
      dialog.showErrorBox('启动失败', '渲染进程启动失败，请检查UI文件完整性。');
      isQuitting = true;
      doFinalQuit();
      return;
    }

    if (details.reason === 'oom') {
      dialog.showErrorBox('内存不足', '渲染进程因内存不足被终止。\n请关闭部分对话标签后重试。');
      isQuitting = true;
      doFinalQuit();
      return;
    }

    // crashed / killed: 尝试恢复
    setTimeout(function () {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))
            .catch(function (err) {
              console.error('[main] Failed to reload after render crash:', err.message);
            });
        }
      } catch (err) {
        console.error('[main] Failed to reload after render crash:', err.message);
      }
    }, 1000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC ─────────────────────────────────────────────────────────────────

ipcMain.on('save-all-complete', () => {
  console.log('[main] Save complete, proceeding with shutdown');
  // 统一的退出入口，避免和 before-quit timeout 竞态
  doFinalQuit();
});

ipcMain.handle('get-lessons', () => {
  const lessonsPath = path.join(app.getPath('userData'), 'zyn3-lessons.json');
  try {
    if (fs.existsSync(lessonsPath)) {
      return JSON.parse(fs.readFileSync(lessonsPath, 'utf8'));
    }
  } catch (_) {}
  return [];
});

ipcMain.handle('save-lessons', (_event, lessons) => {
  // P1-3: 类型与大小校验
  if (!Array.isArray(lessons) || lessons.length > 1000) return false;
  const lessonsPath = path.join(app.getPath('userData'), 'zyn3-lessons.json');
  try {
    fs.writeFileSync(lessonsPath, JSON.stringify(lessons, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[main] Failed to save lessons:', err.message);
    return false;
  }
});

ipcMain.handle('http-get', async (_event, url) => {
  // P0: 使用 URL 构造函数精确校验 hostname+port，防止 startsWith 绕过
  var parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    console.error('[main] http-get blocked URL (parse error):', url);
    return { status: 0, data: null, error: 'URL not allowed' };
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '18789') {
    console.error('[main] http-get blocked URL:', url);
    return { status: 0, data: null, error: 'URL not allowed' };
  }
  return new Promise((resolve) => {
    var req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        // P1-1: 1MB 响应体大小限制
        if (data.length >= 1_000_000) {
          req.destroy();
          resolve({ status: 0, data: null, error: 'Response too large (>1MB)' });
        }
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', (err) => {
      resolve({ status: 0, data: null, error: err.message });
    });
    req.setTimeout(10000, function () {
      req.destroy();
      resolve({ status: 0, data: null, error: 'Request timeout' });
    });
  });
});

// P0-3: fetch-url IPC handler — 代理任意URL HTTP请求（用于fetchURL），带超时和大小限制
ipcMain.handle('fetch-url', async (_event, url) => {
  // P0-3: SSRF 防护 — 只允许已知域名
  try {
    var parsed = new URL(url);
    var allowed = ['www.claw-search.com', 'api.tavily.com', 'google.serper.dev'];
    if (allowed.indexOf(parsed.hostname) === -1) {
      return { status: 0, data: null, error: 'URL not allowed: ' + parsed.hostname };
    }
  } catch (_) { return { status: 0, data: null, error: 'Invalid URL' }; }

  return new Promise((resolve) => {
    var protocol = url.startsWith('https:') ? 'https:' : 'http:';
    var lib = protocol === 'https:' ? https : http;
    var req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ziyouniao/3.0)' } }, function (res) {
      let data = '';
      res.on('data', function (chunk) {
        data += chunk;
        if (data.length >= 1_000_000) {
          req.destroy();
          resolve({ status: 0, data: null, error: 'Response too large (>1MB)' });
        }
      });
      res.on('end', function () {
        var title = '';
        var match = data.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match) title = match[1];
        var cleaned = data.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        resolve({ status: res.statusCode, data: cleaned.slice(0, 5000), title: title });
      });
    });
    req.on('error', function (err) {
      resolve({ status: 0, data: null, error: err.message });
    });
    req.setTimeout(10000, function () {
      req.destroy();
      resolve({ status: 0, data: null, error: 'Request timeout' });
    });
  });
});

// ─── P0-1: 搜索 API Key 加密存储 ──────────────────────────────────────
const ENCRYPTED_KEYS_FILE = 'zyn3-encrypted-keys.bin';

ipcMain.handle('save-search-key', async (_event, name, value) => {
  try {
    const filePath = path.join(app.getPath('userData'), ENCRYPTED_KEYS_FILE);
    let keys = {};
    // 读取现有加密数据
    if (fs.existsSync(filePath)) {
      const encrypted = fs.readFileSync(filePath);
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(encrypted);
        keys = JSON.parse(decrypted);
      } else {
        const decrypted = encrypted.toString('utf8');
        keys = JSON.parse(decrypted);
      }
    }
    // 更新 key
    keys[name] = value;
    // 写回加密
    const data = JSON.stringify(keys);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(filePath, safeStorage.encryptString(data));
    } else {
      fs.writeFileSync(filePath, data, 'utf8');
    }
    return { success: true };
  } catch (err) {
    console.error('[main] save-search-key failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-search-keys', async () => {
  try {
    const filePath = path.join(app.getPath('userData'), ENCRYPTED_KEYS_FILE);
    if (!fs.existsSync(filePath)) return {};
    const encrypted = fs.readFileSync(filePath);
    let decrypted;
    if (safeStorage.isEncryptionAvailable()) {
      decrypted = safeStorage.decryptString(encrypted);
    } else {
      decrypted = encrypted.toString('utf8');
    }
    return JSON.parse(decrypted);
  } catch (err) {
    console.error('[main] get-search-keys failed:', err.message);
    return {};
  }
});

// ─── P1-5: 搜索 API 走 IPC 代理 ──────────────────────────────────────
ipcMain.handle('search-web', async (_event, engine, query, apiKey) => {
  try {
    let url, options;
    if (engine === 'tavily') {
      url = 'https://api.tavily.com/search';
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
      };
    } else if (engine === 'serper') {
      url = 'https://google.serper.dev/search';
      options = {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      };
    } else {
      return { error: 'Unknown engine: ' + engine };
    }

    return new Promise((resolve) => {
      const lib = url.startsWith('https:') ? https : http;
      const urlObj = new URL(url);
      const req = lib.request(urlObj, options, function (res) {
        let data = '';
        res.on('data', function (chunk) {
          data += chunk;
          if (data.length >= 1_000_000) {
            req.destroy();
            resolve({ error: 'Response too large' });
          }
        });
        res.on('end', function () {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            resolve({ error: 'Invalid JSON response' });
          }
        });
      });
      req.on('error', function (err) {
        resolve({ error: err.message });
      });
      req.setTimeout(10000, function () {
        req.destroy();
        resolve({ error: 'Request timeout' });
      });
      // 写入 body（POST 请求）
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  } catch (err) {
    return { error: err.message };
  }
});

// P2: 打开数据目录（用于"打开文件夹"功能）
ipcMain.handle('open-data-folder', async () => {
  const dataPath = app.getPath('userData');
  try {
    await shell.openPath(dataPath);
    return { success: true };
  } catch (err) {
    console.error('[main] Failed to open data folder:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── 应用生命周期 ────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();

  // P2-2: findOpenClaw 加 15s 总超时
  const openclawPath = await Promise.race([
    findOpenClaw(),
    new Promise(function (resolve) {
      setTimeout(function () { resolve(null); }, 15000);
    }),
  ]);

  // P0-1: 热启动检测——如果已有网关运行，跳过 spawn 新进程
  var gatewayAlreadyRunning = false;
  if (openclawPath) {
    var health = await healthCheck();
    if (health) {
      console.log('[main] Gateway already running (hot start), skipping spawn');
      gatewayAlreadyRunning = true;
    }
  }

  if (openclawPath && !gatewayAlreadyRunning) {
    gatewayProcess = startGateway(openclawPath);
  }

  if (openclawPath) {
    const ready = await waitForGateway();
    if (ready) {
      console.log('[main] Gateway is ready');
    } else {
      console.warn('[main] Gateway did not become ready — UI will show with error');
      // 不退出，让UI显示网关错误横幅，用户可进入设置
    }
  } else {
    console.warn('[main] OpenClaw not found — UI will show with error');
    dialog.showErrorBox('未找到 OpenClaw', 'OpenClaw CLI 工具未找到。\n请先安装并配置。\n\n安装: curl -fsSL https://openclaw.ai/install.sh | bash\n配置: openclaw onboard');
    // 不退出，让UI继续加载
  }

  // ─── 托盘 ──────────────────────────────────────────
  // P2-3: 优先从文件加载图标，文件不存在时回退到内嵌 DataURL
  var iconPath = path.join(__dirname, 'assets', 'icon.png');
  var trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('Icon file is empty');
  } catch (_) {
    trayIcon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGPI8f3/nxLMMGrAqAGjBgwXAwDZLrcfg17eUgAAAABJRU5ErkJggg=='
    );
  }
  try {
    tray = new Tray(trayIcon.resize({ width: 32, height: 32 }));
    tray.setToolTip('自由鸟AI');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示自由鸟', click: function () { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: '退出', click: function () { app.quit(); } },
    ]));
    tray.on('click', function () { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (_) { console.log('[main] Tray not available'); }

  // ─── Git 快照（启动后 10s + 每小时）─ commit + push(如有remote)
  function gitSnapshot() {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var dir = path.join(__dirname);
    // 使用 execFile 避免 shell 命令注入，清代理防 SSL 错误
    var gitEnv = Object.assign({}, process.env, { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' });
    execFile('git', ['-C', dir, 'add', '-A'], { timeout: 10000, env: gitEnv }, function (err) {
      if (err) { console.error('[快照] git add 失败:', err.message); return; }
      execFile('git', ['-C', dir, 'diff', '--cached', '--quiet'], { timeout: 10000, env: gitEnv }, function (err2) {
        if (!err2) { /* 无变更，跳过 */ return; }
        execFile('git', ['-C', dir, 'commit', '-m', 'snapshot: ' + ts], { timeout: 30000, env: gitEnv }, function (err3) {
          if (err3) { console.error('[快照] commit 失败:', err3.message); return; }
          // 如有 remote 则 push，否则仅本地 commit
          execFile('git', ['-C', dir, 'push'], { timeout: 30000, env: gitEnv }, function () { /* 静默 */ });
        });
      });
    });
  }
  setTimeout(gitSnapshot, 10000);
  _gitSnapshotTimer = setInterval(gitSnapshot, 60 * 60 * 1000);

  // ─── 全局快捷键 Alt+Space ────────────────────────
  try {
    globalShortcut.register('Alt+Space', function () {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (err) {
    console.error('[main] Failed to register global shortcut:', err.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();

  console.log('[main] before-quit: saving all data');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('save-all');
    // 给渲染进程最多3秒保存，save-all-complete 会提前触发 doFinalQuit
    _quitTimer = setTimeout(() => {
      console.log('[main] Save timeout, proceeding with shutdown');
      doFinalQuit();
    }, QUIT_TIMEOUT_MS);
  } else {
    doFinalQuit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    doFinalQuit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (_gitSnapshotTimer) { clearInterval(_gitSnapshotTimer); _gitSnapshotTimer = null; }
  if (tray) { tray.destroy(); tray = null; }
});
