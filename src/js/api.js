/**
 * api.js — API 通信 + SSE 解析
 * 命名空间: window.ZYN3.API
 */
(function () {
  'use strict';

  const API_BASE = 'http://127.0.0.1:18789';

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
      var model = options.model || 'deepseek-chat';
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

      fetch(API_BASE + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
            reader.read().then(function (result) {
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
              if (err.name === 'AbortError') {
                onDone(fullText || '(已停止)');
              } else {
                onError(err);
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
              } catch (_) {
                // 解析失败跳过
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
            onError(err);
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
      return fetch(API_BASE + '/v1/models', {
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
            { id: 'deepseek-chat' },
            { id: 'deepseek-reasoner' },
          ];
        });
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.API = API;
})();
