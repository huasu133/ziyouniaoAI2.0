/**
 * tool-runner.js — 工具调用引擎
 * 命名空间: window.ZYN3.ToolRunner
 * 提供 AI 自主调用工具的能力（ReAct 模式）
 */
(function () {
  'use strict';

  var MAX_TOOL_CALLS = 5;
  var MAX_LOOP_MS = 60000;

  var ToolRunner = {
    /**
     * 从 AI 回复中提取工具调用
     * 格式: [调用: 工具名 参数]
     * @param {string} text
     * @returns {Array<{tool: string, args: string}>}
     */
    extractToolCalls: function (text) {
      var calls = [];
      var regex = /\[调用:\s*(\w+)\s*([^\]]*)\]/g;
      var match;
      while ((match = regex.exec(text)) !== null) {
        calls.push({ tool: match[1].trim(), args: match[2].trim() });
      }
      return calls;
    },

    /**
     * 执行单个工具
     * @param {{tool: string, args: string}} call
     * @returns {Promise<string>}
     */
    executeTool: async function (call) {
      var tools = {
        search: async function (query) {
          var Search = window.ZYN3.Search;
          if (!Search) return '搜索模块未加载';
          var r = await Search.searchWeb(query);
          return r.error
            ? '搜索失败: ' + r.error
            : JSON.stringify(r.results.slice(0, 3), null, 2);
        },

        fetch: async function (url) {
          var Search = window.ZYN3.Search;
          if (!Search) return '搜索模块未加载';
          var r = await Search.fetchURL(url);
          return r.error
            ? '抓取失败: ' + r.error
            : '标题: ' + r.title + '\n内容: ' + (r.content || '').slice(0, 2000);
        },

        healthcheck: async function () {
          var Gateway = window.ZYN3.Gateway;
          if (!Gateway) return '网关模块未加载';
          var ok = await Gateway.checkHealth();
          return ok ? '网关状态: 正常' : '网关状态: 异常';
        },

        timestamp: async function () {
          return '当前时间: ' + new Date().toISOString();
        },

        expert: async function (args) {
          // 格式: expert 专家ID 问题
          var parts = args.split(/\s+/);
          var id = parts[0];
          var question = parts.slice(1).join(' ');
          if (!id || !question) return '格式错误，请使用 [调用: expert 专家ID 问题]';

          try {
            var res = await fetch('http://127.0.0.1:18789/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ziyouniao-local-token-2026'
              },
              body: JSON.stringify({
                model: 'openclaw/' + id,
                messages: [{ role: 'user', content: question }],
                stream: false
              }),
              signal: AbortSignal.timeout(30000),
            });
            var data = await res.json();
            return data.choices?.[0]?.message?.content || '(无回复)';
          } catch (e) {
            return '调用专家失败: ' + e.message;
          }
        },
      };

      var fn = tools[call.tool];
      if (!fn) {
        return '未知工具: ' + call.tool + '，可用工具: ' + Object.keys(tools).join(', ');
      }
      try {
        return await fn(call.args);
      } catch (e) {
        return '工具执行错误: ' + e.message;
      }
    },

    /**
     * 执行工具循环
     * 在 chat.js 的 onDone 中调用，递归调用自身（最多 MAX_TOOL_CALLS 次）
     * @param {string} fullText - AI 回复全文
     * @param {Array} apiMessages - 当前 API 消息列表（会被追加工具结果）
     * @param {string} currentModel - 当前使用的模型
     * @param {number} toolCallCount - 当前已执行的工具调用次数
     * @returns {Promise<boolean>} - 是否有工具调用
     */
    runToolLoop: async function (fullText, apiMessages, currentModel, toolCallCount) {
      toolCallCount = toolCallCount || 0;
      var calls = this.extractToolCalls(fullText);
      if (calls.length === 0 || toolCallCount >= MAX_TOOL_CALLS) {
        return false; // 无工具或超过限制
      }

      var startTime = Date.now();
      var results = [];
      for (var i = 0; i < calls.length; i++) {
        if (Date.now() - startTime > MAX_LOOP_MS) break; // 总超时保护
        var result = await this.executeTool(calls[i]);
        results.push('[工具 ' + calls[i].tool + ' 结果]:\n' + result);
      }

      // 将工具结果追加到消息列表
      apiMessages.push({
        role: 'system',
        content: '你调用了以下工具，结果如下：\n' +
          results.join('\n\n') +
          '\n\n请根据结果继续回答。如果需要再次调用工具，请再次使用 [调用: 工具名 参数] 格式。'
      });

      return true; // 有工具调用
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.ToolRunner = ToolRunner;
})();
