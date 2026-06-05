/**
 * storage.js — localStorage 统一接口
 * 所有 key 以 zyn3: 开头
 * 命名空间: window.ZYN3.Storage
 */
(function () {
  'use strict';

  const NS = 'zyn3:';

  const Storage = {
    /**
     * 获取原始 localStorage 值
     * @param {string} key - 不带命名空间前缀
     * @param {*} defaultVal
     * @returns {*}
     */
    get: function (key, defaultVal) {
      if (defaultVal === undefined) defaultVal = null;
      try {
        const raw = localStorage.getItem(NS + key);
        if (raw === null) return defaultVal;
        return JSON.parse(raw);
      } catch (_) {
        return defaultVal;
      }
    },

    /**
     * 设置值
     * @param {string} key
     * @param {*} value
     */
    set: function (key, value) {
      try {
        localStorage.setItem(NS + key, JSON.stringify(value));
      } catch (err) {
        console.error('[Storage] Failed to set', key, err);
      }
    },

    /**
     * 删除键
     * @param {string} key
     */
    remove: function (key) {
      try {
        localStorage.removeItem(NS + key);
      } catch (err) {
        console.error('[Storage] Failed to remove', key, err);
      }
    },

    /**
     * 获取所有匹配前缀的键
     * @param {string} prefix
     * @returns {string[]}
     */
    keys: function (prefix) {
      try {
        const results = [];
        const fullPrefix = NS + prefix;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(fullPrefix)) {
            results.push(k.substring(NS.length));
          }
        }
        return results;
      } catch (err) {
        console.error('[Storage] Failed to list keys:', err);
        return [];
      }
    },

    // ─── 标签页 ──────────────────────────────────────

    /**
     * 获取所有标签页元数据
     * @returns {Array}
     */
    getTabs: function () {
      return this.get('tabs', []);
    },

    /**
     * 保存标签页元数据
     * @param {Array} tabs
     */
    setTabs: function (tabs) {
      this.set('tabs', tabs);
    },

    /**
     * 获取单个标签页的消息
     * @param {string} tabId
     * @returns {Array}
     */
    getTabMessages: function (tabId) {
      return this.get('tab:' + tabId, []);
    },

    /**
     * 保存单个标签页的消息
     * @param {string} tabId
     * @param {Array} messages
     */
    setTabMessages: function (tabId, messages) {
      this.set('tab:' + tabId, messages);
    },

    /**
     * 删除单个标签页数据
     * @param {string} tabId
     */
    removeTab: function (tabId) {
      this.remove('tab:' + tabId);
    },

    /**
     * 获取活跃标签ID
     * @returns {string|null}
     */
    getActiveTab: function () {
      return this.get('activeTab', null);
    },

    /**
     * 设置活跃标签ID
     * @param {string} tabId
     */
    setActiveTab: function (tabId) {
      this.set('activeTab', tabId);
    },

    // ─── 设置 ────────────────────────────────────────

    /**
     * 获取设置
     * @returns {Object}
     */
    getSettings: function () {
      return this.get('settings', {
        theme: 'dark',
        fontSize: 'medium',
        temperature: 0.7,
        maxTokens: 4096,
        model: 'deepseek-chat',
        style: '',
      });
    },

    /**
     * 保存设置
     * @param {Object} settings
     */
    setSettings: function (settings) {
      this.set('settings', settings);
    },

    // ─── 输入历史 ────────────────────────────────────

    /**
     * 获取输入历史
     * @returns {Array}
     */
    getInputHistory: function () {
      return this.get('inputHistory', []);
    },

    /**
     * 保存输入历史
     * @param {Array} history
     */
    setInputHistory: function (history) {
      // 最多保留50条
      if (history.length > 50) {
        history = history.slice(-50);
      }
      this.set('inputHistory', history);
    },

    /**
     * 添加输入历史项
     * @param {string} text
     */
    addInputHistory: function (text) {
      if (!text || !text.trim()) return;
      const history = this.getInputHistory();
      // 去重: 移除相同内容
      const filtered = history.filter(function (item) {
        return item !== text;
      });
      filtered.push(text);
      this.setInputHistory(filtered);
    },

    // ─── 教训记录 ────────────────────────────────────

    /**
     * 获取教训记录
     * @returns {Array}
     */
    getLessons: function () {
      return this.get('lessons', []);
    },

    /**
     * 保存教训记录
     * @param {Array} lessons
     */
    setLessons: function (lessons) {
      this.set('lessons', lessons);
    },

    // ─── 搜索 API Key ────────────────────────────────

    /**
     * 获取搜索 API Key
     * @returns {{ tavily?: string, serper?: string }}
     */
    getSearchKeys: function () {
      return this.get('search-keys', {});
    },

    /**
     * 保存搜索 API Key
     * @param {{ tavily?: string, serper?: string }} keys
     */
    setSearchKeys: function (keys) {
      this.set('search-keys', keys);
    },

    // ─── AI 记忆 ─────────────────────────────────────

    /**
     * 获取 AI 记忆
     * @returns {Array}
     */
    getMemories: function () {
      return this.get('memories', []);
    },

    /**
     * 保存 AI 记忆
     * @param {Array} memories
     */
    setMemories: function (memories) {
      this.set('memories', memories);
    },

    // ─── 批量操作 ────────────────────────────────────

    /**
     * 保存所有数据（退出前调用）
     * 数据已由各模块实时保存，此为协调信号
     */
    saveAll: function () {
      console.log('[Storage] saveAll called — persisting memory state');
      try {
        // P0: 从内存对象主动拉取最新状态，而非重放 localStorage
        var Chat = window.ZYN3.Chat;
        var Tabs = window.ZYN3.Tabs;

        // 保存当前聊天消息
        if (Chat && Chat.currentTabId && Chat.messages) {
          this.setTabMessages(Chat.currentTabId, Chat.messages);
        }

        // 保存标签列表
        if (Tabs && Tabs.tabs) {
          this.setTabs(Tabs.tabs);
        }

        // 同步设置（确保退出前持久化内存中的最新设置）
        var settings = this.getSettings();
        if (settings) {
          this.setSettings(settings);
        }
      } catch (e) {
        console.error('[Storage] saveAll error:', e);
      }
      console.log('[Storage] saveAll complete');
    },

    /**
     * 清空所有对话数据（保留设置）
     */
    clearAllConversations: function () {
      const tabs = this.getTabs();
      tabs.forEach(function (tab) {
        this.removeTab(tab.id);
      }.bind(this));
      this.setTabs([]);
      this.remove('activeTab');
    },

    /**
     * 导出所有对话数据
     * @returns {Object}
     */
    exportAll: function () {
      const tabs = this.getTabs();
      const tabData = {};
      tabs.forEach(function (tab) {
        tabData[tab.id] = this.getTabMessages(tab.id);
      }.bind(this));
      return {
        version: '3.0',
        exportTime: new Date().toISOString(),
        tabs: tabs,
        tabMessages: tabData,
        settings: this.getSettings(),
      };
    },

    /**
     * 导入对话数据
     * @param {Object} data
     * @returns {boolean}
     */
    importData: function (data) {
      try {
        if (!data || !data.tabs || !Array.isArray(data.tabs)) return false;
        const existingTabs = this.getTabs();
        const existingIds = {};
        existingTabs.forEach(function (t) { existingIds[t.id] = true; });

        data.tabs.forEach(function (tab) {
          // P0-Bug #1: 先保存原始ID，再重命名，用原始ID查消息
          var origId = tab.id;
          if (existingIds[tab.id]) {
            // ID冲突时追加后缀
            tab.id = tab.id + '_' + Date.now().toString(36);
          }
          // P1: 将新生成的 tab.id 添加到 existingIds，防止 data.tabs 内部 ID 冲突
          existingIds[tab.id] = true;
          var messages = (data.tabMessages && data.tabMessages[origId]) || [];
          this.setTabMessages(tab.id, messages);
        }.bind(this));

        this.setTabs(existingTabs.concat(data.tabs));
        // 导入 settings
        if (data.settings) this.setSettings(data.settings);
        return true;
      } catch (err) {
        console.error('[Storage] Import failed:', err);
        return false;
      }
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Storage = Storage;
})();
