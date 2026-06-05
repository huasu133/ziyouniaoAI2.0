const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');

// ─── 常量 ────────────────────────────────────────────────────────────────
const API_BASE = 'http://127.0.0.1:18789';
const GATEWAY_HEALTH_URL = API_BASE + '/health';
const GATEWAY_MAX_WAIT_MS = 10000;
const GATEWAY_POLL_MS = 500;

// ─── 状态 ────────────────────────────────────────────────────────────────
let mainWindow = null;
let gatewayProcess = null;
let isQuitting = false;

// ─── 辅函数 ──────────────────────────────────────────────────────────────

/**
 * 查找 openclaw 可执行文件路径
 * 依次尝试: which openclaw → ~/.openclaw/bin/openclaw → /usr/local/bin/openclaw
 * @returns {string|null}
 */
function findOpenClaw() {
  // 1. which openclaw (PATH 搜索)
  try {
    const whichResult = execSync('which openclaw', {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
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
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log('[main] Gateway health check response:', data);
          // P1-Bug #4: 验证 HTTP 状态码
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
 * 尝试结束网关进程
 */
function killGateway() {
  if (gatewayProcess) {
    try {
      console.log('[main] Killing gateway process PID:', gatewayProcess.pid);
      gatewayProcess.kill('SIGTERM');
      // 给进程2秒时间退出
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
      sandbox: false,
    },
    show: false,
  });

  // ─── P0-1: loadFile 而非 loadURL ─────────────────────────────────────
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // ─── P0-3: render-process-gone → 重新 loadFile ─────────────────────
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[main] Render process gone:', details.reason);
    if (!isQuitting) {
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
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
  console.log('[main] Save complete, now killing gateway');
  killGateway();
  app.quit();
});

/**
 * 获取教训记录（供渲染进程读取）
 */
ipcMain.handle('get-lessons', () => {
  const lessonsPath = path.join(app.getPath('userData'), 'zyn3-lessons.json');
  try {
    if (fs.existsSync(lessonsPath)) {
      return JSON.parse(fs.readFileSync(lessonsPath, 'utf8'));
    }
  } catch (_) {}
  return [];
});

/**
 * 保存教训记录
 */
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

/**
 * HTTP GET 请求（通过主进程避免CORS）
 */
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

  // ─── P0-12: npm start 自动拉 Gateway ────────────────────────────────
  const openclawPath = findOpenClaw();
  if (openclawPath) {
    console.log('[main] Starting OpenClaw gateway from:', openclawPath);
    gatewayProcess = spawn(openclawPath, ['serve'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    gatewayProcess.stdout.on('data', (data) => {
      console.log('[gateway stdout]', data.toString().trim());
    });

    gatewayProcess.stderr.on('data', (data) => {
      console.log('[gateway stderr]', data.toString().trim());
    });

    gatewayProcess.on('error', (err) => {
      console.error('[main] Failed to spawn openclaw:', err.message);
      gatewayProcess = null;
    });

    gatewayProcess.on('exit', (code, signal) => {
      console.log('[main] OpenClaw gateway exited with code', code, 'signal', signal);
      gatewayProcess = null;
    });

    // ─── P0-2: 等待网关就绪 ───────────────────────────────────────────
    const ready = await waitForGateway();
    if (ready) {
      console.log('[main] Gateway is ready');
    } else {
      console.error('[main] Gateway did not become ready in time');
      dialog.showErrorBox('网关启动失败', 'OpenClaw 网关未能及时启动，请检查 OpenClaw 安装。\n\n要求: 在终端运行 "openclaw serve" 可正常启动。');
    }
  } else {
    console.warn('[main] OpenClaw not found in PATH');
    dialog.showErrorBox('未找到 OpenClaw', '未找到 OpenClaw CLI 工具。\n\n请先安装: npm install -g @openclaw/cli\n或参考: https://openclaw.dev/docs/install');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// ─── P0-5: before-quit ──────────────────────────────────────────────────
app.on('before-quit', (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();

  console.log('[main] before-quit: saving all data');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('save-all');
    // 给渲染进程最多3秒保存
    setTimeout(() => {
      console.log('[main] Save timeout, proceeding with shutdown');
      killGateway();
      app.quit();
    }, 3000);
  } else {
    killGateway();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    killGateway();
    app.quit();
  }
});

app.on('will-quit', () => {
  killGateway();
});
