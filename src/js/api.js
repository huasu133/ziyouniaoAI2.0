/**
 * api.js — API 通信 + SSE 解析
 * 命名空间: window.ZYN3.API
 *
 * 2026-06-05: OpenClaw 2026.6.1 网关不提供 /v1/chat REST API。
 * 改为直连 DeepSeek API。OpenClaw 网关仅用于健康检查和高级功能。
 */
(function () {
  'use strict';

  const GATEWAY_BASE = 'http://127.0.0.1:18789';
  const DEEPSEEK_BASE = 'https://api.deepseek.com';

  const API = {
    /**
     * 发送聊天消息（流式 SSE）
     * @param {Array} messages - 消息数组 [{role, content}]
     * @param {Object} options
     * @param {string} options.model - 模型名称
     * @param {number} options.temperature
     * @param {number} options.maxTokens
     * @param {Function} options.onMessage - 收到每个 delta 的回调(text)
     * @param {Function} options.onDone - 完成回调(fullText)
     * @param {Function} options.onError - 错误回调(err)
     * @returns {AbortController} - 用于手动停止
     */
    sendMessage: function (messages, options) {
      var model = options.model || 'deepseek-v4-flash';
      var temperature = options.temperature !== undefined ? options.temperature : 0.7;
      var maxTokens = options.maxTokens || 4096;
      var onMessage = options.onMessage || function () {};
      var onDone = options.onDone || function () {};
      var onError = options.onError || function () {};

      // P0-7: 创建 AbortController, signal 传给 fetch
      var abortController = new AbortController();
      var signal = abortController.signal;

      var body = JSON.stringify({
        model: model,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens,
        stream: true,
      });

      // 获取 API Key（优先 localStorage，回退 OpenClaw 网关不暴露Key）
      var Storage = window.ZYN3 && window.ZYN3.Storage;
      var apiKey = Storage ? (Storage.getSettings().deepseekKey || '') : '';

      if (!apiKey) {
        onError(new Error('请先在设置面板输入 DeepSeek API Key'));
        return abortController;
      }

      fetch(DEEPSEEK_BASE + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'Accept': 'text/event-stream',
        },
        body: body,
        signal: signal,
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('HTTP ' + response.status + ': ' + response.statusText);
          }
          var reader = response.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';
          var fullText = '';

          function readChunk() {
            // 60s 无数据超时保护
            var timeoutId;
            var readPromise = reader.read();
            var timeoutPromise = new Promise(function (_, reject) {
              timeoutId = setTimeout(function () {
                reject(new Error('Stream timeout'));
              }, 60000);
            });

            Promise.race([readPromise, timeoutPromise])
              .then(function (result) {
              clearTimeout(timeoutId);
              if (result.done) {
                // 处理缓冲区剩余数据
                if (buffer.trim()) {
                  processBuffer(buffer);
                }
                onDone(fullText);
                return;
              }

              buffer += decoder.decode(result.value, { stream: true });

              // SSE 消息以 \n\n 分隔
              var parts = buffer.split('\n\n');
              // 最后一个可能不完整
              buffer = parts.pop() || '';

              for (var i = 0; i < parts.length; i++) {
                var line = parts[i].trim();
                if (!line) continue;
                processLine(line);
              }

              readChunk();
            }).catch(function (err) {
              reader.cancel(); // P0-7: 释放reader资源
              if (err.name === 'AbortError') {
                onDone(fullText || '(已停止)');
              } else {
                // P2: onError 外抛异常兜底
                try { onError(err); } catch (_) {}
              }
            });
          }

          function processLine(line) {
            // SSE 格式: data: {JSON}
            if (line.startsWith('data: ')) {
              var dataStr = line.substring(6).trim();
              // 流结束标记
              if (dataStr === '[DONE]') {
                return;
              }
              try {
                var data = JSON.parse(dataStr);
                var content = '';
                if (data.choices && data.choices.length > 0) {
                  var delta = data.choices[0].delta;
                  if (delta && delta.content) {
                    content = delta.content;
                  }
                }
                if (content) {
                  fullText += content;
                  onMessage(content);
                }
              } catch (e) {
                // P1: SSE 解析失败时输出调试信息
                console.warn('[API] SSE parse error:', line, e.message);
              }
            }
          }

          function processBuffer(buf) {
            var lines = buf.split('\n');
            for (var i = 0; i < lines.length; i++) {
              processLine(lines[i].trim());
            }
          }

          readChunk();
        })
        .catch(function (err) {
          if (err.name === 'AbortError') {
            onDone('(已停止)');
          } else {
            // P2: onError 外抛异常兜底
            try { onError(err); } catch (_) {}
          }
        });

      // 返回 AbortController，以便外面可以停止
      return abortController;
    },

    /**
     * 列出可用模型
     * @returns {Promise<Array>}
     */
    listModels: function () {
      return fetch(DEEPSEEK_BASE + '/v1/models', {
        method: 'GET',
        mode: 'cors',
        signal: AbortSignal.timeout(5000),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data.data && Array.isArray(data.data)) {
            return data.data;
          }
          return [];
        })
        .catch(function () {
          // 如果 API 不支持列表，返回默认
          return [
            { id: 'deepseek-v4-flash' },
            { id: 'deepseek-v4-pro' },
          ];
        });
    },
    /**
     * 带重试的 fetch（仅连接阶段重试，流式不重试）
     * 备用：连接阶段重试，当前未被调用
     * @param {string} url
     * @param {Object} options
     * @param {number} maxRetries
     * @returns {Promise<Response>}
     */
    connectWithRetry: async function (url, options, maxRetries) {
      if (maxRetries === undefined) maxRetries = 2;
      for (var i = 0; i < maxRetries; i++) {
        try {
          var res = await fetch(url, options);
          if (res.ok) return res;
          if (res.status < 500) return res; // 4xx 不重试
        } catch (e) {
          if (i === maxRetries - 1) throw e;
        }
        await new Promise(function (r) { setTimeout(r, 1000 * (i + 1)); });
      }
      throw new Error('连接失败');
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.API = API;
})();
