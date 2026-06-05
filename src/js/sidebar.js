/**
 * sidebar.js — 侧栏会话列表
 * 命名空间: window.ZYN3.Sidebar
 */
(function () {
  'use strict';

  var Utils = window.ZYN3.Utils;
  var Storage = window.ZYN3.Storage;
  var Tabs = window.ZYN3.Tabs;

  var Sidebar = {
    /**
     * 是否折叠
     */
    collapsed: false,

    /**
     * 初始化
     */
    init: function () {
      this.collapsed = false;
      this.render();
    },

    /**
     * 切换折叠
     */
    toggle: function () {
      this.collapsed = !this.collapsed;
      var sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.classList.toggle('collapsed', this.collapsed);
      }
    },

    /**
     * 展开侧栏
     */
    expand: function () {
      this.collapsed = false;
      var sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.classList.remove('collapsed');
      }
    },

    /**
     * 渲染会话列表
     */
    render: function () {
      var list = document.getElementById('conversation-list');
      if (!list) return;

      var tabs = Storage.getTabs();
      var activeTab = Storage.getActiveTab();

      // 更新会话计数
      var countEl = document.getElementById('conv-count');
      if (countEl) countEl.textContent = '(' + (tabs ? tabs.length : 0) + ')';

      if (!tabs || !Array.isArray(tabs) || tabs.length === 0) {
        list.innerHTML = '' +
          '<div class="conversation-empty">' +
            '<div class="conversation-empty-icon">' +
              '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '</div>' +
            '<div class="conversation-empty-text">暂无会话</div>' +
          '</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i];
        var isActive = tab.id === activeTab;
        var messages = Storage.getTabMessages(tab.id) || [];
        var lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        var preview = lastMsg ? Utils.getMessagePreview(lastMsg.content) : '';

        html += '' +
          '<div class="conversation-item' + (isActive ? ' active' : '') + '" data-tab-id="' + Utils.escapeHTML(tab.id) + '">' +
            '<div class="conversation-item-icon">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '</div>' +
            '<div class="conversation-item-info">' +
              '<div class="conversation-item-title">' + Utils.escapeHTML(tab.title || '新对话') + '</div>' +
              '<div class="conversation-item-preview">' + Utils.escapeHTML(preview || '空对话') + '</div>' +
            '</div>' +
            '<div class="conversation-item-time">' + Utils.formatRelativeDate(tab.updatedAt) + '</div>' +
            '<button class="conversation-item-folder" data-tab-id="' + Utils.escapeHTML(tab.id) + '" title="打开数据文件夹">📁</button>' +
            '<button class="conversation-item-delete" data-tab-id="' + Utils.escapeHTML(tab.id) + '" title="删除">✕</button>' +
          '</div>';
      }
      list.innerHTML = html;

      // 绑定事件
      var self = this;
      list.querySelectorAll('.conversation-item').forEach(function (el) {
        el.addEventListener('click', function (e) {
          if (e.target.closest('.conversation-item-delete')) return;
          var tabId = el.getAttribute('data-tab-id');
          Tabs.switchTab(tabId);
          self.render();
        });
      });

      list.querySelectorAll('.conversation-item-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirm('确定删除此对话？')) return;
          var tabId = btn.getAttribute('data-tab-id');
          Tabs.closeTab(tabId);
          self.render();
        });
      });

      // 双击标题行内重命名
      list.querySelectorAll('.conversation-item-title').forEach(function (titleEl) {
        titleEl.addEventListener('dblclick', function (e) {
          e.stopPropagation();
          var convItem = titleEl.closest('.conversation-item');
          if (!convItem) return;
          var tabId = convItem.getAttribute('data-tab-id');
          var currentTitle = titleEl.textContent;

          // 创建输入框替换标题
          var input = document.createElement('input');
          input.type = 'text';
          input.className = 'conv-rename-input';
          input.value = currentTitle;
          input.maxLength = 100;
          titleEl.style.display = 'none';
          titleEl.parentNode.insertBefore(input, titleEl.nextSibling);
          input.focus();
          input.select();

          var cleanup = function (save) {
            if (save) {
              var newTitle = input.value.trim() || '新对话';
              Tabs.renameTab(tabId, newTitle);
              self.render();
            } else {
              titleEl.style.display = '';
            }
            if (input.parentNode) input.parentNode.removeChild(input);
          };

          input.addEventListener('blur', function () { cleanup(true); });

          input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              cleanup(true);
            } else if (ev.key === 'Escape') {
              ev.preventDefault();
              cleanup(false);
            }
          });
        });
      });
    },

    /**
     * 清空所有会话
     */
    clearAll: function () {
      var Chat = window.ZYN3.Chat;
      if (Chat && Chat.isGenerating) Chat.stopGeneration();
      if (confirm('确定清空所有会话历史？此操作不可撤销。')) {
        Storage.clearAllConversations();
        // 重新创建默认标签
        Tabs.init();
        this.render();
      }
    },

    /**
     * 根据搜索词过滤会话列表
     * @param {string} query - 搜索关键词
     */
    filter: function (query) {
      var list = document.getElementById('conversation-list');
      if (!list) return;

      var items = list.querySelectorAll('.conversation-item');
      var q = (query || '').toLowerCase().trim();

      items.forEach(function (item) {
        var titleEl = item.querySelector('.conversation-item-title');
        var title = titleEl ? titleEl.textContent.toLowerCase() : '';
        if (!q || title.indexOf(q) !== -1) {
          item.style.display = '';
        } else {
          item.style.display = 'none';
        }
      });
    },

    // ─── 历史提问弹出层 ──────────────────────────
    /**
     * 渲染历史弹出层
     */
    renderHistoryPopup: function () {
      var list = document.getElementById('history-list');
      if (!list) return;

      var tabs = Storage.getTabs();
      var activeTab = Storage.getActiveTab();

      if (!tabs || !Array.isArray(tabs) || tabs.length === 0) {
        list.innerHTML = '<div class="history-empty">暂无历史提问</div>';
        return;
      }

      var html = '';
      for (var i = tabs.length - 1; i >= 0; i--) {
        var tab = tabs[i];
        var isActive = tab.id === activeTab;
        var messages = Storage.getTabMessages(tab.id) || [];
        var lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
        var preview = lastMsg ? Utils.getMessagePreview(lastMsg.content) : '';

        html += '' +
          '<div class="conversation-item' + (isActive ? ' active' : '') + '" data-tab-id="' + Utils.escapeHTML(tab.id) + '">' +
            '<div class="conversation-item-icon">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '</div>' +
            '<div class="conversation-item-info">' +
              '<div class="conversation-item-title">' + Utils.escapeHTML(tab.title || '新对话') + '</div>' +
              '<div class="conversation-item-preview">' + Utils.escapeHTML(preview || '空对话') + '</div>' +
            '</div>' +
          '</div>';
      }
      list.innerHTML = html;

      // 绑定点击事件
      var self = this;
      list.querySelectorAll('.conversation-item').forEach(function (el) {
        el.addEventListener('click', function () {
          var tabId = el.getAttribute('data-tab-id');
          Tabs.switchTab(tabId);
          self.render();
          self.renderHistoryPopup();
          self.closeHistoryPopup();
        });
      });
    },

    /**
     * 切换历史弹出层
     */
    toggleHistoryPopup: function () {
      var popup = document.getElementById('history-popup');
      if (!popup) return;
      var isHidden = popup.classList.contains('hidden');
      if (isHidden) {
        this.renderHistoryPopup();
        popup.classList.remove('hidden');
        // 聚焦搜索框
        var searchInput = document.getElementById('history-search');
        if (searchInput) setTimeout(function () { searchInput.focus(); }, 50);
      } else {
        popup.classList.add('hidden');
      }
    },

    /**
     * 过滤历史弹出层
     * @param {string} query
     */
    filterHistory: function (query) {
      var list = document.getElementById('history-list');
      if (!list) return;
      var items = list.querySelectorAll('.conversation-item');
      var q = (query || '').toLowerCase().trim();
      items.forEach(function (item) {
        var titleEl = item.querySelector('.conversation-item-title');
        var title = titleEl ? titleEl.textContent.toLowerCase() : '';
        item.style.display = (!q || title.indexOf(q) !== -1) ? '' : 'none';
      });
    },

    /**
     * 关闭历史弹出层
     */
    closeHistoryPopup: function () {
      var popup = document.getElementById('history-popup');
      if (popup) popup.classList.add('hidden');
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Sidebar = Sidebar;
})();
