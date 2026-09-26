/**
 * 古籍诗册 Cloudflare API 客户端
 * 前端托管在 GitHub Pages，后端直连 Cloudflare Worker + D1 数据库
 */
(function () {
  'use strict';

  const API_BASE = 'https://ancient-poetry-api.mokelin-studio.workers.dev';

  async function fetchWithTimeout(url, opts = {}, timeout = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  const PoemAPI = {
    baseUrl: API_BASE,

    /** 获取远程诗作列表 */
    async getPoems() {
      const json = await fetchWithTimeout(`${API_BASE}/api/poems`);
      return json.data || [];
    },

    /** 题入新诗 (写入 Cloudflare D1) */
    async createPoem(poem) {
      const res = await fetchWithTimeout(`${API_BASE}/api/poems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(poem),
      }, 8000);
      return res;
    },

    /** 获取书册配置 */
    async getBookInfo() {
      const json = await fetchWithTimeout(`${API_BASE}/api/book-info`);
      return json.data || {};
    },

    /** 启动时同步远程数据 (带超时，离线或断网自动回退本地数据) */
    async syncRemoteData() {
      try {
        const [remoteInfo, remotePoems] = await Promise.all([
          this.getBookInfo().catch(() => null),
          this.getPoems().catch(() => null),
        ]);

        let updated = false;

        if (remoteInfo && typeof BOOK_INFO !== 'undefined') {
          if (remoteInfo.title) BOOK_INFO.title = remoteInfo.title;
          if (remoteInfo.subTitle) BOOK_INFO.subTitle = remoteInfo.subTitle;
          if (remoteInfo.titleSlip) BOOK_INFO.titleSlip = remoteInfo.titleSlip;
          if (remoteInfo.author) BOOK_INFO.author = remoteInfo.author;
          if (remoteInfo.signature) BOOK_INFO.signature = remoteInfo.signature;
          if (remoteInfo.colophon) BOOK_INFO.colophon = remoteInfo.colophon;
          updated = true;
        }

        if (Array.isArray(remotePoems) && remotePoems.length > 0 && typeof POEMS !== 'undefined') {
          // 清空并灌入云端 D1 诗作
          POEMS.length = 0;
          remotePoems.forEach((p) => POEMS.push(p));
          updated = true;
        }

        return { success: true, updated };
      } catch (err) {
        console.warn('云端同步跳过，使用本地离线诗册：', err.message);
        return { success: false, error: err };
      }
    },
  };

  window.PoemAPI = PoemAPI;
})();
