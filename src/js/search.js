/**
 * search.js — Tavily / Serper 真实搜索
 * 命名空间: window.ZYN3.Search
 */
(function () {
  'use strict';

  var TAVILY_KEY = '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';
  var SERPER_KEY = '0d41d475471323f87c675f50e8085d7ef58f60bd';
  var SEARCH_CACHE = {};
  var CACHE_TTL = 3600 * 1000;
  var MAX_CACHE = 100;
  var cacheKeys = [];

  var Search = {
    /**
     * Tavily Search API
     */
    _tavilySearch: async function (query) {
      var res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_KEY, query: query, max_results: 5 }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      var data = await res.json();
      if (!data.results || !data.results.length) return [];
      return data.results.slice(0, 5).map(function (r) {
        return { title: r.title, url: r.url, snippet: r.content || '' };
      });
    },

    /**
     * Serper API fallback
     */
    _serperSearch: async function (query) {
      var res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      var data = await res.json();
      if (!data.organic || !data.organic.length) return [];
      return data.organic.slice(0, 5).map(function (r) {
        return { title: r.title, url: r.link, snippet: r.snippet || '' };
      });
    },

    /**
     * 搜索网页（Tavily → Serper fallback）
     */
    searchWeb: async function (query) {
      var cached = SEARCH_CACHE[query];
      if (cached && Date.now() - cached.time < CACHE_TTL) {
        return { results: cached.results, source: 'cache' };
      }
      var tav = await this._tavilySearch(query).catch(function () { return []; });
      if (tav.length > 0) {
        SEARCH_CACHE[query] = { results: tav, time: Date.now() };
        cacheKeys.push(query);
        if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
        return { results: tav, source: 'tavily' };
      }
      var ser = await this._serperSearch(query).catch(function () { return []; });
      if (ser.length > 0) {
        SEARCH_CACHE[query] = { results: ser, time: Date.now() };
        cacheKeys.push(query);
        if (cacheKeys.length > MAX_CACHE) { delete SEARCH_CACHE[cacheKeys.shift()]; }
        return { results: ser, source: 'serper' };
      }
      return { error: '搜索无结果' };
    },

    /**
     * 免费抓取网页
     */
    fetchURL: async function (url) {
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
