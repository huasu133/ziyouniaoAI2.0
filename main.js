const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const http = require('http');

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
const API_BASE = 'http://127.0.0.1:18789';
const GATEWAY_HEALTH_URL = API_BASE + '/health';
const GATEWAY_MAX_WAIT_MS = 10000;
const GATEWAY_POLL_MS = 500;

// ─── 状态 ────────────────────────────────────────────────────────────────
let mainWindow = null;
let gatewayProcess = null;
let isQuitting = false;
let _quitTimer = null;

// ─── CSP 策略说明 ────────────────────────────────────────────────────────
// CSP 策略在 src/index.html 的 <meta http-equiv="Content-Security-Policy">
// 中定义。当前策略:
//   default-src 'self'; script-src 'self' 'unsafe-inline';
//   style-src 'self' 'unsafe-inline'; connect-src http://127.0.0.1:18789
// 限制内容: 仅允许加载本地的脚本和样式，网络请求仅允许到本地网关。
// 若需放宽（如加载外部资源），请修改 index.html 中的 meta 标签。

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

    function poll() {
      const req = http.get(GATEWAY_HEALTH_URL, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString('utf8'); });
        res.on('end', () => {
          console.log('[main] Gateway health check response:', data);
          resolve(res.statusCode === 200);
        });
      });

      req.on('error', () => {
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
        const elapsed = Date.now() - startTime;
        if (elapsed >= GATEWAY_MAX_WAIT_MS) {
          console.error('[main] Gateway health check timed out');
          resolve(false);
        } else {
          setTimeout(poll, GATEWAY_POLL_MS);
        }
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
  const env = { ...process.env };
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

  // P0: gateway 崩溃自动重启
  proc.on('exit', (code, signal) => {
    console.log('[main] OpenClaw gateway exited with code', code, 'signal', signal);
    gatewayProcess = null;
    // 非正常退出时自动重启
    if (!isQuitting && code !== 0) {
      console.log('[main] Gateway crashed, attempting restart...');
      const p = startGateway(openclawPath);
      gatewayProcess = p;
      waitForGateway().then((ready) => {
        if (ready) {
          console.log('[main] Gateway restarted successfully');
        } else {
          console.error('[main] Gateway restart failed');
          dialog.showErrorBox('网关重启失败', 'OpenClaw 网关崩溃后重启失败。\n请检查终端运行 "openclaw serve" 是否正常。');
        }
      });
    }
  });

  return proc;
}

/**
 * 尝试结束网关进程
 */
function killGateway() {
  if (gatewayProcess) {
    try {
      console.log('[main] Killing gateway process PID:', gatewayProcess.pid);
      gatewayProcess.kill('SIGTERM');
      setTimeout(() => {
        if (gatewayProcess && !gatewayProcess.killed) {
          try {
            gatewayProcess.kill('SIGKILL');
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

  // P0: loadFile 加错误处理
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
    if (!isQuitting) {
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))
              .catch(function (err) {
                console.error('[main] Failed to reload after render crash:', err.message);
              });
          }
        } catch (err) {
          console.error('[main] Failed to reload after render crash:', err.message);
        }
      }, 1000);
    }
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
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    }).on('error', (err) => {
      resolve({ status: 0, data: null, error: err.message });
    });
  });
});

// ─── 应用生命周期 ────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();

  const openclawPath = await findOpenClaw();
  if (openclawPath) {
    gatewayProcess = startGateway(openclawPath);

    const ready = await waitForGateway();
    if (ready) {
      console.log('[main] Gateway is ready');
    } else {
      console.error('[main] Gateway did not become ready in time');
      dialog.showErrorBox('网关启动失败', 'OpenClaw 网关未能及时启动，请检查 OpenClaw 安装。\n\n要求: 在终端运行 "openclaw serve" 可正常启动。');
      // P1: 网关未就绪则退应用，不继续运行空壳
      app.quit();
      return;
    }
  } else {
    console.warn('[main] OpenClaw not found in PATH');
    dialog.showErrorBox('未找到 OpenClaw', '未找到 OpenClaw CLI 工具。\n\n请先安装: npm install -g @openclaw/cli\n或参考: https://openclaw.dev/docs/install');
    app.quit();
    return;
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
    }, 3000);
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
  killGateway();
});
