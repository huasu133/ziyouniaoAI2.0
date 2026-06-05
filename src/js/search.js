/**
 * search.js — 免费搜索 + 网页抓取
 * 命名空间: window.ZYN3.Search
 * 从2.0手册 §6.3 + §6.4 移植
 */
(function () {
  'use strict';

  var SEARCH_CACHE = {};
  var CACHE_TTL = 3600 * 1000;
  var MAX_CACHE = 100;
  var cacheKeys = [];

  var Search = {
    /**
     * Claw Search API
     * @param {string} query
     * @returns {Promise<Array>}
     */
    _clawSearch: async function (query) {
      var url = 'https://www.claw-search.com/api/search?q=' + encodeURIComponent(query);
      var res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      var data = await res.json();
      if (!data.web || !data.web.results || !data.web.results.length) return [];
      return data.web.results.slice(0, 5).map(function (r) {
        return { title: r.title, url: r.url, snippet: r.description || '' };
      });
    },

    /**
     * DuckDuckGo HTML 搜索
     * @param {string} query
     * @returns {Promise<Array>}
     */
    _duckduckgoSearch: async function (query) {
      var url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
      var res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ziyouniao/3.0)' },
        signal: AbortSignal.timeout(15000),
      });
      var html = await res.text();
      var results = [];
      var regex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      var match;
      while ((match = regex.exec(html)) !== null && results.length < 5) {
        var title = match[2].replace(/<[^>]+>/g, '').trim();
        if (title) results.push({ title: title, url: match[1] });
      }
      return results;
    },

    /**
     * 搜索网页（Claw → DuckDuckGo fallback）
     * @param {string} query
     * @returns {Promise<Object>}
     */
    searchWeb: async function (query) {
      var cached = SEARCH_CACHE[query];
      if (cached && Date.now() - cached.time < CACHE_TTL) {
        return { results: cached.results, source: 'cache' };
      }
      var claw = await this._clawSearch(query).catch(function () { return []; });
      if (claw.length > 0) {
        SEARCH_CACHE[query] = { results: claw, time: Date.now() };
        cacheKeys.push(query);
        if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
        return { results: claw, source: 'claw' };
      }
      var ddg = await this._duckduckgoSearch(query).catch(function () { return []; });
      if (ddg.length > 0) {
        SEARCH_CACHE[query] = { results: ddg, time: Date.now() };
        cacheKeys.push(query);
        if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
        return { results: ddg, source: 'duckduckgo' };
      }
      return { error: '搜索无结果（请检查网络连接）' };
    },

    /**
     * 免费抓取网页
     * @param {string} url
     * @returns {Promise<Object>}
     */
    fetchURL: async function (url) {
      try {
        var raw;
        if (window.electronAPI && window.electronAPI.httpGet) {
          raw = await window.electronAPI.httpGet(url);
        } else {
          var res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Ziyouniao/3.0)' },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { error: 'HTTP ' + res.status };
          raw = await res.text();
        }
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
