/**
 * settings.js — 设置面板
 * P0-13: 无 API Key 字段，提示去 OpenClaw CLI 配置
 * 命名空间: window.ZYN3.Settings
 */
(function () {
  'use strict';

  var Storage = window.ZYN3.Storage;
  var Gateway = window.ZYN3.Gateway;

  var Settings = {
    /**
     * 设置面板是否可见
     */
    visible: false,

    _themeTimer: null,

    /**
     * 初始化
     */
    init: function () {
      this._loadSettings();
      this._bindEvents();
      // P1: 确保初始化时已保存的主题/字体立即生效
      var settings = Storage.getSettings();
      this._applySettings(settings);
    },

    /**
     * 打开设置面板
     */
    open: function () {
      this.visible = true;
      var panel = document.getElementById('settings-panel');
      if (panel) {
        panel.classList.remove('settings-panel-collapsed');
      }
      this._loadSettings();
      Gateway.updateUI();
    },

    /**
     * 关闭设置面板
     */
    close: function () {
      this.visible = false;
      var panel = document.getElementById('settings-panel');
      if (panel) {
        panel.classList.add('settings-panel-collapsed');
      }
    },

    /**
     * 切换设置面板
     */
    toggle: function () {
      if (this.visible) {
        this.close();
      } else {
        this.open();
      }
    },

    /**
     * 从 Storage 加载设置到 UI
     */
    _loadSettings: function () {
      var settings = Storage.getSettings();

      var themeSelect = document.getElementById('setting-theme');
      if (themeSelect) themeSelect.value = settings.theme || 'dark';

      var fontSizeSelect = document.getElementById('setting-font-size');
      if (fontSizeSelect) fontSizeSelect.value = settings.fontSize || 'medium';

      var tempRange = document.getElementById('setting-temperature');
      var tempValue = document.getElementById('temperature-value');
      if (tempRange) tempRange.value = settings.temperature !== undefined ? settings.temperature : 0.7;
      if (tempValue) tempValue.textContent = tempRange ? tempRange.value : '0.7';

      var maxTokens = document.getElementById('setting-max-tokens');
      if (maxTokens) maxTokens.value = settings.maxTokens || 4096;

      var modelSelect = document.getElementById('model-select');
      if (modelSelect) modelSelect.value = settings.model || 'deepseek-v4-flash';

      var styleSelect = document.getElementById('style-select');
      if (styleSelect) styleSelect.value = settings.style || '';

      var deepseekKeyEl = document.getElementById('setting-deepseek-key');
      if (deepseekKeyEl) deepseekKeyEl.value = settings.deepseekKey || '';

      // 加载搜索 API Key（通过 Storage 接口，避免双重命名空间）
      var searchKeys = Storage.getSearchKeys();
      var tavilyKeyEl = document.getElementById('setting-tavily-key');
      var serperKeyEl = document.getElementById('setting-serper-key');
      if (tavilyKeyEl) tavilyKeyEl.value = searchKeys.tavily || '';
      if (serperKeyEl) serperKeyEl.value = searchKeys.serper || '';

      // P1: 加载后立即应用主题/字体设置
      this._applySettings(settings);
    },

    /**
     * 保存设置
     */
    _saveSettings: function () {
      var settings = Storage.getSettings();

      var themeSelect = document.getElementById('setting-theme');
      if (themeSelect) settings.theme = themeSelect.value;

      var fontSizeSelect = document.getElementById('setting-font-size');
      if (fontSizeSelect) settings.fontSize = fontSizeSelect.value;

      var tempRange = document.getElementById('setting-temperature');
      if (tempRange) {
        var t = parseFloat(tempRange.value);
        settings.temperature = isNaN(t) ? 0.7 : t;
      }

      var maxTokens = document.getElementById('setting-max-tokens');
      if (maxTokens) {
        var parsed = parseInt(maxTokens.value, 10);
        settings.maxTokens = isNaN(parsed) ? 4096 : parsed;
      }

      var modelSelect = document.getElementById('model-select');
      if (modelSelect) settings.model = modelSelect.value;

      var styleSelect = document.getElementById('style-select');
      if (styleSelect) settings.style = styleSelect.value;

      var deepseekKeyEl = document.getElementById('setting-deepseek-key');
      if (deepseekKeyEl) settings.deepseekKey = deepseekKeyEl.value.trim();

      // 保存搜索 API Key（通过 Storage 接口，避免双重命名空间）
      var tavilyKeyEl = document.getElementById('setting-tavily-key');
      var serperKeyEl = document.getElementById('setting-serper-key');
      Storage.setSearchKeys({
        tavily: tavilyKeyEl ? tavilyKeyEl.value.trim() : '',
        serper: serperKeyEl ? serperKeyEl.value.trim() : '',
      });

      Storage.setSettings(settings);

      this._applySettings(settings);
    },

    /**
     * 应用设置到 UI
     * @param {Object} settings
     */
    _applySettings: function (settings) {
      if (!settings) settings = Storage.getSettings();

      // 主题 — 加过渡类避免切换时的闪动，先清除旧计时器防止累积
      if (settings.theme) {
        document.documentElement.classList.add('theme-transitioning');
        document.documentElement.setAttribute('data-theme', settings.theme);
        if (Settings._themeTimer) clearTimeout(Settings._themeTimer);
        Settings._themeTimer = setTimeout(function () {
          document.documentElement.classList.remove('theme-transitioning');
          Settings._themeTimer = null;
        }, 200);
      }

      // 字体大小
      if (settings.fontSize) {
        document.documentElement.setAttribute('data-font-size', settings.fontSize);
      }
    },

    /**
     * 绑定事件
     */
    _bindEvents: function () {
      var self = this;
      var Utils = window.ZYN3.Utils;
      var debouncedSave = Utils.debounce(function () { self._saveSettings(); }, 150);

      // 设置变更自动保存
      var changeHandlers = ['setting-theme', 'setting-font-size', 'setting-temperature', 'setting-max-tokens', 'model-select', 'style-select', 'setting-tavily-key', 'setting-serper-key', 'setting-deepseek-key'];

      changeHandlers.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', function () {
            self._saveSettings();
          });
          el.addEventListener('input', function () {
            // 实时更新温度显示
            if (id === 'setting-temperature') {
              var valEl = document.getElementById('temperature-value');
              if (valEl) valEl.textContent = el.value;
            }
            debouncedSave();
          });
        }
      });

      // 导出数据
      var exportBtn = document.getElementById('btn-export-data');
      if (exportBtn) {
        exportBtn.addEventListener('click', function () {
          self._exportData();
        });
      }

      // 导入数据
      var importBtn = document.getElementById('btn-import-data');
      if (importBtn) {
        importBtn.addEventListener('click', function () {
          self._importData();
        });
      }
    },

    /**
     * 导出对话数据
     */
    _exportData: function () {
      var data = Storage.exportAll();
      var json = JSON.stringify(data, null, 2);
      var Utils = window.ZYN3.Utils;
      Utils.downloadFile('ziyouniao-backup-' + Date.now() + '.json', json, 'application/json');
      var App = window.ZYN3.App;
      if (App && App.showToast) {
        App.showToast('数据已导出', 'success');
      }
    },

    /**
     * 导入对话数据
     */
    _importData: function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      var self = this;
      var cleaned = false;
      function cleanInput() {
        if (cleaned) return;
        cleaned = true;
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }
      }
      // 取消文件对话框时通过 window focus 事件清理泄漏的 input 元素
      function onFocusCleanup() {
        window.removeEventListener('focus', onFocusCleanup);
        setTimeout(cleanInput, 100);
      }
      window.addEventListener('focus', onFocusCleanup);

      input.addEventListener('change', function () {
        if (input.files && input.files[0]) {
          var file = input.files[0];
          // P1: 文件大小检查（限 50MB）
          if (file.size > 50 * 1024 * 1024) {
            var App = window.ZYN3.App;
            if (App && App.showToast) App.showToast('文件过大（超过50MB），无法导入', 'error');
            cleanInput();
            return;
          }
          var Utils = window.ZYN3.Utils;
          Utils.readFileAsText(file).then(function (text) {
            try {
              var data = JSON.parse(text);
              var success = Storage.importData(data);
              var App = window.ZYN3.App;
              if (success) {
                if (App && App.showToast) App.showToast('数据导入成功', 'success');
                // 刷新标签和侧栏
                var Tabs = window.ZYN3.Tabs;
                var Sidebar = window.ZYN3.Sidebar;
                if (Tabs) Tabs.init();
                if (Sidebar) Sidebar.render();
                // P1: 导入后恢复当前标签的 UI 渲染
                var Chat = window.ZYN3.Chat;
                if (Chat && Chat.renderMessages) Chat.renderMessages();
                // 刷新设置面板 UI
                self._loadSettings();
              } else {
                if (App && App.showToast) App.showToast('导入失败：数据格式无效', 'error');
              }
            } catch (err) {
              var App = window.ZYN3.App;
              if (App && App.showToast) App.showToast('导入失败：' + err.message, 'error');
            }
            cleanInput();
          }).catch(function (err) {
            var App = window.ZYN3.App;
            if (App && App.showToast) App.showToast('读取文件失败：' + err.message, 'error');
            cleanInput();
          });
        } else {
          cleanInput();
        }
      });
      document.body.appendChild(input);
      input.click();
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Settings = Settings;
})();
