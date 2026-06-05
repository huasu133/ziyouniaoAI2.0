/**
 * utils.js — 工具函数
 * 命名空间: window.ZYN3.Utils
 */
(function () {
  'use strict';

  const Utils = {
    /**
     * 生成唯一ID
     * @returns {string}
     */
    generateId: function () {
      return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
    },

    /**
     * 格式化时间为 HH:mm
     * @param {number|Date} timestamp
     * @returns {string}
     */
    formatTime: function (timestamp) {
      const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    },

    /**
     * 格式化日期为 MM-DD HH:mm
     * @param {number|Date} timestamp
     * @returns {string}
     */
    formatDateTime: function (timestamp) {
      const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
      return d.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    },

    /**
     * 格式化简短日期（今天/昨天/日期）
     * @param {number} timestamp
     * @returns {string}
     */
    formatRelativeDate: function (timestamp) {
      const now = new Date();
      const d = new Date(timestamp);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diffDays = Math.floor((today - target) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return '今天';
      if (diffDays === 1) return '昨天';
      if (diffDays < 7) return diffDays + '天前';
      return this.formatDateTime(timestamp);
    },

    /**
     * 防抖
     * @param {Function} fn
     * @param {number} delay
     * @returns {Function}
     */
    debounce: function (fn, delay) {
      let timer = null;
      return function () {
        const context = this;
        const args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          fn.apply(context, args);
          timer = null;
        }, delay);
      };
    },

    /**
     * 节流
     * @param {Function} fn
     * @param {number} interval
     * @returns {Function}
     */
    throttle: function (fn, interval) {
      var lastTime = 0;
      var trailingTimer = null;
      return function () {
        var now = Date.now();
        var context = this;
        var args = arguments;
        if (now - lastTime >= interval) {
          if (trailingTimer) {
            clearTimeout(trailingTimer);
            trailingTimer = null;
          }
          fn.apply(context, args);
          lastTime = now;
        } else {
          // P2: trailing 调用 — 时间窗口结束时再执行一次
          if (trailingTimer) clearTimeout(trailingTimer);
          trailingTimer = setTimeout(function () {
            fn.apply(context, args);
            lastTime = Date.now();
            trailingTimer = null;
          }, interval - (now - lastTime));
        }
      };
    },

    /**
     * 安全 JSON 解析
     * @param {string} str
     * @param {*} defaultVal
     * @returns {*}
     */
    safeParseJSON: function (str, defaultVal) {
      if (defaultVal === undefined) defaultVal = null;
      try {
        return JSON.parse(str);
      } catch (_) {
        return defaultVal;
      }
    },

    /**
     * 截断文本
     * @param {string} text
     * @param {number} maxLength
     * @returns {string}
     */
    truncate: function (text, maxLength) {
      if (!text) return '';
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    },

    /**
     * 获取消息预览文本
     * @param {string} content
     * @returns {string}
     */
    getMessagePreview: function (content) {
      if (!content) return '(空消息)';
      // 去除 HTML 标签
      const plain = content.replace(/<[^>]*>/g, '');
      return this.truncate(plain, 60);
    },

    /**
     * HTML 转义
     * @param {string} text
     * @returns {string}
     */
    escapeHTML: function (text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.appendChild(document.createTextNode(text));
      return div.innerHTML;
    },

    /**
     * 转义正则表达式特殊字符
     * @param {string} text
     * @returns {string}
     */
    escapeRegExp: function (text) {
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * 从 textarea caret 位置插入文本
     * @param {HTMLTextAreaElement} textarea
     * @param {string} text
     */
    insertAtCaret: function (textarea, text) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(end);
      textarea.value = before + text + after;
      textarea.selectionStart = textarea.selectionEnd = start + text.length;
      textarea.focus();
    },

    /**
     * 自动调整 textarea 高度
     * @param {HTMLTextAreaElement} textarea
     */
    autoResizeTextarea: function (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    },

    /**
     * 下载文件
     * @param {string} filename
     * @param {string} content
     * @param {string} mimeType
     */
    downloadFile: function (filename, content, mimeType) {
      if (mimeType === undefined) mimeType = 'application/json';
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },

    /**
     * 读取文件为文本
     * @param {File} file
     * @returns {Promise<string>}
     */
    readFileAsText: function (file) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsText(file);
      });
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Utils = Utils;
})();
