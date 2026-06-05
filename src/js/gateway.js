/**
 * gateway.js — 网关状态检查
 * 命名空间: window.ZYN3.Gateway
 */
(function () {
  'use strict';

  const GATEWAY_URL = 'http://127.0.0.1:18789';

  const Gateway = {
    /**
     * 当前状态
     */
    status: 'unknown', // 'online' | 'offline' | 'unknown'

    /**
     * 检查网关健康状态
     * @returns {Promise<boolean>}
     */
    checkHealth: function () {
      return fetch(GATEWAY_URL + '/health', {
        method: 'GET',
        mode: 'cors',
        signal: AbortSignal.timeout(3000),
      })
        .then(function (res) {
          if (res.ok) {
            Gateway.status = 'online';
            return true;
          }
          Gateway.status = 'offline';
          return false;
        })
        .catch(function () {
          Gateway.status = 'offline';
          return false;
        });
    },

    /**
     * 获取网关状态字符串
     * @returns {string}
     */
    getStatusText: function () {
      switch (Gateway.status) {
        case 'online': return '已连接';
        case 'offline': return '未连接';
        default: return '检测中...';
      }
    },

    /**
     * 更新 UI 中的状态指示
     */
    updateUI: function () {
      const dot = document.querySelector('.status-dot');
      if (dot) {
        dot.className = 'status-dot';
        if (Gateway.status === 'online') {
          dot.classList.add('online');
        } else if (Gateway.status === 'offline') {
          dot.classList.add('offline');
        }
      }

      // 设置面板中的状态
      const statusEl = document.getElementById('settings-gateway-status');
      if (statusEl) {
        statusEl.textContent = Gateway.getStatusText();
        statusEl.style.color = Gateway.status === 'online'
          ? 'var(--green)'
          : 'var(--t3)';
      }
    },

    /**
     * 周期性检查网关状态
     */
    startPolling: function (intervalMs) {
      if (intervalMs === undefined) intervalMs = 30000;

      // P2: 清理已有定时器，防止重复轮询
      this.stopPolling();

      Gateway.checkHealth().then(function () {
        Gateway.updateUI();
      });

      Gateway._pollTimer = setInterval(function () {
        Gateway.checkHealth().then(function () {
          Gateway.updateUI();
        });
      }, intervalMs);
    },

    /**
     * 停止轮询
     */
    stopPolling: function () {
      if (Gateway._pollTimer) {
        clearInterval(Gateway._pollTimer);
        Gateway._pollTimer = null;
      }
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Gateway = Gateway;
})();
