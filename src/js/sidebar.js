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

      if (!tabs || tabs.length === 0) {
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
          '<div class="conversation-item' + (isActive ? ' active' : '') + '" data-tab-id="' + tab.id + '">' +
            '<div class="conversation-item-icon">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '</div>' +
            '<div class="conversation-item-info">' +
              '<div class="conversation-item-title">' + Utils.escapeHTML(tab.title || '新对话') + '</div>' +
              '<div class="conversation-item-preview">' + Utils.escapeHTML(preview || '空对话') + '</div>' +
            '</div>' +
            '<div class="conversation-item-time">' + Utils.formatRelativeDate(tab.updatedAt) + '</div>' +
            '<button class="conversation-item-delete" data-tab-id="' + tab.id + '" title="删除">✕</button>' +
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
          var tabId = btn.getAttribute('data-tab-id');
          Tabs.closeTab(tabId);
          self.render();
        });
      });
    },

    /**
     * 清空所有会话
     */
    clearAll: function () {
      if (confirm('确定清空所有会话历史？此操作不可撤销。')) {
        Storage.clearAllConversations();
        // 重新创建默认标签
        Tabs.init();
        this.render();
      }
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Sidebar = Sidebar;
})();
