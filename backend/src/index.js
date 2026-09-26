/**
 * 古籍诗册 Cloudflare Worker 后端 API (Cloudflare D1 + CORS)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // 处理 CORS 预检请求
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // 1. 健康检查
      if (path === '/' || path === '/api/health') {
        return jsonResponse({
          status: 'ok',
          service: 'ancient-poetry-api',
          version: '1.0.0',
          time: new Date().toISOString(),
        });
      }

      // 2. 获取书册配置 GET /api/book-info
      if (path === '/api/book-info' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT key, value FROM book_config').all();
        const config = {};
        for (const row of results) {
          try {
            config[row.key] = JSON.parse(row.value);
          } catch {
            config[row.key] = row.value;
          }
        }
        return jsonResponse({ success: true, data: config });
      }

      // 3. 更新书册配置 PUT /api/book-info
      if (path === '/api/book-info' && method === 'PUT') {
        const body = await request.json();
        for (const [k, v] of Object.entries(body)) {
          const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          await env.DB.prepare(
            'INSERT INTO book_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2'
          ).bind(k, valStr).run();
        }
        return jsonResponse({ success: true, message: '书册配置更新成功' });
      }

      // 3.5 全册一键原子同步 POST /api/sync
      if (path === '/api/sync' && method === 'POST') {
        const body = await request.json();
        const { info, poems } = body;

        // 1. 同步全书配置
        if (info && typeof info === 'object') {
          for (const [k, v] of Object.entries(info)) {
            const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            await env.DB.prepare(
              'INSERT INTO book_config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2'
            ).bind(k, valStr).run();
          }
        }

        // 2. 同步诗作列表（精确同步增、删、改与次序）
        if (Array.isArray(poems) && poems.length > 0) {
          await env.DB.prepare('DELETE FROM poems').run();
          for (let idx = 0; idx < poems.length; idx++) {
            const p = poems[idx];
            const title = String(p.title || '').trim();
            const author = String(p.author || '墨瀾').trim();
            const linesArr = Array.isArray(p.lines) ? p.lines : String(p.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
            const linesJson = JSON.stringify(linesArr);
            const date = p.date || new Date().toISOString().split('T')[0];
            const place = String(p.place || '').trim();
            const note = String(p.note || '').trim();
            const signature = p.signature || 'season';
            const sealImg = p.sealImg || 'assets/seal.png';
            const sortOrder = idx + 1;

            await env.DB.prepare(
              `INSERT INTO poems (title, author, lines, date, place, note, signature, seal_img, sort_order)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
            ).bind(title, author, linesJson, date, place, note, signature, sealImg, sortOrder).run();
          }
        }

        return jsonResponse({ success: true, message: '全册装帧与所有诗篇已原子同步至云端 D1 数据库' });
      }

      // 4. 获取所有诗作列表 GET /api/poems
      if (path === '/api/poems' && method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM poems WHERE is_published = 1 ORDER BY sort_order ASC, date ASC, id ASC'
        ).all();

        const poems = results.map((row) => {
          let lines = [];
          try {
            lines = JSON.parse(row.lines);
          } catch {
            lines = [row.lines];
          }
          return {
            id: row.id,
            title: row.title,
            author: row.author,
            lines,
            date: row.date,
            lunar_date: row.lunar_date,
            place: row.place || '',
            note: row.note || '',
            signature: row.signature || 'season',
            sealImg: row.seal_img || 'assets/seal.png',
            sort_order: row.sort_order,
          };
        });

        return jsonResponse({ success: true, count: poems.length, data: poems });
      }

      // 5. 题入新诗 POST /api/poems
      if (path === '/api/poems' && method === 'POST') {
        const body = await request.json();
        if (!body.title || !body.lines) {
          return jsonResponse({ success: false, error: '缺少必填字段 title 或 lines' }, 400);
        }

        const linesArr = Array.isArray(body.lines)
          ? body.lines
          : String(body.lines).split('\n').map((l) => l.trim()).filter(Boolean);

        const linesJson = JSON.stringify(linesArr);
        const title = String(body.title).trim();
        const author = body.author ? String(body.author).trim() : '墨瀾';
        const date = body.date || new Date().toISOString().split('T')[0];
        const place = body.place ? String(body.place).trim() : '';
        const note = body.note ? String(body.note).trim() : '';
        const signature = body.signature || 'season';
        const sealImg = body.sealImg || 'assets/seal.png';

        // 获取最大 sort_order
        const maxOrder = await env.DB.prepare('SELECT MAX(sort_order) as m FROM poems').first('m') || 0;
        const nextOrder = maxOrder + 1;

        const result = await env.DB.prepare(
          `INSERT INTO poems (title, author, lines, date, place, note, signature, seal_img, sort_order)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
        ).bind(title, author, linesJson, date, place, note, signature, sealImg, nextOrder).run();

        return jsonResponse({
          success: true,
          message: '诗作题入成功',
          data: {
            id: result.meta.last_row_id,
            title,
            author,
            lines: linesArr,
            date,
            place,
            note,
            signature,
            sealImg,
          },
        }, 201);
      }

      // 6. 更新诗作 PUT /api/poems/:id
      const matchUpdate = path.match(/^\/api\/poems\/(\d+)$/);
      if (matchUpdate && method === 'PUT') {
        const id = parseInt(matchUpdate[1]);
        const body = await request.json();

        const updates = [];
        const binds = [];
        let i = 1;

        if (body.title !== undefined) { updates.push(`title = ?${i++}`); binds.push(body.title); }
        if (body.author !== undefined) { updates.push(`author = ?${i++}`); binds.push(body.author); }
        if (body.lines !== undefined) {
          const l = Array.isArray(body.lines) ? JSON.stringify(body.lines) : JSON.stringify(String(body.lines).split('\n'));
          updates.push(`lines = ?${i++}`);
          binds.push(l);
        }
        if (body.date !== undefined) { updates.push(`date = ?${i++}`); binds.push(body.date); }
        if (body.place !== undefined) { updates.push(`place = ?${i++}`); binds.push(body.place); }
        if (body.note !== undefined) { updates.push(`note = ?${i++}`); binds.push(body.note); }
        if (body.signature !== undefined) { updates.push(`signature = ?${i++}`); binds.push(body.signature); }
        if (body.is_published !== undefined) { updates.push(`is_published = ?${i++}`); binds.push(body.is_published ? 1 : 0); }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        binds.push(id);

        if (updates.length > 1) {
          await env.DB.prepare(`UPDATE poems SET ${updates.join(', ')} WHERE id = ?${i}`).bind(...binds).run();
        }

        return jsonResponse({ success: true, message: '诗作更新成功' });
      }

      // 7. 删除诗作 DELETE /api/poems/:id
      if (matchUpdate && method === 'DELETE') {
        const id = parseInt(matchUpdate[1]);
        await env.DB.prepare('DELETE FROM poems WHERE id = ?1').bind(id).run();
        return jsonResponse({ success: true, message: '诗作已删除' });
      }

      return jsonResponse({ error: '未找到请求的接口 (404)' }, 404);
    } catch (err) {
      console.error(err);
      return jsonResponse({ success: false, error: err.message || String(err) }, 500);
    }
  },
};
