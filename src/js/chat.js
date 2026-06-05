/**
 * chat.js — 核心对话引擎
 * 命名空间: window.ZYN3.Chat
 */
(function () {
  'use strict';

  var Utils = window.ZYN3.Utils;
  var API = window.ZYN3.API;
  var Storage = window.ZYN3.Storage;

  var Chat = {
    /**
     * 当前标签消息列表
     */
    messages: [],

    /**
     * 当前标签ID
     */
    currentTabId: null,

    /**
     * 是否正在生成回复
     */
    isGenerating: false,

    /**
     * AbortController 引用，用于停止
     */
    _abortController: null,

    /**
     * 是否禁止自动滚动（恢复对话时使用）
     */
    suppressAutoScroll: false,

    /**
     * 是否由用户手动中止（防止 onDone/onError 重复 UI 更新）
     */
    _abortedByUser: false,

    /**
     * 初始化
     */
    init: function () {
      this.messages = [];
      this.isGenerating = false;
      this._abortController = null;
      this.suppressAutoScroll = false;
    },

    /**
     * 加载指定标签的消息
     * @param {string} tabId
     */
    loadMessages: function (tabId) {
      this.currentTabId = tabId;
      // P0-6: 恢复对话时 suppressAutoScroll=true
      this.suppressAutoScroll = true;
      this.messages = Storage.getTabMessages(tabId) || [];
      this.renderMessages();
      this.suppressAutoScroll = false;
    },

    /**
     * 切换模型
     * @param {string} model
     */
    switchModel: function (model) {
      var select = document.getElementById('model-select');
      if (select) {
        select.value = model;
      }
      var settings = Storage.getSettings();
      settings.model = model;
      Storage.setSettings(settings);
    },

    /**
     * 发送消息
     */
    sendMessage: function () {
      // P0-8: 每次从 DOM 获取按钮引用
      var input = document.getElementById('message-input');
      var sendBtn = document.getElementById('btn-send');
      var stopBtn = document.getElementById('btn-stop');

      if (!input) return;
      var text = input.value.trim();
      if (!text) return;

      if (this.isGenerating) return;

      // 添加输入历史
      Storage.addInputHistory(text);

      // 获取当前模型
      var modelSelect = document.getElementById('model-select');
      var model = modelSelect ? modelSelect.value : 'deepseek-chat';
      var settings = Storage.getSettings();

      // 添加用户消息
      this.addMessage('user', text);

      // 清空输入
      input.value = '';
      Utils.autoResizeTextarea(input);

      // 隐藏欢迎信息
      var welcome = document.getElementById('welcome-message');
      if (welcome) {
        welcome.style.display = 'none';
      }

      // 显示停止按钮，隐藏发送按钮
      if (sendBtn) sendBtn.classList.add('hidden');
      if (stopBtn) stopBtn.classList.remove('hidden');

      // 添加助手消息占位
      this.addMessage('assistant', '<span class="typing-indicator"><span></span><span></span><span></span></span>', {
        isPlaceholder: true,
      });

      this.isGenerating = true;
      this._abortedByUser = false;

      // 准备消息列表
      var apiMessages = this.messages
        .filter(function (m) { return !m._placeholder; })
        .map(function (m) {
          return { role: m.role, content: m.content };
        });

      // P1: 历史裁剪 — 从最新往回估算 token，保留最近 N 条
      // 约 1 token ≈ 4 字符，以 maxTokens 的 80% 为阈值
      var maxModelTokens = Math.max(settings.maxTokens || 4096, 1024);
      var totalChars = 0;
      var cutoff = -1;
      for (var j = apiMessages.length - 1; j >= 0; j--) {
        totalChars += (apiMessages[j].content ? apiMessages[j].content.length : 0);
        if (totalChars / 4 > maxModelTokens * 0.8) {
          cutoff = j;
          break;
        }
      }
      if (cutoff >= 0) {
        apiMessages = apiMessages.slice(cutoff + 1);
      }

      var self = this;

      // P0-7: AbortController 来自 api.js
      this._abortController = API.sendMessage(apiMessages, {
        model: model,
        temperature: settings.temperature || 0.7,
        maxTokens: settings.maxTokens || 4096,
        onMessage: function (delta) {
          self._appendToLastMessage(delta);
        },
        onDone: function (fullText) {
          // P1: 用户中止後跳过重复 UI 更新
          if (self._abortedByUser) return;
          self.isGenerating = false;
          self._abortController = null;

          // 移除占位标记
          var lastMsg = self.messages[self.messages.length - 1];
          if (lastMsg && lastMsg._placeholder) {
            lastMsg.content = fullText;
            delete lastMsg._placeholder;
          }

          // 保存消息
          self._saveCurrentMessages();

          // 更新 UI
          var sBtn = document.getElementById('btn-send');
          var stpBtn = document.getElementById('btn-stop');
          if (sBtn) sBtn.classList.remove('hidden');
          if (stpBtn) stpBtn.classList.add('hidden');

          // 滚动到底部
          self.scrollToBottom();
        },
        onError: function (err) {
          // P1: 用户中止後跳过重复 UI 更新
          if (self._abortedByUser) return;
          self.isGenerating = false;
          self._abortController = null;

          // 移除占位消息
          var lastMsg = self.messages[self.messages.length - 1];
          if (lastMsg && lastMsg._placeholder) {
            self.messages.pop();
          }

          // 显示错误消息
          self.addMessage('assistant', '**错误**: ' + Utils.escapeHTML(err.message || '请求失败'));

          // P0-8: 从 DOM 获取按钮引用
          var sBtn = document.getElementById('btn-send');
          var stpBtn = document.getElementById('btn-stop');
          if (sBtn) sBtn.classList.remove('hidden');
          if (stpBtn) stpBtn.classList.add('hidden');

          Chat.showError('请求失败: ' + (err.message || '未知错误'));
        },
      });
    },

    /**
     * 停止生成
     */
    stopGeneration: function () {
      this._abortedByUser = true;
      if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
      }
      this.isGenerating = false;

      // P0-8: 从 DOM 获取
      var sendBtn = document.getElementById('btn-send');
      var stopBtn = document.getElementById('btn-stop');
      if (sendBtn) sendBtn.classList.remove('hidden');
      if (stopBtn) stopBtn.classList.add('hidden');

      // 移除占位消息
      var lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg && lastMsg._placeholder) {
        this.messages.pop();
        // P1-Bug #3: 移除后保存消息
        this._saveCurrentMessages();
        this.renderMessages();
      }
    },

    /**
     * 新增消息并渲染
     * @param {string} role - 'user' | 'assistant'
     * @param {string} content - HTML 内容
     * @param {Object} opts
     */
    addMessage: function (role, content, opts) {
      if (opts === undefined) opts = {};

      var message = {
        id: Utils.generateId(),
        role: role,
        content: content,
        timestamp: Date.now(),
        _placeholder: opts.isPlaceholder || false,
      };

      this.messages.push(message);
      this._saveCurrentMessages();
      this._renderMessage(message);

      // P0-6: 如果 suppressAutoScroll，不滚动
      if (!this.suppressAutoScroll) {
        this.scrollToBottom();
      }

      // P0-Bug #2: 通知标签管理器更新元数据
      var Tabs = window.ZYN3.Tabs;
      if (Tabs && Tabs.onMessageAdded && this.currentTabId) {
        Tabs.onMessageAdded(this.currentTabId);
      }
    },

    /**
     * 追加内容到最后一条消息（流式）
     * @param {string} delta
     */
    _appendToLastMessage: function (delta) {
      var lastMsg = this.messages[this.messages.length - 1];
      if (!lastMsg) return;

      // 如果是占位，替换占位符为真实内容+增量
      if (lastMsg._placeholder) {
        lastMsg.content = delta;
        delete lastMsg._placeholder;
      } else {
        lastMsg.content += delta;
      }

      // 更新 DOM
      var msgEl = document.getElementById('msg-' + lastMsg.id);
      if (msgEl) {
        var contentEl = msgEl.querySelector('.message-content');
        if (contentEl) {
          contentEl.innerHTML = this._renderMarkdown(lastMsg.content);
        }
      }

      this._saveCurrentMessages();

      // P0-Bug #2: 流式更新后通知标签管理器
      var _Tabs = window.ZYN3.Tabs;
      if (_Tabs && _Tabs.onMessageAdded && this.currentTabId) {
        _Tabs.onMessageAdded(this.currentTabId);
      }

      // 流式输出时自动滚动
      if (!this.suppressAutoScroll) {
        this.scrollToBottom();
      }
    },

    /**
     * 渲染所有消息
     */
    renderMessages: function () {
      var container = document.getElementById('messages-container');
      if (!container) return;

      // 清除现有消息（保留欢迎页）
      var existing = container.querySelectorAll('.message');
      existing.forEach(function (el) { el.remove(); });

      var self = this;
      var MAX_RENDER = 200;
      var msgs = this.messages;

      // 长对话性能优化：限制初始渲染数量
      if (msgs.length > MAX_RENDER) {
        var skipped = msgs.length - MAX_RENDER;
        var loadMore = document.createElement('div');
        loadMore.className = 'load-more';
        loadMore.innerHTML = '<button>显示全部 ' + msgs.length + ' 条消息 (已隐藏 ' + skipped + ' 条)</button>';
        loadMore.querySelector('button').onclick = function () {
          self._renderAll = true;
          self.renderMessages();
        };
        container.appendChild(loadMore);
        // 只渲染最近 MAX_RENDER 条
        msgs = msgs.slice(skipped);
      }

      msgs.forEach(function (msg) {
        self._renderMessage(msg);
      });

      // 显示/隐藏欢迎页
      var welcome = document.getElementById('welcome-message');
      if (welcome) {
        welcome.style.display = this.messages.length > 0 ? 'none' : 'flex';
      }

      if (!this.suppressAutoScroll) {
        this.scrollToBottom();
      }
    },

    /**
     * 渲染单条消息到 DOM
     * @param {Object} message
     */
    _renderMessage: function (message) {
      var container = document.getElementById('messages-container');
      if (!container) return;

      // 检查是否已存在
      var existing = document.getElementById('msg-' + message.id);
      if (existing) return;

      var div = document.createElement('div');
      div.className = 'message ' + message.role;
      div.id = 'msg-' + message.id;

      var avatarLabel = message.role === 'user' ? 'U' : 'A';
      var roleLabel = message.role === 'user' ? '你' : '自由鸟';

      var contentHtml = message.content;
      if (!message._placeholder) {
        contentHtml = this._renderMarkdown(message.content);
      }

      div.innerHTML = '' +
        '<div class="message-avatar">' + avatarLabel + '</div>' +
        '<div class="message-body">' +
          '<div class="message-header">' +
            '<span class="message-role">' + roleLabel + '</span>' +
            '<span class="message-time">' + Utils.formatTime(message.timestamp) + '</span>' +
          '</div>' +
          '<div class="message-content">' + contentHtml + '</div>' +
        '</div>';

      container.appendChild(div);
    },

    /**
     * 简单的 Markdown 渲染
     * @param {string} text
     * @returns {string}
     */
    _renderMarkdown: function (text) {
      if (!text) return '';

      // P0: 先整体转义 HTML，防止 XSS
      var html = Utils.escapeHTML(text);

      // 代码块 (```) — 先处理，因为内部不应被后续规则干扰
      // escapeHTML 已将内容中的 <>& 等转义为实体，代码块内安全
      html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (match, lang, code) {
        var langClass = lang ? ' class="language-' + Utils.escapeHTML(lang) + '"' : '';
        return '<pre><code' + langClass + '>' + code.trim() + '</code></pre>';
      });

      // 行内代码 (`) — 内部已是转义后的安全内容
      html = html.replace(/`([^`]+)`/g, function (match, code) {
        return '<code>' + code + '</code>';
      });

      // 加粗 **text**
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

      // 斜体 *text*
      html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

      // 换行 → <br>（跳过 <pre> 内部）
      var parts = html.split(/(<pre[\s\S]*?<\/pre>)/g);
      for (var i = 0; i < parts.length; i++) {
        if (!/^<pre/.test(parts[i])) {
          parts[i] = parts[i].replace(/\n/g, '<br>');
        }
      }
      html = parts.join('');

      return html;
    },

    /**
     * 保存当前标签消息
     */
    _saveCurrentMessages: function () {
      if (this.currentTabId) {
        Storage.setTabMessages(this.currentTabId, this.messages);
      }
    },

    /**
     * 滚动到底部
     */
    scrollToBottom: function () {
      var container = document.getElementById('messages-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    },

    /**
     * 显示 Toast 错误
     * @param {string} message
     */
    showError: function (message) {
      var ZC = window.ZYN3 && window.ZYN3.App;
      if (ZC && ZC.showToast) {
        ZC.showToast(message, 'error');
      } else {
        console.error('[Chat]', message);
      }
    },

    /**
     * 清空当前对话
     */
    clearMessages: function () {
      this.messages = [];
      this.isGenerating = false;
      if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
      }
      this._saveCurrentMessages();
      this.renderMessages();
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Chat = Chat;
})();
