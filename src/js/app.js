/**
 * app.js — 应用入口
 * 命名空间: window.ZYN3.App
 * 最后加载，负责初始化所有模块并绑定全局事件
 */
(function () {
  'use strict';

  var Utils = window.ZYN3.Utils;
  var Storage = window.ZYN3.Storage;
  var Gateway = window.ZYN3.Gateway;
  var API = window.ZYN3.API;
  var Chat = window.ZYN3.Chat;
  var Tabs = window.ZYN3.Tabs;
  var Sidebar = window.ZYN3.Sidebar;
  var Settings = window.ZYN3.Settings;
  var ContextMenu = window.ZYN3.ContextMenu;

  var App = {
    /**
     * 应用初始化
     */
    init: function () {
      console.log('[App] Initializing 自由鸟AI 3.0...');

      // 1. 加载设置并应用主题
      Settings.init();

      // 2. 初始化聊天引擎
      Chat.init();

      // 3. 初始化标签
      Tabs.init();

      // 4. 初始化侧栏
      Sidebar.init();

      // 5. 初始化右键菜单
      ContextMenu.init();

      // 6. 网关状态检查
      Gateway.startPolling(30000);

      // 7. 绑定全局 UI 事件
      this._bindEvents();

      // 8. 注册退出保存
      this._registerBeforeQuit();

      console.log('[App] Initialization complete');
    },

    /**
     * 绑定全局 UI 事件
     */
    _bindEvents: function () {
      var self = this;

      // ─── 侧栏切换 ──────────────────────────────────
      var sidebarToggle = document.getElementById('btn-sidebar-toggle');
      if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
          Sidebar.toggle();
        });
      }

      // ─── 新建对话 ──────────────────────────────────
      var newChatBtn = document.getElementById('btn-new-chat');
      if (newChatBtn) {
        newChatBtn.addEventListener('click', function () {
          Tabs.createTab();
          Sidebar.render();
        });
      }

      // ─── 设置按钮 ──────────────────────────────────
      var settingsBtn = document.getElementById('btn-settings');
      if (settingsBtn) {
        settingsBtn.addEventListener('click', function () {
          Settings.toggle();
        });
      }

      // 关闭设置
      var closeSettingsBtn = document.getElementById('btn-close-settings');
      if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', function () {
          Settings.close();
        });
      }

      // ─── 发送按钮 ──────────────────────────────────
      var sendBtn = document.getElementById('btn-send');
      if (sendBtn) {
        sendBtn.addEventListener('click', function () {
          Chat.sendMessage();
          // 更新侧栏（对话更新）
          Sidebar.render();
        });
      }

      // ─── 停止按钮 ──────────────────────────────────
      var stopBtn = document.getElementById('btn-stop');
      if (stopBtn) {
        stopBtn.addEventListener('click', function () {
          Chat.stopGeneration();
        });
      }

      // ─── 输入框事件 ────────────────────────────────
      var input = document.getElementById('message-input');
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            Chat.sendMessage();
            Sidebar.render();
          }
        });

        input.addEventListener('input', function () {
          Utils.autoResizeTextarea(input);
        });

        // 焦点自动滚动到底部
        input.addEventListener('focus', function () {
          Chat.scrollToBottom();
        });
      }

      // ─── 模型选择 ──────────────────────────────────
      var modelSelect = document.getElementById('model-select');
      if (modelSelect) {
        modelSelect.addEventListener('change', function () {
          var settings = Storage.getSettings();
          settings.model = modelSelect.value;
          Storage.setSettings(settings);
        });
      }

      // ─── 欢迎页模型按钮 ────────────────────────────
      var modelBtns = document.querySelectorAll('.model-btn');
      modelBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var model = btn.getAttribute('data-model');
          if (model) {
            Chat.switchModel(model);
            // 聚焦输入框
            var msgInput = document.getElementById('message-input');
            if (msgInput) msgInput.focus();
          }
        });
      });

      // ─── 网关状态按钮 ──────────────────────────────
      var gatewayBtn = document.getElementById('btn-gateway-status');
      if (gatewayBtn) {
        gatewayBtn.addEventListener('click', function () {
          Gateway.checkHealth().then(function () {
            Gateway.updateUI();
            var status = Gateway.getStatusText();
            self.showToast('网关状态: ' + status, Gateway.status === 'online' ? 'success' : 'error');
          });
        });
      }

      // ─── 清空会话 ──────────────────────────────────
      var clearBtn = document.getElementById('btn-clear-conversations');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          Sidebar.clearAll();
        });
      }

      // ─── 快捷键 ────────────────────────────────────
      document.addEventListener('keydown', function (e) {
        // Cmd/Ctrl + K: 聚焦侧栏搜索（暂无搜索，聚焦侧栏）
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          Sidebar.expand();
        }

        // Cmd/Ctrl + N: 新建对话
        if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
          e.preventDefault();
          Tabs.createTab();
          Sidebar.render();
        }

        // Cmd/Ctrl + ,: 设置
        if ((e.metaKey || e.ctrlKey) && e.key === ',') {
          e.preventDefault();
          Settings.toggle();
        }

        // Escape: 关闭设置
        if (e.key === 'Escape') {
          if (Settings.visible) {
            Settings.close();
          }
        }
      });
    },

    /**
     * 注册退出前保存
     */
    _registerBeforeQuit: function () {
      if (window.electronAPI && window.electronAPI.onSaveAll) {
        window.electronAPI.onSaveAll(function () {
          console.log('[App] Received save-all from main process');
          Storage.saveAll();
          if (window.electronAPI.saveAllComplete) {
            window.electronAPI.saveAllComplete();
          }
        });
      }
    },

    /**
     * 显示 Toast 通知
     * @param {string} message
     * @param {string} type - 'success' | 'error' | 'info'
     * @param {number} duration
     */
    showToast: function (message, type, duration) {
      if (type === undefined) type = 'info';
      if (duration === undefined) duration = 3000;

      var self = this;
      var container = document.getElementById('toast-container');
      if (!container) return;

      var toast = document.createElement('div');
      toast.className = 'toast ' + type;

      var iconSvg = '';
      if (type === 'success') {
        iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      } else if (type === 'error') {
        iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      } else {
        iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
      }

      toast.innerHTML = '' +
        '<span class="toast-icon">' + iconSvg + '</span>' +
        '<span class="toast-text">' + Utils.escapeHTML(message) + '</span>' +
        '<button class="toast-close">✕</button>';

      container.appendChild(toast);

      var closeBtn = toast.querySelector('.toast-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          self._removeToast(toast);
        });
      }

      // 自动关闭
      setTimeout(function () {
        self._removeToast(toast);
      }, duration);
    },

    /**
     * 移除 Toast
     */
    _removeToast: function (toast) {
      if (!toast || !toast.parentNode) return;
      toast.classList.add('out');
      setTimeout(function () {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 200);
    },

    /**
     * 导出数据（由设置面板调用）
     */
    exportData: function () {
      Settings._exportData();
    },

    /**
     * 导入数据（由设置面板调用）
     */
    importData: function () {
      Settings._importData();
    },
  };

  // 将 App 暴露到全局
  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.App = App;

  // DOM Ready 后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      App.init();
    });
  } else {
    App.init();
  }
})();
