/**
 * 古籍诗册 Cloudflare API 客户端
 * 前端托管在 GitHub Pages，后端直连 Cloudflare Worker + D1 数据库
 * 支持自定义域名 poem.molan.cc.cd 与 workers.dev 自动回退
 */
(function () {
  'use strict';

  const CUSTOM_DOMAIN = 'https://poem.molan.cc.cd';
  const WORKERS_DEV = 'https://ancient-poetry-api.mokelin-studio.workers.dev';
  const LOCAL_STORAGE_KEY = 'MOLAN_POEM_BOOK_DATA_V1';

  async function fetchWithTimeout(url, opts = {}, timeout = 5000) {
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

  let activeBase = CUSTOM_DOMAIN;

  /**
   * 双轨健壮请求：优先走已绑定的自定义域名 poem.molan.cc.cd，遇异常自动回退 workers.dev
   */
  async function callApi(path, opts = {}, timeout = 6000) {
    try {
      const res = await fetchWithTimeout(`${activeBase}${path}`, opts, timeout);
      return res;
    } catch (e1) {
      const fallback = activeBase === CUSTOM_DOMAIN ? WORKERS_DEV : CUSTOM_DOMAIN;
      try {
        const res2 = await fetchWithTimeout(`${fallback}${path}`, opts, timeout);
        activeBase = fallback;
        return res2;
      } catch (e2) {
        throw new Error(`云端服务请求异常: ${e1.message}`);
      }
    }
  }

  const PoemAPI = {
    customDomain: CUSTOM_DOMAIN,
    fallbackUrl: WORKERS_DEV,
    get activeDomain() { return activeBase.replace(/^https?:\/\//, ''); },

    /** 健康检查 */
    async checkHealth() {
      try {
        const res = await callApi('/api/health', {}, 3500);
        return res && res.status === 'ok';
      } catch (_) {
        return false;
      }
    },

    /** 获取远程诗作列表 */
    async getPoems() {
      const json = await callApi('/api/poems');
      return json.data || [];
    },

    /** 题入新诗 (写入 Cloudflare D1) */
    async createPoem(poem) {
      const res = await callApi('/api/poems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(poem),
      }, 8000);
      return res;
    },

    /** 更新单篇诗作 PUT /api/poems/:id */
    async updatePoem(id, poem) {
      const res = await callApi(`/api/poems/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(poem),
      }, 8000);
      return res;
    },

    /** 删除单篇诗作 DELETE /api/poems/:id */
    async deletePoem(id) {
      const res = await callApi(`/api/poems/${id}`, {
        method: 'DELETE',
      }, 8000);
      return res;
    },

    /** 获取全书装帧配置 GET /api/book-info */
    async getBookInfo() {
      const json = await callApi('/api/book-info');
      return json.data || {};
    },

    /** 更新全书装帧配置 PUT /api/book-info */
    async updateBookInfo(info) {
      const res = await callApi('/api/book-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info),
      }, 8000);
      return res;
    },

    /** 全册装帧与所有诗篇一键原子同步 (支持增删改与顺序重排) */
    async syncFullBook(info, poems) {
      const payload = {
        info: info || (typeof BOOK_INFO !== 'undefined' ? BOOK_INFO : {}),
        poems: poems || (typeof POEMS !== 'undefined' ? POEMS : []),
      };
      const res = await callApi('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 10000);
      return res;
    },

    /** 保存至本地缓存 (localStorage) */
    saveLocal(info, poems) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
          info: info || (typeof BOOK_INFO !== 'undefined' ? BOOK_INFO : null),
          poems: poems || (typeof POEMS !== 'undefined' ? POEMS : null),
          timestamp: Date.now(),
        }));
        return true;
      } catch (e) {
        console.warn('保存本地缓存失败：', e);
        return false;
      }
    },

    /** 读取本地缓存 */
    loadLocal() {
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (_) {
        return null;
      }
    },

    /** 清空本地缓存 */
    clearLocal() {
      try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      } catch (_) {}
    },

    /** 启动时同步数据 (优先本地缓存即时更新，随后与云端 D1 数据库合并) */
    async syncRemoteData() {
      // 1. 先加载本地缓存（0ms 瞬间就绪）
      const local = this.loadLocal();
      if (local) {
        if (local.info && typeof BOOK_INFO !== 'undefined') {
          Object.assign(BOOK_INFO, local.info);
        }
        if (Array.isArray(local.poems) && local.poems.length > 0 && typeof POEMS !== 'undefined') {
          POEMS.length = 0;
          local.poems.forEach((p) => POEMS.push(p));
        }
      }

      // 2. 尝试与 Cloudflare D1 远程数据库通信
      try {
        const [remoteInfo, remotePoems] = await Promise.all([
          this.getBookInfo().catch(() => null),
          this.getPoems().catch(() => null),
        ]);

        let updated = false;

        if (remoteInfo && typeof BOOK_INFO !== 'undefined') {
          if (remoteInfo.title && !/^\?+$/.test(remoteInfo.title)) BOOK_INFO.title = remoteInfo.title;
          if (remoteInfo.subTitle && !/^\?+$/.test(remoteInfo.subTitle)) BOOK_INFO.subTitle = remoteInfo.subTitle;
          if (remoteInfo.titleSlip && !/^\?+$/.test(remoteInfo.titleSlip)) BOOK_INFO.titleSlip = remoteInfo.titleSlip;
          if (remoteInfo.author && !/^\?+$/.test(remoteInfo.author)) BOOK_INFO.author = remoteInfo.author;
          if (remoteInfo.signature) BOOK_INFO.signature = remoteInfo.signature;
          const coloStr = Array.isArray(remoteInfo.colophon) ? remoteInfo.colophon.join('') : String(remoteInfo.colophon || '');
          if (coloStr && /[\u4e00-\u9fa5]/.test(coloStr) && !coloStr.includes('???')) {
            BOOK_INFO.colophon = remoteInfo.colophon;
          }
          updated = true;
        }

        if (Array.isArray(remotePoems) && remotePoems.length > 0 && typeof POEMS !== 'undefined') {
          POEMS.length = 0;
          remotePoems.forEach((p) => POEMS.push(p));
          updated = true;
        }

        return { success: true, updated };
      } catch (err) {
        console.warn('云端同步跳过，使用本地/缓存诗册：', err.message);
        return { success: false, error: err };
      }
    },
  };

  window.PoemAPI = PoemAPI;
})();
