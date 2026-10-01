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

  async function fetchWithTimeout(url, opts = {}, timeout = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const isGet = !opts.method || opts.method.toUpperCase() === 'GET';
      const sep = url.includes('?') ? '&' : '?';
      // 核心修复：GET 请求附加唯一时间戳参数，天然避免 CORS 预检阻断，同时 100% 穿透手机端浏览器激进缓存
      const fetchUrl = isGet ? `${url}${sep}_t=${Date.now()}` : url;
      const res = await fetch(fetchUrl, {
        cache: 'no-store',
        ...opts,
        signal: controller.signal,
      });
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
   * 双轨健壮请求：始终优先走已绑定的自定义域名 poem.molan.cc.cd
   * 遇偶发网络抖动时对自定义域名进行一次快速重试；仅在极端异常时后备 workers.dev
   */
  async function callApi(path, opts = {}, timeout = 6000) {
    try {
      const res = await fetchWithTimeout(`${CUSTOM_DOMAIN}${path}`, opts, timeout);
      activeBase = CUSTOM_DOMAIN;
      return res;
    } catch (e1) {
      // 遇突发超时或抖动，先重试一次自定义域名（网络抖动恢复）
      try {
        const retryRes = await fetchWithTimeout(`${CUSTOM_DOMAIN}${path}`, opts, timeout + 1500);
        activeBase = CUSTOM_DOMAIN;
        return retryRes;
      } catch (eRetry) {
        // 尝试 workers.dev 后备通道
        try {
          const res2 = await fetchWithTimeout(`${WORKERS_DEV}${path}`, opts, timeout);
          activeBase = WORKERS_DEV;
          return res2;
        } catch (e2) {
          throw new Error(`云端服务请求异常: ${e1.message}`);
        }
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

    /** 启动与手动同步数据 (优先本地缓存即时更新，随后与云端 D1 数据库合并并持久化至本地) */
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

      // 2. 与 Cloudflare D1 远程数据库通信
      try {
        const [remoteInfo, remotePoems] = await Promise.all([
          this.getBookInfo().catch((e) => {
            console.warn('云端装帧配置暂不可达，沿用当前配置：', e.message);
            return null;
          }),
          this.getPoems(),
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

        // 核心修复：远程拉取成功后，必须立即同步写入本地 localStorage，避免手机端刷新后依然是陈旧数据
        if (typeof BOOK_INFO !== 'undefined' && typeof POEMS !== 'undefined') {
          this.saveLocal(BOOK_INFO, POEMS);
        }

        return {
          success: true,
          updated,
          count: (remotePoems && remotePoems.length) || (typeof POEMS !== 'undefined' ? POEMS.length : 0),
        };
      } catch (err) {
        console.warn('云端同步跳过，使用本地/缓存诗册：', err.message);
        return {
          success: false,
          error: err,
          count: typeof POEMS !== 'undefined' ? POEMS.length : 0,
        };
      }
    },
  };

  window.PoemAPI = PoemAPI;
})();
