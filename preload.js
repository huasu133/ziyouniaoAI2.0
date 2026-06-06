const { contextBridge, ipcRenderer } = require('electron');

/**
 * preload.js — 安全桥接
 * 通过 window.electronAPI 暴露有限的 IPC 接口给渲染进程
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 获取教训记录
   * @returns {Promise<Array>}
   */
  getLessons: () => ipcRenderer.invoke('get-lessons'),

  /**
   * 保存教训记录
   * @param {Array} lessons
   * @returns {Promise<boolean>}
   */
  saveLessons: (lessons) => {
    if (!Array.isArray(lessons) || lessons.length > 1000) throw new Error('Invalid lessons data');
    return ipcRenderer.invoke('save-lessons', lessons);
  },

  /**
   * HTTP GET 请求（通过主进程转发，避免 CORS 限制）
   * @param {string} url
   * @returns {Promise<{status: number, data: string|null, error?: string}>}
   */
  httpGet: (url) => ipcRenderer.invoke('http-get', url),

  /**
   * 任意 URL 抓取（通过主进程 IPC 代理，含10s超时和1MB限制）
   * @param {string} url
   * @returns {Promise<{status: number, data: string|null, title?: string, error?: string}>}
   */
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),

  /**
   * 保存搜索 API Key（加密存储）
   * @param {string} name - key 名称（如 tavily, serper）
   * @param {string} value - key 值
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveSearchKey: (name, value) => ipcRenderer.invoke('save-search-key', name, value),

  /**
   * 获取所有搜索 API Key
   * @returns {Promise<{tavily?: string, serper?: string}>}
   */
  getSearchKeys: () => ipcRenderer.invoke('get-search-keys'),

  /**
   * 通过主进程代理搜索请求
   * @param {string} engine - 'tavily' | 'serper'
   * @param {string} query - 搜索查询
   * @param {string} apiKey - 对应引擎的 API Key
   * @returns {Promise<Object>}
   */
  searchWeb: (engine, query, apiKey) => ipcRenderer.invoke('search-web', engine, query, apiKey),

  /**
   * 保存所有数据（响应 before-quit）
   * @returns {Function} unsubscribe - 调用以移除监听
   */
  onSaveAll: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = () => callback();
    ipcRenderer.on('save-all', handler);
    return () => {
      ipcRenderer.removeListener('save-all', handler);
    };
  },

  /**
   * 打开数据目录（在文件管理器中显示）
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),

  /**
   * 读取专家 SOUL 文件
   * @param {string} fileName - 文件名（如 architect.soul.md）
   * @returns {Promise<{success: boolean, content?: string, error?: string}>}
   */
  readExpertFile: (fileName) => ipcRenderer.invoke('read-expert-file', fileName),

  /**
   * 通知主进程保存完成
   */
  saveAllComplete: () => {
    ipcRenderer.send('save-all-complete');
  },
});
