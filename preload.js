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
  saveLessons: (lessons) => ipcRenderer.invoke('save-lessons', lessons),

  /**
   * HTTP GET 请求（通过主进程转发，避免 CORS 限制）
   * @param {string} url
   * @returns {Promise<{status: number, data: string|null, error?: string}>}
   */
  httpGet: (url) => ipcRenderer.invoke('http-get', url),

  /**
   * 保存所有数据（响应 before-quit）
   */
  onSaveAll: (callback) => {
    ipcRenderer.on('save-all', () => {
      callback();
    });
  },

  /**
   * 通知主进程保存完成
   */
  saveAllComplete: () => {
    ipcRenderer.send('save-all-complete');
  },
});
