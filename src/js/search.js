/**
 * search.js — Tavily / Serper 真实搜索
 * 命名空间: window.ZYN3.Search
 * P0-1: API Key 从 localStorage zyn3:search-keys 读取，不再硬编码
 * P0-3: fetchURL 通过 IPC 代理，避免 CSP 限制
 * P1: Claw 主搜索，结果 <3 条时尝试 Tavily 补充合并
 */
(function () {
  'use strict';

  var SEARCH_CACHE = {};
  var CACHE_TTL = 3600 * 1000;
  var MAX_CACHE = 100;
  var cacheKeys = [];

  /**
   * 从 localStorage 读取搜索 API Key
   * @returns {{ tavily?: string, serper?: string }}
   */
  function _getKeys() {
    try {
      var raw = localStorage.getItem('zyn3:search-keys');
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  var Search = {
    /**
     * Tavily Search API（需要配置 Key）
     */
    _tavilySearch: async function (query) {
      var keys = _getKeys();
      if (!keys.tavily) return [];
      try {
        var res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: keys.tavily, query: query, max_results: 5 }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        var data = await res.json();
        if (!data.results || !data.results.length) return [];
        return data.results.slice(0, 5).map(function (r) {
          return { title: r.title, url: r.url, snippet: r.content || '' };
        });
      } catch (_) {
        return [];
      }
    },

    /**
     * Serper API fallback（需要配置 Key）
     */
    _serperSearch: async function (query) {
      var keys = _getKeys();
      if (!keys.serper) return [];
      try {
        var res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': keys.serper, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        var data = await res.json();
        if (!data.organic || !data.organic.length) return [];
        return data.organic.slice(0, 5).map(function (r) {
          return { title: r.title, url: r.link, snippet: r.snippet || '' };
        });
      } catch (_) {
        return [];
      }
    },

    /**
     * Claw Search API（免费，无 Key）
     */
    _clawSearch: async function (query) {
      try {
        var url = 'https://www.claw-search.com/api/search?q=' + encodeURIComponent(query);
        var res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        var data = await res.json();
        if (!data.web || !data.web.results || !data.web.results.length) return [];
        return data.web.results.slice(0, 5).map(function (r) {
          return { title: r.title, url: r.url, snippet: r.description || '' };
        });
      } catch (_) {
        return [];
      }
    },

    /**
     * 搜索网页（Claw 主搜索，结果不足时 Tavily 补充合并）
     */
    searchWeb: async function (query) {
      var cached = SEARCH_CACHE[query];
      if (cached && Date.now() - cached.time < CACHE_TTL) {
        return { results: cached.results, source: 'cache' };
      }

      // Claw 主搜索
      var claw = await this._clawSearch(query);
      if (claw.length >= 3) {
        SEARCH_CACHE[query] = { results: claw, time: Date.now() };
        cacheKeys.push(query);
        if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
        return { results: claw, source: 'claw' };
      }

      // P1: Claw 结果 < 3 条时，尝试 Tavily 补充并合并去重
      if (claw.length > 0) {
        var tav = await this._tavilySearch(query);
        var seen = {};
        claw.forEach(function (r) { seen[r.url] = true; });
        tav.forEach(function (r) {
          if (!seen[r.url]) {
            claw.push(r);
            seen[r.url] = true;
          }
        });
        // 合并后仍有结果就返回
        if (claw.length > 0) {
          SEARCH_CACHE[query] = { results: claw.slice(0, 5), time: Date.now() };
          cacheKeys.push(query);
          if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
          return { results: SEARCH_CACHE[query].results, source: 'claw+tavily' };
        }
      }

      // Claw 完全无结果：Tavily → Serper
      var tav = await this._tavilySearch(query);
      if (tav.length > 0) {
        SEARCH_CACHE[query] = { results: tav, time: Date.now() };
        cacheKeys.push(query);
        if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
        return { results: tav, source: 'tavily' };
      }
      var ser = await this._serperSearch(query);
      if (ser.length > 0) {
        SEARCH_CACHE[query] = { results: ser, time: Date.now() };
        cacheKeys.push(query);
        if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
        return { results: ser, source: 'serper' };
      }
      return { error: '搜索无结果' };
    },

    /**
     * 抓取网页（通过 IPC 代理，避免 CSP 限制）
     * P0-3: 改为通过 window.electronAPI.fetchUrl IPC 发送请求
     */
    fetchURL: async function (url) {
      // 优先使用 IPC 代理（Electron 环境）
      if (window.electronAPI && window.electronAPI.fetchUrl) {
        try {
          var result = await window.electronAPI.fetchUrl(url);
          if (result.error) return { error: result.error };
          return { title: result.title || url, content: result.data || '' };
        } catch (e) {
          return { error: 'IPC抓取失败: ' + (e.message || '') };
        }
      }
      // 回退到直接 fetch（非 Electron 或降级）
      try {
        var res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ziyouniao/3.0)' },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { error: 'HTTP ' + res.status };
        var raw = await res.text();
        var title = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = title ? title[1] : url;
        var cleaned = raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { title: title, content: cleaned.slice(0, 5000) };
      } catch (e) {
        return { error: '抓取失败: ' + e.message };
      }
    },
  };

  window.ZYN3 = window.ZYN3 || {};
  window.ZYN3.Search = Search;
})();
