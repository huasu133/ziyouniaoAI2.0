/**
 * chat.js — 核心对话引擎
 * 命名空间: window.ZYN3.Chat
 */
(function () {
  'use strict';

  var Utils = window.ZYN3.Utils;
  var API = window.ZYN3.API;
  var Storage = window.ZYN3.Storage;

  // 同步加载专家 SOUL 人格文件
  function loadExpertPrompt(agentId) {
    // Electron 环境：通过 IPC 同步读取（通过主进程）
    if (window.electronAPI && window.electronAPI.readExpertFile) {
      // 由于 sandbox:true，不能用同步 XHR；用预加载标记作同步 fallback
      // 这里用 XMLHttpRequest 同步请求本地文件
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'experts/' + agentId + '.soul.md', false);
        xhr.send();
        if (xhr.status === 200) return xhr.responseText;
      } catch (e) {}
    }
    return '';
  }

  // P0-4: generationId 用于快速 send→stop→send 竞态控制
  var _generationId = 0;

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
     * 自动摘要防抖计数器，用于取消过期请求
     */
    _summaryGenerationId: 0,

    /**
     * 是否禁止自动滚动（恢复对话时使用）
     */
    suppressAutoScroll: false,


    /**
     * 初始化
     */
    init: function () {
      this.messages = [];
      this.isGenerating = false;
      this._abortController = null;
      this.suppressAutoScroll = false;
      // 从 Storage 加载输入历史
      this.inputHistory = Storage.getInputHistory();
      this.historyIndex = -1;
      // 渲染记忆面板
      this._renderMemoryPanel();
      // 加载 LESSONS.md 经验教训
      this._loadLessonsPanel();
    },

    /**
     * 加载 LESSONS.md 到面板
     */
    _loadLessonsPanel: function () {
      if (window.electronAPI && window.electronAPI.getLessons) {
        window.electronAPI.getLessons().then(function (lessons) {
          var panel = document.getElementById('lessons-panel');
          if (!panel) return;
          if (lessons && lessons.length) {
            panel.textContent = typeof lessons === 'string' ? lessons : JSON.stringify(lessons, null, 2);
          } else {
            panel.innerHTML = '<div style="color:var(--t3);font-size:12px;">暂无经验教训</div>';
          }
        }).catch(function () {
          var panel = document.getElementById('lessons-panel');
          if (panel) panel.innerHTML = '<div style="color:var(--t3);font-size:12px;">暂无经验教训</div>';
        });
      }
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
      // P0-4: generationId 用于竞态控制
      var genId = ++_generationId;

      // P0-8: 每次从 DOM 获取按钮引用
      var input = document.getElementById('message-input');
      var sendBtn = document.getElementById('btn-send');
      var stopBtn = document.getElementById('btn-stop');

      if (!input) return;
      var text = input.value.trim();
      if (!text) return;

      // P1: 保存最后输入用于重试
      this._lastUserInput = text;

      if (this.isGenerating) return;

      // 添加输入历史
      Storage.addInputHistory(text);

      // 获取当前模型
      var modelSelect = document.getElementById('model-select');
      var model = modelSelect ? modelSelect.value : 'deepseek-v4-flash';
      var settings = Storage.getSettings();

      // 添加用户消息
      this.addMessage('user', text);

      // 清空输入
      // P1: 从 Storage 刷新输入历史，避免双写
      this.inputHistory = Storage.getInputHistory();
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

      // 准备消息列表（支持图片：检测 ![]() 语法并转换为多模态 content 格式）
      var apiMessages = this.messages
        .filter(function (m) { return !m._placeholder; })
        .map(function (m) {
          // 检测是否包含图片 Markdown
          var content = m.content;
          if (typeof content === 'string' && /!\[.*?\]\(data:image/.test(content)) {
            var parts = [];
            var lastIdx = 0;
            var imgRegex = /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g;
            var match;
            while ((match = imgRegex.exec(content)) !== null) {
              // 图片前面的文本
              if (match.index > lastIdx) {
                parts.push({ type: 'text', text: content.slice(lastIdx, match.index) });
              }
              parts.push({ type: 'image_url', image_url: { url: match[2] } });
              lastIdx = match.index + match[0].length;
            }
            // 剩余的文本
            if (lastIdx < content.length) {
              parts.push({ type: 'text', text: content.slice(lastIdx) });
            }
            return { role: m.role, content: parts };
          }
          return { role: m.role, content: content };
        });

      // 风格预设 — 首次对话时注入 system prompt
      // P2: 风格预设目前硬编码，后续可扩展为可自定义预设配置
      var styleSelect = document.getElementById('style-select');
      if (styleSelect && styleSelect.value && apiMessages.length <= 1) {
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

      // P0: 历史裁剪 — 使用模型上下文窗口(128K tokens)，非输出maxTokens
      // DeepSeek 上下文为 128K tokens，设阈值 64K
      // P1: 中文约 1.5 字符/token，英文约 4 字符/token，中英混合取 1.5 更安全
      var CONTEXT_WINDOW = 65536;
      var totalChars = 0;
      var cutoff = -1;
      for (var j = apiMessages.length - 1; j >= 0; j--) {
        // P1: 跳过 system prompt，不参与裁剪计算
        if (apiMessages[j].role === 'system') continue;
        totalChars += (apiMessages[j].content ? apiMessages[j].content.length : 0);
        if (totalChars / 1.5 > CONTEXT_WINDOW) {
          cutoff = j;
          break;
        }
      }
      if (cutoff >= 0) {
        apiMessages = apiMessages.slice(cutoff + 1);
      }

      var self = this;

      // 更新 token 估算（P1: 中文约 1.5 字符/token）
      var tokenCount = document.getElementById('token-count');
      if (tokenCount) {
        var tokenChars = 0;
        for (var k = 0; k < apiMessages.length; k++) {
          tokenChars += apiMessages[k].content ? apiMessages[k].content.length : 0;
        }
        tokenCount.textContent = '~' + Math.ceil(tokenChars / 1.5) + ' tokens';
      }

      // P0-7: AbortController 来自 api.js
      var agentSelect = document.getElementById('agent-select');
      var agentId = agentSelect ? agentSelect.value : '';

      // 专家 system prompt 注入 — 同步加载 SOUL 人格
      if (agentId) {
        var expertPrompt = loadExpertPrompt(agentId);
        if (expertPrompt) {
          apiMessages.unshift({ role: 'system', content: expertPrompt });
        }
      }

      this._abortController = API.sendMessage(apiMessages, {
        model: model,
        agentId: agentId || undefined,
        temperature: settings.temperature || 0.7,
        maxTokens: settings.maxTokens || 4096,
        onMessage: function (delta) {
          self._appendToLastMessage(delta);
        },
        onDone: function (fullText) {
          // P0-4: generationId 竞态检查
          if (genId !== _generationId) return;
          self.isGenerating = false;
          self._abortController = null;

          // 移除占位标记
          var lastMsg = self.messages[self.messages.length - 1];
          if (lastMsg && lastMsg._placeholder) {
            lastMsg.content = fullText;
            delete lastMsg._placeholder;
          }

          // 清除流式防抖定时器
          if (self._saveTimer) { clearTimeout(self._saveTimer); self._saveTimer = null; }

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
          // P0-4: generationId 竞态检查
          if (genId !== _generationId) return;
          self.isGenerating = false;
          self._abortController = null;

          // 清除流式防抖定时器
          if (self._saveTimer) { clearTimeout(self._saveTimer); self._saveTimer = null; }

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
        },
      });
    },

    /**
     * 停止生成
     */
    stopGeneration: function () {
      // P0-4: 递增 generationId 使所有 pending 回调失效
      _generationId++;
      // 清除流式防抖定时器
      if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
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
     * 重试最后一条消息（P1: 重试按钮修复）
     */
    retryLastMessage: function () {
      if (!this._lastUserInput) return;
      if (this.isGenerating) return;

      // 移除最后一条助手消息（失败的）
      var lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg._placeholder) {
        this.messages.pop();
      }

      // 恢复输入框内容
      var input = document.getElementById('message-input');
      if (input) {
        input.value = this._lastUserInput;
        Utils.autoResizeTextarea(input);
      }

      // 重新发送
      this.sendMessage();
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
            // Prism.js 代码高亮 — 仅在代码块闭合时触发
            this._highlightCodeBlocks(msgEl);
          }
        }
      }

      // 防抖保存 — 流式输出时每 500ms 写一次 localStorage，避免每 token 写入
      if (!this._saveTimer) {
        this._saveTimer = setTimeout(function (self) {
          self._saveCurrentMessages();
          // P0-Bug #2: 流式更新后通知标签管理器
          var _Tabs = window.ZYN3.Tabs;
          if (_Tabs && _Tabs.onMessageAdded && self.currentTabId) {
            _Tabs.onMessageAdded(self.currentTabId);
          }
          self._saveTimer = null;
        }, 500, this);
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

      // 长对话性能优化：限制初始渲染数量
      if (msgs.length > MAX_RENDER) {
        var skipped = msgs.length - MAX_RENDER;
        var loadMore = document.createElement('div');
        loadMore.className = 'load-more';
        loadMore.innerHTML = '<button>显示全部 ' + msgs.length + ' 条消息 (已隐藏 ' + skipped + ' 条)</button>';
        loadMore.querySelector('button').onclick = function () {
          // P1: 分批渲染，每帧 50 条，避免冻结 UI
          loadMore.remove();
          var batchSize = 50;
          var idx = 0;
          var allMsgs = self.messages;
          function renderBatch() {
            var end = Math.min(idx + batchSize, allMsgs.length);
            for (var bi = idx; bi < end; bi++) {
              self._renderMessage(allMsgs[bi]);
            }
            idx = end;
            if (idx < allMsgs.length) {
              requestAnimationFrame(renderBatch);
            } else {
              // Prism.js 代码高亮 — 所有消息渲染完成后
              if (typeof Prism !== 'undefined') {
                container.querySelectorAll('pre code[class*="language-"]').forEach(function (el) {
                  try { Prism.highlightElement(el); } catch (e) {}
                });
              }
            }
          }
          requestAnimationFrame(renderBatch);
        };
        container.appendChild(loadMore);
        // 只渲染最近 MAX_RENDER 条
        msgs = msgs.slice(skipped);
      }

      msgs.forEach(function (msg) {
        self._renderMessage(msg);
      });

      // Prism.js 代码高亮 — 对所有已渲染消息中的代码块应用高亮
      if (typeof Prism !== 'undefined') {
        var allCodeBlocks = container.querySelectorAll('pre code[class*="language-"]');
        allCodeBlocks.forEach(function (codeEl) {
          try {
            Prism.highlightElement(codeEl);
          } catch (e) {
            console.warn('[Chat] Prism highlight error:', e);
          }
        });
      }

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
        '</div>';

      container.appendChild(div);

      // Prism.js 代码高亮
      this._highlightCodeBlocks(div);

      // 复制按钮 — 手册 §5.3 原版
      var copyBtn = document.createElement('button');
      copyBtn.className = 'msg-copy';
      copyBtn.innerHTML = '📋';
      copyBtn.title = '复制消息';
      copyBtn.onclick = function () {
        var contentEl = div.querySelector('.message-content');
        var txt = contentEl ? contentEl.textContent : message.content;
        navigator.clipboard.writeText(txt).then(function () {
          copyBtn.innerHTML = '✅';
          setTimeout(function () { copyBtn.innerHTML = '📋'; }, 2000);
        }).catch(function () {});
      };
      div.querySelector('.message-body').appendChild(copyBtn);
    },

    /**
     * JSON 树视图渲染
     * @param {*} data
     * @param {number} depth
     * @returns {string}
     */
    _renderJSON: function (data, depth) {
      if (depth === undefined) depth = 0;
      if (depth > 10) return '<span style="color:var(--json-string)">[...太深]</span>';
      if (typeof data !== 'object' || data === null) {
        return '<span style="color:var(--json-string)">' + Utils.escapeHTML(String(data)) + '</span>';
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
        html += '<span style="color:var(--json-key)">' + Utils.escapeHTML(String(k)) + '</span>: ';
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
      // P1: [\s\S]*? 为非贪婪匹配最近闭合的 ```。
      // 若 AI 输出在代码块内嵌套 ```（如 markdown 示例），
      // 贪婪版会跨多个块吞噬，非贪婪可最小化错误配对，保持各块独立。
      html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (match, lang, code) {
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

      // 表格 (| col1 | col2 | ...) — 避开 <pre> 包裹的内容
      var TABLE_REGEX = /\|(.+?)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/g;
      var tableParts = html.split(/(<pre>[\s\S]*?<\/pre>)/g);
      for (var tp = 0; tp < tableParts.length; tp++) {
        if (tableParts[tp].startsWith('<pre>')) continue;
        tableParts[tp] = tableParts[tp].replace(TABLE_REGEX, function (match, headerRow, dataRows) {
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
      }
      html = tableParts.join('');

      // 行内代码 (`) — 内部已是转义后的安全内容
      html = html.replace(/`([^`]+)`/g, function (match, code) {
        return '<code>' + code + '</code>';
      });

      // 标题 h1~h6
      html = html.replace(/^(#{1,6})\s+(.+)$/gm, function (match, hashes, content) {
        return '<h' + hashes.length + '>' + content.trim() + '</h' + hashes.length + '>';
      });

      // 引用 blockquote — 先行合并相邻 > 行再整体包裹
      html = html.replace(/^>\s*.+(?:[\n\r]^>\s*.+)*$/gm, function (match) {
        var inner = match.replace(/^>\s*/gm, '');  // 移除每行的 > 前缀
        return '<blockquote>' + inner + '</blockquote>';
      });

      // 水平线 ---
      html = html.replace(/^-{3,}$/gm, '<hr>');

      // 图片 ![alt](url) — 必须在链接之前处理，避免 `!` 被链接正则误吞
      // 只允许 https?: 和 data:image/ 协议，其他 URL 渲染为普通链接
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (match, alt, url) {
        var safeUrl = Utils.escapeHTML(url);
        if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) {
          return '<img src="' + safeUrl + '" alt="' + Utils.escapeHTML(alt || '图片') + '" style="max-width:100%;border-radius:6px;margin:4px 0;">';
        }
        return '<a href="' + safeUrl + '" target="_blank" rel="noopener">' + Utils.escapeHTML(alt || url) + '</a>';
      });

      // 链接 [text](url) — 仅允许 http/https/mailto/data 协议
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (match, text, url) {
        // P2: 允许锚点和相对路径
        var safeUrl = /^(https?:|mailto:|#|\/)/i.test(url) ? Utils.escapeHTML(url) : '#blocked';
        return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
      });

      // 加粗 **text**（先处理粗体，避免 `**text**` 中的 `**` 被斜体先匹配）
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
     * 导出当前对话为 Markdown
     */
    exportMarkdown: function () {
      var md = '# 对话导出\n\n日期: ' + new Date().toISOString().slice(0, 10) + '\n\n';
      for (var i = 0; i < this.messages.length; i++) {
        var msg = this.messages[i];
        var role = msg.role === 'user' ? '你' : '自由鸟';
        md += '### ' + role + '\n\n' + (msg.content || '') + '\n\n';
      }
      var Utils = window.ZYN3.Utils;
      Utils.downloadFile('对话_' + Date.now() + '.md', md, 'text/markdown');
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
     * 后台调用，直接 fetch 不需要 AbortController
     */
    _generateSummaryAndName: function () {
      if (this.messages.length < 2) return;
      var genId = ++this._summaryGenerationId;
      var tabId = this.currentTabId;
      var prompt = '';
      for (var i = 0; i < this.messages.length; i++) {
        prompt += this.messages[i].role + ': ' + (this.messages[i].content || '').substring(0, 300) + '\n';
      }
      prompt += '\n请分别回复以下两项（用 --- 分隔）：\n' +
        '1. 给这个对话起一个 5 字以内的标题\n' +
        '2. 用以下格式总结本次对话：\n' +
        '## 总结\n3-5句话概述\n' +
        '## 分析\n列出关键决策和变化\n' +
        '## 推荐\n2-3条下一步行动';
      var self = this;
      var API = window.ZYN3.API;
      fetch((API.BASE_URL || 'http://127.0.0.1:18789') + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (API.AUTH_TOKEN || 'ziyouniao-local-token-2026') },
        body: JSON.stringify({ model: 'openclaw', messages: [{ role: 'user', content: prompt }], max_tokens: 500, stream: false }),
        signal: AbortSignal.timeout(30000),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (genId !== self._summaryGenerationId) return; // 已过期
          var result = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
          // P1: 用最后出现的 --- 分隔，避免 AI 响应正文中含 --- 导致错位
          var lastSep = result.lastIndexOf('---');
          var title = lastSep > 0 ? result.substring(0, lastSep).replace(/["""]/g, '').trim().slice(0, 10) : '';
          if (title && tabId) {
            var Tabs = window.ZYN3.Tabs;
            if (Tabs) Tabs.renameTab(tabId, title);
          }
          // 第二部分：结构化摘要（渲染到右侧面板）
          var summary = lastSep > 0 ? result.substring(lastSep + 3).trim() : '';
          if (summary) {
            // P1-11: 先转义 HTML 再应用正则，防止 XSS
            var Utils = window.ZYN3.Utils;
            var html = Utils.escapeHTML(summary)
              .replace(/## (.+)/g, '<h3>$1</h3>')
              .replace(/- (.+)/g, '<li>$1</li>');
            // P1: 渲染前检查当前标签，防止异步回调时标签已切换
            if (tabId === self.currentTabId) {
              var panel = document.getElementById('memory-panel');
              if (panel) panel.innerHTML = html;
            }
            // 保存记忆
            var Storage = window.ZYN3.Storage;
            var memories = Storage.getMemories();
            memories.push({ key: title || '对话', value: summary.slice(0, 100), time: Date.now() });
            if (memories.length > 50) memories = memories.slice(-50);
            Storage.setMemories(memories);
            // 追加到历史日志
            var log = '\n## ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '\n' + summary + '\n---\n';
            Storage.set('summaries', (Storage.get('summaries') || '') + log);
          }
        })
        .catch(function (err) { console.warn('[Chat] Summary failed:', err && err.message); });
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
      this._loadLessonsPanel();
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
        html += '<div class="mem-item">' +
          '<div class="mem-key">' + Utils.escapeHTML(m.key || '') + '</div>' +
          '<div class="mem-val">' + Utils.escapeHTML((m.value || '').slice(0, 100)) + '</div>' +
          // P1: 用 data-mem-key 替代 onclick
          '<button class="mem-del" data-mem-key="' + Utils.escapeHTML(m.key || '') + '">✕</button>' +
        '</div>';
      });
      panel.innerHTML = html;

      // P1: 用 addEventListener 绑定删除按钮
      var self = this;
      panel.querySelectorAll('.mem-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.getAttribute('data-mem-key');
          self._deleteMemory(key);
        });
      });
    },

    /**
     * 删除单条记忆
     */
    _deleteMemory: function (key) {
      var Storage = window.ZYN3.Storage;
      var memories = Storage.getMemories();
      memories = memories.filter(function (m) { return m.key !== key; });
      Storage.setMemories(memories);
      this._renderMemoryPanel();
    },

    /**
     * Prism.js 代码高亮 — 对消息内容中的代码块调用 Prism.highlightElement
     * @param {HTMLElement} containerEl - 包含代码块的消息元素
     */
    _highlightCodeBlocks: function (containerEl) {
      if (typeof Prism === 'undefined') return;
      var codeBlocks = containerEl.querySelectorAll('pre code[class*="language-"]');
      codeBlocks.forEach(function (codeEl) {
        try {
          Prism.highlightElement(codeEl);
        } catch (e) {
          console.warn('[Chat] Prism highlight error:', e);
        }
      });
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Chat = Chat;
})();
