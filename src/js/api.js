/**
 * api.js — API 通信 + SSE 解析
 * 对接本地 OpenClaw Gateway REST API（OpenAI 兼容）
 */
(function () {
  'use strict';

  const API_BASE = 'http://127.0.0.1:18789';
  const AUTH_TOKEN = 'ziyouniao-local-token-2026';

  const API = {
    // 共享常量，供其他模块引用
    BASE_URL: API_BASE,
    AUTH_TOKEN: AUTH_TOKEN,
    sendMessage: function (messages, options) {
      // 有 agentId 则路由到对应 OpenClaw Agent，否则使用前端选择的模型
      var model = options.agentId ? ('openclaw/' + options.agentId) : (options.model || 'openclaw');
      var temperature = options.temperature !== undefined ? options.temperature : 0.7;
      var maxTokens = options.maxTokens || 4096;
      var onMessage = options.onMessage || function () {};
      var onDone = options.onDone || function () {};
      var onError = options.onError || function () {};
      var onReasoning = options.onReasoning || function () {};

      var abortController = new AbortController();
      var signal = abortController.signal;

      var body = JSON.stringify({
        model: model,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens,
        stream: true,
      });

      function doFetch(attempt) {
        if (attempt === undefined) attempt = 1;
        fetch(API_BASE + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + AUTH_TOKEN,
            'Accept': 'text/event-stream',
          },
          body: body,
          signal: signal,
        })
          .then(function (response) {
            if (!response.ok) {
              // 5xx 非流式错误可重试
              if (response.status >= 500 && attempt <= 2) {
                return new Promise(function (r) { setTimeout(r, 1000 * attempt); }).then(function () { return doFetch(attempt + 1); });
              }
              throw new Error('HTTP ' + response.status);
            }
          var reader = response.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';
          var fullText = '';

          function readChunk() {
            var timeoutId;
            var readPromise = reader.read();
            var timeoutPromise = new Promise(function (_, reject) {
              timeoutId = setTimeout(function () { reject(new Error('Stream timeout')); }, 60000);
            });

            Promise.race([readPromise, timeoutPromise])
              .then(function (result) {
              clearTimeout(timeoutId);
              if (result.done) {
                if (buffer.trim()) processBuffer(buffer);
                onDone(fullText);
                return;
              }
              buffer += decoder.decode(result.value, { stream: true });
              var parts = buffer.split('\n\n');
              buffer = parts.pop() || '';
              for (var i = 0; i < parts.length; i++) {
                var line = parts[i].trim();
                if (line) processLine(line);
              }
              readChunk();
            }).catch(function (err) {
              reader.cancel();
              if (err.name === 'AbortError') { onDone(fullText || '(已停止)'); }
              else { console.warn('[API] Stream error:', err.message); try { onError(err); } catch (e) { console.warn('[API] onError threw:', e); } }
            });
          }

          function processLine(line) {
            if (line.startsWith('data: ')) {
              var dataStr = line.substring(6).trim();
              if (dataStr === '[DONE]') return;
              try {
                var data = JSON.parse(dataStr);
                if (data.choices && data.choices.length > 0) {
                  var delta = data.choices[0].delta;
                  if (delta) {
                    var reasoning = delta.reasoning_content;
                    var content = delta.content;
                    if (reasoning) {
                      fullText += reasoning;
                      onReasoning(reasoning);
                    }
                    if (content) {
                      fullText += content;
                      onMessage(content);
                    }
                  }
                }
              } catch (e) { console.warn('[API] SSE parse error:', e.message); }
            }
          }

          function processBuffer(buf) {
            var parts = buf.split('\n\n');
            for (var i = 0; i < parts.length; i++) {
              var l = parts[i].trim();
              if (l) processLine(l);
            }
          }

          readChunk();
        })
        .catch(function (err) {
          if (err.name === 'AbortError') { onDone('(已停止)'); }
          // 网络错误重试（连接级别，非流式）
          else if (attempt <= 2 && err.message !== 'Stream timeout') {
            return new Promise(function (r) { setTimeout(r, 1000 * attempt); }).then(function () { return doFetch(attempt + 1); });
          }
          else { try { onError(err); } catch (_) {} }
        });
      }

      doFetch(1);
      return abortController;
    },

    listModels: function () {
      return fetch(API_BASE + '/v1/models', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + AUTH_TOKEN },
        signal: AbortSignal.timeout(5000),
      })
        .then(function (res) { return res.ok ? res.json() : { data: [] }; })
        .then(function (data) { return (data.data || []); })
        .catch(function () {
          return [{ id: 'deepseek-chat' }];
        });
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.API = API;
})();
