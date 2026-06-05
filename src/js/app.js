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

      // 6. 网关状态检查（含状态指示器更新）
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
      // P2: 去重保护，防止重复绑定事件
      if (this._eventsBound) return;
      this._eventsBound = true;

      // ─── 侧栏切换 ──────────────────────────────────
      var sidebarToggle = document.getElementById('btn-sidebar-toggle');
      if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
          Sidebar.toggle();
        });
      }

      // ─── 历史提问弹出层 ────────────────────────────
      var historyBtn = document.getElementById('btn-history');
      if (historyBtn) {
        historyBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          Sidebar.toggleHistoryPopup();
        });
      }

      // 弹出层搜索过滤
      var historySearch = document.getElementById('history-search');
      if (historySearch) {
        historySearch.addEventListener('input', function () {
          Sidebar.filterHistory(historySearch.value);
        });
      }

      // 点击其他地方关闭历史弹出层
      document.addEventListener('click', function (e) {
        var popup = document.getElementById('history-popup');
        if (!popup || popup.classList.contains('hidden')) return;
        if (!e.target.closest('#btn-history') && !e.target.closest('#history-popup')) {
          popup.classList.add('hidden');
        }
      });

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

      // ─── 图片上传 ──────────────────────────────────
      var imageBtn = document.getElementById('btn-image');
      if (imageBtn) {
        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        imageBtn.addEventListener('click', function () {
          fileInput.click();
        });

        fileInput.addEventListener('change', function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            self.showToast('图片超过 10MB 限制', 'error');
            fileInput.value = '';
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            var input = document.getElementById('message-input');
            if (input) {
              input.value += '\n![图片](' + reader.result + ')\n';
              Utils.autoResizeTextarea(input);
              input.focus();
            }
          };
          reader.readAsDataURL(file);
          fileInput.value = '';
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
          // 输入历史 ↑↓
          if (e.key === 'ArrowUp' && !e.shiftKey && !input.value) {
            e.preventDefault();
            // P2: 空数组显式 guard
            if (!Chat.inputHistory || !Chat.inputHistory.length) return;
            Chat.historyIndex = Math.min(Chat.historyIndex + 1, Chat.inputHistory.length - 1);
            input.value = Chat.inputHistory[Chat.historyIndex] || '';
          } else if (e.key === 'ArrowDown' && !e.shiftKey && !input.value) {
            e.preventDefault();
            if (Chat.historyIndex > 0) {
              Chat.historyIndex--;
              input.value = Chat.inputHistory[Chat.historyIndex] || '';
            } else {
              Chat.historyIndex = -1;
              input.value = '';
            }
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

      // ─── 搜索栏实时搜索 ────────────────────────────
      var searchBar = document.querySelector('.search-bar-input');
      if (searchBar) {
        searchBar.addEventListener('input', function () {
          var q = searchBar.value.toLowerCase();
          var msgs = document.querySelectorAll('.message-content');
          msgs.forEach(function (el) {
            if (!q || el.textContent.toLowerCase().indexOf(q) !== -1) {
              el.style.background = '';
              el.parentElement.parentElement.style.display = '';
            } else {
              el.parentElement.parentElement.style.display = 'none';
            }
          });
        });
      }

      // ─── 模型选择（统一由 settings.js 管理）───────

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

      // ─── 免费搜索 ──────────────────────────────────
      var searchBtn = document.getElementById('btn-web-search');
      if (searchBtn) {
        searchBtn.addEventListener('click', function () {
          var q = prompt('搜索什么？');
          if (!q) return;
          var Search = window.ZYN3.Search;
          if (!Search) return;
          Search.searchWeb(q).then(function (r) {
            var resultsHtml = r.results ? r.results.slice(0, 5).map(function (item) {
              return '- [' + (item.title || '无标题') + '](' + (item.url || '#') + ') ' + (item.snippet || '');
            }).join('\n') : (r.error || '无结果');
            Chat.addMessage('assistant', '**搜索: ' + q + '**\n' + resultsHtml);
          }).catch(function (err) {
            App.showToast('搜索失败: ' + (err.message || err), 'error');
          });
        });
      }

      // ─── 导出当前对话 ──────────────────────────────
      var exportBtn = document.getElementById('btn-export-md');
      if (exportBtn) {
        exportBtn.addEventListener('click', function () {
          Chat.exportMarkdown();
          App.showToast('对话已导出', 'success');
        });
      }

      // ─── 打开数据文件夹 ────────────────────────────
      var openFolderBtn = document.getElementById('btn-open-data-folder');
      if (openFolderBtn) {
        openFolderBtn.addEventListener('click', function () {
          if (window.electronAPI && window.electronAPI.openDataFolder) {
            window.electronAPI.openDataFolder().then(function (res) {
              if (!res.success) {
                self.showToast('打开文件夹失败: ' + (res.error || '未知错误'), 'error');
              } else {
                self.showToast('已打开数据文件夹', 'success');
              }
            });
          } else {
            self.showToast('仅桌面版支持打开文件夹', 'info');
          }
        });
      }

      // ─── 快捷键 ────────────────────────────────────
      document.addEventListener('keydown', function (e) {
        // Cmd/Ctrl + K: 侧栏（不在输入框中触发）
        if ((e.metaKey || e.ctrlKey) && e.key === 'k' && e.target.tagName !== 'TEXTAREA') {
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

        // Ctrl/Cmd+F: 聚焦搜索框
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault();
          var searchBar = document.querySelector('.search-bar-input');
          if (searchBar) searchBar.focus();
        }

        // Escape: 关闭设置 / 停止生成
        if (e.key === 'Escape') {
          if (Settings.visible) {
            Settings.close();
          } else if (Chat.isGenerating) {
            Chat.stopGeneration();
          }
        }

        // Ctrl+Tab: 下一标签
        if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          Tabs.nextTab();
        }

        // Ctrl+Shift+Tab: 上一标签
        if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
          e.preventDefault();
          Tabs.prevTab();
        }

        // Ctrl+W: 关闭当前标签（不在输入框中触发）
        if (e.ctrlKey && e.key === 'w' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
          e.preventDefault();
          Tabs.closeTab(Chat.currentTabId);
        }
      });

      // ─── 文件拖放到输入框 ──────────────────────────
      var dropZone = document.getElementById('message-input');
      if (dropZone) {
        dropZone.addEventListener('dragover', function (e) {
          e.preventDefault();
          dropZone.classList.add('drag-highlight');
        });
        dropZone.addEventListener('dragleave', function () {
          dropZone.classList.remove('drag-highlight');
        });
        dropZone.addEventListener('drop', function (e) {
          e.preventDefault();
          dropZone.classList.remove('drag-highlight');
          var files = e.dataTransfer.files;
          if (!files || !files.length) return;

          // P1: 过滤文本文件后顺序读取，保证顺序
          var textFiles = [];
          for (var fi = 0; fi < files.length; fi++) {
            var f = files[fi];
            // P0-6: 文件类型/大小检查
            if (f.type && (f.type.startsWith('text/') || f.type === 'application/json') && f.size <= 10 * 1024 * 1024) {
              textFiles.push(f);
            }
          }
          if (!textFiles.length) return;

          var allText = '';
          var idx = 0;
          function readNext() {
            if (idx >= textFiles.length) {
              // P1: 在光标位置插入，而非替换整个内容
              var start = dropZone.selectionStart;
              var end = dropZone.selectionEnd;
              var prefix = dropZone.value.substring(0, start);
              var suffix = dropZone.value.substring(end);
              dropZone.value = prefix + (prefix ? '\n' : '') + allText + suffix;
              dropZone.selectionStart = dropZone.selectionEnd = start + allText.length + (prefix ? 1 : 0);
              Utils.autoResizeTextarea(dropZone);
              return;
            }
            var reader = new FileReader();
            reader.onload = function () {
              allText += (allText ? '\n' : '') + reader.result;
              idx++;
              readNext();
            };
            reader.onerror = function () { idx++; readNext(); };
            reader.readAsText(textFiles[idx]);
          }
          readNext();
        });
      }

      // ─── 粘贴图片 ──────────────────────────────────
      document.addEventListener('paste', function (e) {
        // 仅当输入框有焦点时处理图片粘贴
        if (document.activeElement !== document.getElementById('message-input')) return;
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image/') === 0) {
            var file = items[i].getAsFile();
            if (!file || file.size > 10 * 1024 * 1024) continue; // P0-6: 10MB上限
            var reader = new FileReader();
            reader.onload = function () {
              var input = document.getElementById('message-input');
              if (input) input.value += '\n![图片](' + reader.result + ')\n';
            };
            reader.onerror = function () {};
            reader.readAsDataURL(file);
          }
        }
      });

      // ─── 全局文件拖放穿透指示 ──────────────────────
      // P2: body级drag事件，dragover时显示拖放遮罩
      var dragCounter = 0;
      document.body.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        var overlay = document.getElementById('drag-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'drag-overlay';
          overlay.className = 'drag-overlay';
          overlay.innerHTML = '<div class="drag-overlay-text">释放文件以粘贴文本</div>';
          document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
      });
      document.body.addEventListener('dragleave', function (e) {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          var overlay = document.getElementById('drag-overlay');
          if (overlay) overlay.style.display = 'none';
        }
      });
      document.body.addEventListener('drop', function (e) {
        e.preventDefault();
        dragCounter = 0;
        var overlay = document.getElementById('drag-overlay');
        if (overlay) overlay.style.display = 'none';
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
        (type === 'error' ? '<button class="toast-retry">重试</button>' : '') +
        '<button class="toast-close">✕</button>';

      container.appendChild(toast);

      var closeBtn = toast.querySelector('.toast-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          self._removeToast(toast);
        });
      }

      var retryBtn = toast.querySelector('.toast-retry');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          self._removeToast(toast);
          // P1: 使用 retryLastMessage 而非 sendMessage，避免输入框已清空问题
          Chat.retryLastMessage();
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
