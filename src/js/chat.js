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
     * 输入历史
     */
    inputHistory: [],
    historyIndex: -1,

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
      // 记录输入历史
      this.inputHistory.unshift(text);
      if (this.inputHistory.length > 50) this.inputHistory.pop();
      this.historyIndex = -1;
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

      // 风格预设 — 首次对话时注入 system prompt
      var styleSelect = document.getElementById('style-select');
      if (styleSelect && styleSelect.value && this.messages.length <= 1) {
        var styles = {
          'efficient': '每条回复不超过3句话。结论在第一句。不要"好的""让我来"等废话。用表格代替段落。',
          'creative': '可以适当使用比喻和故事。鼓励多角度思考。回复可以长一些，但要有洞察。语气轻松。',
          'professional': '正式、有条理。结论后跟论据。引用数据和标准。不省略步骤。',
          'friendly': '像朋友聊天一样。可以用"你"和自然语气。适当共情。回复温暖但有干货。'
        };
        var systemPrompt = styles[styleSelect.value] || '';
        if (systemPrompt) {
          apiMessages = [{ role: 'system', content: systemPrompt }].concat(apiMessages);
        }
      }
        .map(function (m) {
          return { role: m.role, content: m.content };
        });

      // P0: 历史裁剪 — 使用模型上下文窗口(128K tokens)，非输出maxTokens
      // DeepSeek 上下文为 128K tokens，设阈值 64K (~262K 字符，中英文混合约2.5字符/token)
      var CONTEXT_WINDOW = 65536;
      var totalChars = 0;
      var cutoff = -1;
      for (var j = apiMessages.length - 1; j >= 0; j--) {
        totalChars += (apiMessages[j].content ? apiMessages[j].content.length : 0);
        if (totalChars / 2.5 > CONTEXT_WINDOW) {
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

          // 自动记录教训
          self._reflectLesson('对话', text.substring(0, 50));
          // 自动汇总+命名（后台调用，不阻塞）
          self._generateSummaryAndName();
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

          self.showError('请求失败: ' + (err.message || '未知错误'));
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

      // 更新 DOM — P0: 检测未闭合代码块，流式中避免错误渲染
      var msgEl = document.getElementById('msg-' + lastMsg.id);
      if (msgEl) {
        var contentEl = msgEl.querySelector('.message-content');
        if (contentEl) {
          var codeBlockOpen = (lastMsg.content.match(/```/g) || []).length % 2 !== 0;
          if (codeBlockOpen) {
            contentEl.textContent = lastMsg.content;
          } else {
            contentEl.innerHTML = this._renderMarkdown(lastMsg.content);
          }
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

      // 清除现有消息 + 加载更多按钮
      var existing = container.querySelectorAll('.message');
      existing.forEach(function (el) { el.remove(); });
      var loadMoreBtns = container.querySelectorAll('.load-more');
      loadMoreBtns.forEach(function (el) { el.remove(); });

      var self = this;
      var MAX_RENDER = 200;
      var msgs = this.messages;

      // P0: 检查 _renderAll 标志，点击"显示全部"后全量渲染
      if (this._renderAll) {
        MAX_RENDER = Infinity;
      }

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
        // JSON 自动检测 — 纯 JSON 响应渲染为可折叠树视图
        try {
          var parsed = JSON.parse(message.content);
          if (typeof parsed === 'object' && parsed !== null) {
            contentHtml = this._renderJSON(parsed);
          } else {
            contentHtml = this._renderMarkdown(message.content);
          }
        } catch (_) {
          contentHtml = this._renderMarkdown(message.content);
        }
      }

      div.innerHTML = '' +
        '<div class="message-avatar">' + avatarLabel + '</div>' +
        '<div class="message-body">' +
          '<div class="message-header">' +
            '<span class="message-role">' + roleLabel + '</span>' +
            '<span class="message-time">' + Utils.formatTime(message.timestamp) + '</span>' +
          '</div>' +
          '<div class="message-content">' + contentHtml + '</div>' +
          '<button class="msg-copy-btn" title="复制">📋</button>' +
        '</div>';

      container.appendChild(div);

      // 复制按钮
      var copyBtn = div.querySelector('.msg-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          var contentEl = div.querySelector('.message-content');
          var txt = contentEl ? contentEl.textContent : message.content;
          navigator.clipboard.writeText(txt).then(function () {
            copyBtn.textContent = '✅';
            setTimeout(function () { copyBtn.textContent = '📋'; }, 2000);
          }).catch(function () {});
        });
      }
    },

    /**
     * JSON 树视图渲染
     * @param {*} data
     * @param {number} depth
     * @returns {string}
     */
    _renderJSON: function (data, depth) {
      if (depth === undefined) depth = 0;
      if (depth > 10) return '<span style="color:#ce9178">[...太深]</span>';
      if (typeof data !== 'object' || data === null) {
        return '<span style="color:#ce9178">' + Utils.escapeHTML(String(data)) + '</span>';
      }
      var isArray = Array.isArray(data);
      var entries = isArray ? data : Object.keys(data);
      var indent = depth * 20;
      if (entries.length === 0) return isArray ? '[]' : '{}';

      var html = '<details ' + (depth < 1 ? 'open' : '') + ' style="margin-left:' + indent + 'px">';
      html += '<summary>' + (isArray ? '[' + entries.length + '项]' : '{' + Object.keys(data).length + '个键}') + '</summary>';
      for (var i = 0; i < entries.length; i++) {
        var k = isArray ? i : entries[i];
        var v = data[k];
        html += '<div style="margin-left:' + (indent + 20) + 'px">';
        html += '<span style="color:#569cd6">' + Utils.escapeHTML(String(k)) + '</span>: ';
        html += this._renderJSON(v, depth + 1);
        html += '</div>';
      }
      html += '</details>';
      return html;
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

      // 无序列表 (- / * / + 开头行)
      html = html.replace(/(^[-*+]\s+.+$\n?)+/gm, function (match) {
        var items = match.trim().split('\n');
        var listItems = '';
        for (var li = 0; li < items.length; li++) {
          var itemContent = items[li].replace(/^[-*+]\s+/, '');
          listItems += '<li>' + itemContent + '</li>';
        }
        return '<ul>' + listItems + '</ul>';
      });

      // 有序列表 (数字. 开头行)
      html = html.replace(/(^\d+\.\s+.+$\n?)+/gm, function (match) {
        var items = match.trim().split('\n');
        var listItems = '';
        for (var oi = 0; oi < items.length; oi++) {
          var itemContent = items[oi].replace(/^\d+\.\s+/, '');
          listItems += '<li>' + itemContent + '</li>';
        }
        return '<ol>' + listItems + '</ol>';
      });

      // 表格 (| col1 | col2 | ...)
      html = html.replace(/\|(.+?)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/g, function (match, headerRow, dataRows) {
        var headers = headerRow.split('|').map(function (h) { return h.trim(); });
        var rows = dataRows.trim().split('\n');
        var tableHtml = '<table><thead><tr>';
        for (var hi = 0; hi < headers.length; hi++) {
          tableHtml += '<th>' + headers[hi] + '</th>';
        }
        tableHtml += '</tr></thead><tbody>';
        for (var ri = 0; ri < rows.length; ri++) {
          var cells = rows[ri].split('|').map(function (c) { return c.trim(); });
          tableHtml += '<tr>';
          for (var ci = 0; ci < cells.length; ci++) {
            if (cells[ci] !== '') {
              tableHtml += '<td>' + cells[ci] + '</td>';
            }
          }
          tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        return tableHtml;
      });

      // 行内代码 (`) — 内部已是转义后的安全内容
      html = html.replace(/`([^`]+)`/g, function (match, code) {
        return '<code>' + code + '</code>';
      });

      // 标题 h1~h6
      html = html.replace(/^(#{1,6})\s+(.+)$/gm, function (match, hashes, content) {
        return '<h' + hashes.length + '>' + content.trim() + '</h' + hashes.length + '>';
      });

      // 引用 blockquote — 先行合并相邻 > 行再整体包裹
      html = html.replace(/^>\s*.+(?:\n^>\s*.+)*$/gm, function (match) {
        var inner = match.replace(/^>\s*/gm, '');  // 移除每行的 > 前缀
        return '<blockquote>' + inner + '</blockquote>';
      });

      // 水平线 ---
      html = html.replace(/^-{3,}$/gm, '<hr>');

      // 链接 [text](url) — 仅允许 http/https/mailto 协议
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (match, text, url) {
        var safeUrl = /^(https?:|mailto:)/i.test(url) ? url : '#blocked';
        return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
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

    /**
     * 自动生成摘要+对话标题
     */
    _generateSummaryAndName: async function () {
      if (this.messages.length < 2) return;
      var prompt = '';
      for (var i = 0; i < this.messages.length; i++) {
        prompt += this.messages[i].role + ': ' + (this.messages[i].content || '').substring(0, 200) + '\n';
      }
      prompt += '\n请分别回复以下两项（用 --- 分隔）：\n1. 给这个对话起一个 5 字以内的标题\n2. 用2-3句话概述本次对话';
      try {
        var API = window.ZYN3.API;
        var model = document.querySelector('.model-select');
        model = model ? model.value : 'deepseek-chat';
        var res = await fetch('http://127.0.0.1:18789/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], max_tokens: 300, stream: false }),
        });
        var data = await res.json();
        var result = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        var parts = result.split('---');
        var title = (parts[0] || '').replace(/["""]/g, '').trim().slice(0, 10) || '';
        if (title && this.currentTabId) {
          var Tabs = window.ZYN3.Tabs;
          if (Tabs) Tabs.renameTab(this.currentTabId, title);
        }
        // 保存记忆
        var summary = (parts[1] || result).trim().slice(0, 100);
        if (summary) {
          var Storage = window.ZYN3.Storage;
          var memories = Storage.getMemories();
          memories.push({ key: title || '对话', value: summary, time: Date.now() });
          if (memories.length > 50) memories = memories.slice(-50);
          Storage.setMemories(memories);
          this._renderMemoryPanel();
        }
      } catch (_) { /* 静默失败 */ }
    },

    /**
     * 自动记录教训
     */
    _reflectLesson: function (category, lesson) {
      if (!lesson) return;
      var Storage = window.ZYN3.Storage;
      var lessons = Storage.getLessons();
      lessons.push({ category: category, lesson: String(lesson).slice(0, 500), time: Date.now() });
      if (lessons.length > 100) lessons = lessons.slice(-100);
      Storage.setLessons(lessons);
      this._renderMemoryPanel();
    },

    /**
     * 渲染记忆面板
     */
    _renderMemoryPanel: function () {
      var panel = document.getElementById('memory-panel');
      if (!panel) return;
      var Storage = window.ZYN3.Storage;
      var items = Storage.getMemories();
      if (!items || items.length === 0) {
        panel.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px;">暂无记忆</div>';
        return;
      }
      var html = '';
      items.slice(-10).reverse().forEach(function (m) {
        html += '<div class="mem-item"><span class="mem-key">' + Utils.escapeHTML(m.key || '') + '</span>: <span class="mem-val">' + Utils.escapeHTML((m.value || '').slice(0, 100)) + '</span></div>';
      });
      panel.innerHTML = html;
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Chat = Chat;
})();
