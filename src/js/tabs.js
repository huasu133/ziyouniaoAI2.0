/**
 * tabs.js — 多标签页管理
 * 命名空间: window.ZYN3.Tabs
 */
(function () {
  'use strict';

  var Utils = window.ZYN3.Utils;
  var Storage = window.ZYN3.Storage;
  var Chat = window.ZYN3.Chat;

  var Tabs = {
    /**
     * 标签列表
     */
    tabs: [],

    /**
     * 当前活跃标签 ID
     */
    activeTabId: null,

    /**
     * 初始化
     */
    init: function () {
      this.tabs = Storage.getTabs();
      this.activeTabId = Storage.getActiveTab();

      // 如果没有标签，创建默认标签
      if (!this.tabs || this.tabs.length === 0) {
        this._createDefaultTab();
      }

      // 如果 activeTabId 无效，使用第一个
      var valid = this.tabs.some(function (t) { return t.id === this.activeTabId; }.bind(this));
      if (!valid && this.tabs.length > 0) {
        this.activeTabId = this.tabs[0].id;
        Storage.setActiveTab(this.activeTabId);
      }

      this._renderTabs();
      this._activateTab(this.activeTabId);
    },

    /**
     * 创建默认标签
     */
    _createDefaultTab: function () {
      var tab = {
        id: Utils.generateId(),
        title: '新对话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        model: 'deepseek-chat',
      };
      this.tabs.push(tab);
      this.activeTabId = tab.id;
      this._saveTabs();
      Storage.setActiveTab(this.activeTabId);
    },

    /**
     * 新建标签
     */
    createTab: function () {
      var tab = {
        id: Utils.generateId(),
        title: '新对话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        model: 'deepseek-chat',
      };
      this.tabs.push(tab);
      this.activeTabId = tab.id;
      this._saveTabs();
      Storage.setActiveTab(this.activeTabId);
      this._renderTabs();
      this._activateTab(this.activeTabId);

      // 聚焦输入框
      var input = document.getElementById('message-input');
      if (input) input.focus();

      return tab;
    },

    /**
     * 切换到指定标签
     * @param {string} tabId
     */
    switchTab: function (tabId) {
      if (tabId === this.activeTabId) return;
      if (this.isGenerating()) {
        // P1: 提示用户
        var App = window.ZYN3.App;
        if (App && App.showToast) {
          App.showToast('请先停止当前生成再切换标签', 'info');
        }
        return;
      }

      this.activeTabId = tabId;
      Storage.setActiveTab(this.activeTabId);
      Chat._renderAll = false; // 重置懒加载标志
      this._renderTabs();
      this._activateTab(this.activeTabId);
    },

    /**
     * 关闭标签
     * @param {string} tabId
     * @param {Object} event - 可选，用于 stopPropagation
     */
    closeTab: function (tabId, event) {
      if (event) {
        event.stopPropagation();
      }

      // P0: 关闭标签前检查是否正在生成，若有则先中止
      var Chat = window.ZYN3.Chat;
      if (Chat && Chat.currentTabId === tabId && Chat.isGenerating) {
        Chat.stopGeneration();
      }

      if (this.tabs.length <= 1) {
        // 只有一个标签时，清空内容但不删除
        // P0: 检查生成状态
        if (this.isGenerating()) {
          try { Chat.stopGeneration(); } catch (_) {}
        }
        try {
          Chat.clearMessages();
        } catch (e) {
          console.error('[Tabs] clearMessages error:', e);
        }
        var tab = this.tabs[0];
        tab.title = '新对话';
        tab.updatedAt = Date.now();
        tab.messageCount = 0;
        this._saveTabs();
        this._renderTabs();
        return;
      }

      // 找到要关闭的标签索引
      var idx = -1;
      for (var i = 0; i < this.tabs.length; i++) {
        if (this.tabs[i].id === tabId) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return;

      // 删除标签数据
      Storage.removeTab(tabId);
      this.tabs.splice(idx, 1);

      // 如果关闭的是当前标签，切换到相邻标签
      if (tabId === this.activeTabId) {
        var newIdx = Math.min(idx, this.tabs.length - 1);
        this.activeTabId = this.tabs[newIdx].id;
        Storage.setActiveTab(this.activeTabId);
      }

      this._saveTabs();
      this._renderTabs();
      this._activateTab(this.activeTabId);
    },

    /**
     * 重命名标签
     * @param {string} tabId
     * @param {string} title
     */
    renameTab: function (tabId, title) {
      for (var i = 0; i < this.tabs.length; i++) {
        if (this.tabs[i].id === tabId) {
          this.tabs[i].title = title || '新对话';
          this._saveTabs();
          this._renderTabs();
          return;
        }
      }
    },

    /**
     * 更新标签名称（根据首条消息）
     * @param {string} tabId
     * @param {string} firstUserMessage
     */
    updateTabTitle: function (tabId, firstUserMessage) {
      var title = Utils.getMessagePreview(firstUserMessage) || '新对话';
      this.renameTab(tabId, title);
    },

    /**
     * 渲染标签栏
     */
    _renderTabs: function () {
      var tabBar = document.getElementById('tab-bar');
      if (!tabBar) return;

      var html = '';
      for (var i = 0; i < this.tabs.length; i++) {
        var tab = this.tabs[i];
        var isActive = tab.id === this.activeTabId;
        html += '' +
          '<div class="tab-item' + (isActive ? ' active' : '') + '" data-tab-id="' + tab.id + '">' +
            '<span class="tab-item-title" title="' + Utils.escapeHTML(tab.title) + '">' + Utils.escapeHTML(tab.title) + '</span>' +
            '<button class="tab-item-close" data-tab-id="' + tab.id + '" title="关闭标签">✕</button>' +
          '</div>';
      }
      tabBar.innerHTML = html;

      // 绑定事件
      var self = this;
      tabBar.querySelectorAll('.tab-item').forEach(function (el) {
        el.addEventListener('click', function (e) {
          // 如果点击的是关闭按钮，不要切换标签
          if (e.target.closest('.tab-item-close')) return;
          var id = el.getAttribute('data-tab-id');
          self.switchTab(id);
        });
      });

      tabBar.querySelectorAll('.tab-item-close').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          var id = btn.getAttribute('data-tab-id');
          self.closeTab(id, e);
        });
      });
    },

    /**
     * 激活标签（加载消息）
     * @param {string} tabId
     */
    _activateTab: function (tabId) {
      Chat.loadMessages(tabId);

      // 更新当前标签模型选择
      var tab = this._findTab(tabId);
      if (tab && tab.model) {
        Chat.switchModel(tab.model);
      }

      // 更新输入框状态
      var input = document.getElementById('message-input');
      if (input) {
        input.disabled = Chat.isGenerating;
      }
    },

    /**
     * 检查是否正在生成
     * @returns {boolean}
     */
    isGenerating: function () {
      return Chat.isGenerating;
    },

    /**
     * 查找标签
     * @param {string} tabId
     * @returns {Object|null}
     */
    _findTab: function (tabId) {
      for (var i = 0; i < this.tabs.length; i++) {
        if (this.tabs[i].id === tabId) return this.tabs[i];
      }
      return null;
    },

    /**
     * 保存标签列表
     */
    _saveTabs: function () {
      Storage.setTabs(this.tabs);
    },

    /**
     * 添加消息后更新标签（更新 updatedAt 和 messageCount）
     * @param {string} tabId
     */
    onMessageAdded: function (tabId) {
      var tab = this._findTab(tabId);
      if (tab) {
        tab.updatedAt = Date.now();
        tab.messageCount = (Storage.getTabMessages(tabId) || []).length;
        this._saveTabs();
        // 防抖渲染 — 流式输出时避免每秒渲染100次标签栏
        if (!this._renderTimer) {
          var self = this;
          this._renderTimer = setTimeout(function () {
            self._renderTabs();
            self._renderTimer = null;
          }, 200);
        }
      }
    },

    /**
     * 切换到下一个标签
     */
    nextTab: function () {
      if (this.tabs.length <= 1) return;
      var idx = -1;
      for (var i = 0; i < this.tabs.length; i++) {
        if (this.tabs[i].id === this.activeTabId) { idx = i; break; }
      }
      var nextIdx = (idx + 1) % this.tabs.length;
      this.switchTab(this.tabs[nextIdx].id);
    },

    /**
     * 切换到上一个标签
     */
    prevTab: function () {
      if (this.tabs.length <= 1) return;
      var idx = -1;
      for (var i = 0; i < this.tabs.length; i++) {
        if (this.tabs[i].id === this.activeTabId) { idx = i; break; }
      }
      var prevIdx = (idx - 1 + this.tabs.length) % this.tabs.length;
      this.switchTab(this.tabs[prevIdx].id);
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Tabs = Tabs;
})();
