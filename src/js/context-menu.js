/**
 * context-menu.js — 右键菜单
 * 命名空间: window.ZYN3.ContextMenu
 */
(function () {
  'use strict';

  var ContextMenu = {
    /**
     * 当前菜单是否可见
     */
    visible: false,

    /**
     * 初始化
     */
    init: function () {
      var self = this;

      // 先移除旧监听器，防止累积
      if (this._contextMenuHandler) {
        document.removeEventListener('contextmenu', this._contextMenuHandler);
      }
      if (this._clickHandler) {
        document.removeEventListener('click', this._clickHandler);
      }
      if (this._keydownHandler) {
        document.removeEventListener('keydown', this._keydownHandler);
      }

      // 全局右键
      this._contextMenuHandler = function (e) {
        // 检查是否在可显示菜单的元素上
        var target = e.target;

        // 消息内容区域的右键
        var messageContent = target.closest('.message-content');
        if (messageContent) {
          e.preventDefault();
          var messageEl = messageContent.closest('.message');
          var selectedText = window.getSelection().toString().trim();

          if (selectedText) {
            self._showSelectionMenu(e.clientX, e.clientY, selectedText);
          } else {
            self._showMessageMenu(e.clientX, e.clientY, messageEl);
          }
          return;
        }

        // 输入框右键
        var messageInput = target.closest('#message-input');
        if (messageInput) {
          e.preventDefault();
          var inputText = window.getSelection().toString().trim();
          if (inputText) {
            self._showSelectionMenu(e.clientX, e.clientY, inputText);
          } else {
            self._showInputMenu(e.clientX, e.clientY);
          }
          return;
        }

        // 代码块右键
        var codeBlock = target.closest('pre code');
        if (codeBlock) {
          e.preventDefault();
          self._showCodeMenu(e.clientX, e.clientY, codeBlock.textContent);
          return;
        }
      };
      document.addEventListener('contextmenu', this._contextMenuHandler);

      // 点击其他地方关闭菜单
      this._clickHandler = function () {
        self.hide();
      };
      document.addEventListener('click', this._clickHandler);

      // Escape 关闭
      this._keydownHandler = function (e) {
        if (e.key === 'Escape' && self.visible) {
          self.hide();
        }
      };
      document.addEventListener('keydown', this._keydownHandler);
    },

    /**
     * 显示菜单
     * @param {number} x
     * @param {number} y
     * @param {Array} items - [{label, icon?, shortcut?, action, danger?}]
     */
    show: function (x, y, items) {
      this.hide();

      var menu = document.getElementById('context-menu');
      if (!menu) return;

      var html = '';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.divider) {
          html += '<div class="context-menu-divider"></div>';
        } else {
          html += '' +
            '<div class="context-menu-item' + (item.danger ? ' danger' : '') + '" data-index="' + i + '">' +
              (item.icon ? '<span class="context-menu-icon">' + item.icon + '</span>' : '') +
              '<span>' + item.label + '</span>' +
              (item.shortcut ? '<span class="context-menu-shortcut">' + item.shortcut + '</span>' : '') +
            '</div>';
        }
      }
      menu.innerHTML = html;

      // P0: 先设初始位置再显示，避免在(0,0)闪现一帧
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.classList.remove('hidden');

      // 读实际尺寸后二次修正，防溢出窗口边界
      var rect = menu.getBoundingClientRect();
      var maxX = window.innerWidth - rect.width - 10;
      var maxY = window.innerHeight - rect.height - 10;
      var finalLeft = Math.max(0, Math.min(x, maxX));
      var finalTop = Math.max(0, Math.min(y, maxY));
      if (finalLeft !== x) menu.style.left = finalLeft + 'px';
      if (finalTop !== y) menu.style.top = finalTop + 'px';

      this.visible = true;

      // 绑定点击事件
      var self = this;
      menu.querySelectorAll('.context-menu-item').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var index = parseInt(el.getAttribute('data-index'), 10);
          if (items[index] && items[index].action) {
            items[index].action();
          }
          self.hide();
        });
      });
    },

    /**
     * 隐藏菜单
     */
    hide: function () {
      var menu = document.getElementById('context-menu');
      if (menu) {
        menu.classList.add('hidden');
        menu.innerHTML = '';
      }
      this.visible = false;
    },

    /**
     * 选中文本的菜单
     */
    _showSelectionMenu: function (x, y, selectedText) {
      this.show(x, y, [
        {
          label: '复制',
          shortcut: 'Cmd+C',
          action: function () {
            navigator.clipboard.writeText(selectedText).catch(function () {
              // 降级方案
              var ta = document.createElement('textarea');
              ta.value = selectedText;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            });
          },
        },
        { divider: true },
        {
          label: '搜索选中内容',
          action: function () {
            // Electron 中 window.open 可能不在系统浏览器打开，但 href 方式仍可工作
            var query = encodeURIComponent(selectedText.substring(0, 200));
            window.open('https://www.google.com/search?q=' + query, '_blank', 'noopener');
          },
        },
      ]);
    },

    /**
     * 消息菜单
     */
    _showMessageMenu: function (x, y, messageEl) {
      var messageId = messageEl ? messageEl.id.replace('msg-', '') : '';
      var self = this;

      this.show(x, y, [
        {
          label: '复制消息',
          action: function () {
            var contentEl = messageEl.querySelector('.message-content');
            if (contentEl) {
              var text = contentEl.textContent || '';
              navigator.clipboard.writeText(text).catch(function () {});
            }
          },
        },
        {
          label: '复制代码',
          action: function () {
            var codeEl = messageEl.querySelector('pre code');
            if (codeEl) {
              navigator.clipboard.writeText(codeEl.textContent).catch(function () {});
            } else {
              var App = window.ZYN3.App;
              if (App && App.showToast) App.showToast('此消息不含代码块', 'info');
            }
          },
        },
        { divider: true },
        {
          label: '删除消息',
          danger: true,
          action: function () {
            self._deleteMessage(messageId);
          },
        },
      ]);
    },

    /**
     * 输入框菜单
     */
    _showInputMenu: function (x, y) {
      this.show(x, y, [
        {
          label: '粘贴',
          shortcut: 'Cmd+V',
          action: function () {
            navigator.clipboard.readText().then(function (text) {
              var input = document.getElementById('message-input');
              if (input) {
                var start = input.selectionStart;
                var end = input.selectionEnd;
                input.value = input.value.substring(0, start) + text + input.value.substring(end);
                input.selectionStart = input.selectionEnd = start + text.length;
                input.focus();
              }
            }).catch(function () {});
          },
        },
        { divider: true },
        {
          label: '清空输入',
          action: function () {
            var input = document.getElementById('message-input');
            if (input) {
              input.value = '';
              input.focus();
            }
          },
        },
      ]);
    },

    /**
     * 代码块菜单
     */
    _showCodeMenu: function (x, y, codeText) {
      this.show(x, y, [
        {
          label: '复制代码',
          shortcut: 'Cmd+C',
          action: function () {
            navigator.clipboard.writeText(codeText).catch(function () {});
          },
        },
      ]);
    },

    /**
     * 删除消息
     */
    _deleteMessage: function (messageId) {
      if (!messageId) return;
      var Chat = window.ZYN3.Chat;
      if (!Chat) return;

      var idx = -1;
      for (var i = 0; i < Chat.messages.length; i++) {
        if (Chat.messages[i].id === messageId) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return;

      Chat.messages.splice(idx, 1);
      Chat.renderMessages();

      // P1: 删除消息後更新标签元数据
      var Tabs = window.ZYN3.Tabs;
      if (Tabs && Tabs.onMessageAdded && Chat.currentTabId) {
        Tabs.onMessageAdded(Chat.currentTabId);
      }

      // 保存
      if (Chat.currentTabId) {
        var Storage = window.ZYN3.Storage;
        Storage.setTabMessages(Chat.currentTabId, Chat.messages);
      }
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.ContextMenu = ContextMenu;
})();
