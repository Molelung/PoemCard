/* ==========================================================================
 *  typeset.js —— 竖排排版：一诗一页，诗末自动落款钤印
 *  一「列」= 一竖行；一「叶」= 正反两面（古书以叶计）
 *  列序自书口向书脊排（竖排右起），正反面同一套画法
 * ========================================================================== */
window.Typeset = (function () {
  'use strict';

  const CN = '〇一二三四五六七八九';
  function cnNum(n) {
    if (n <= 0) return '〇';
    if (n < 10) return CN[n];
    if (n === 10) return '十';
    if (n < 20) return '十' + CN[n - 10];
    const t = Math.floor(n / 10), o = n % 10;
    return CN[t] + '十' + (o ? CN[o] : '');
  }

  const chunk = (str, rows) => {
    const out = [];
    for (let i = 0; i < str.length; i += rows) out.push(str.slice(i, i + rows));
    return out;
  };

  /* 断句折列：一列排满时优先断在标点之后，不要把一个「，」拆到下一列 */
  const BREAK_AFTER = '，。！？；：、）」』';
  function chunkPoem(line, rows) {
    const out = [];
    let s = line;
    while (s.length > rows) {
      let cut = -1;
      for (let i = Math.min(rows, s.length) - 1; i >= Math.max(1, Math.floor(rows * 0.45)); i--) {
        if (BREAK_AFTER.indexOf(s[i]) >= 0) { cut = i + 1; break; }
      }
      if (cut < 0) cut = rows;
      out.push(s.slice(0, cut));
      s = s.slice(cut);
    }
    if (s.length) out.push(s);
    return out;
  }

  /* 把一首诗编成一串列：小序 → 诗题 → 正文 → 落款（钤印） */
  function columnsOfPoem(poem, pi, info, rows) {
    const list = [];
    const style = poem.signature || info.signature || 'season';

    if (poem.note) {
      chunk(String(poem.note).replace(/\s+/g, ''), rows).forEach((c) => {
        list.push({ chars: c.split(''), size: 0.60, isPreface: true, poemOf: pi });
      });
    }

    const title = (poem.title || '无题').trim();
    chunk(title, rows - 2).forEach((tc, ci) => {
      list.push({
        chars: ((ci === 0 ? '  ' : '') + tc).split(''),   // 首列低二格（古籍惯例）
        size: 1.06, head: true, isTitle: true, poemOf: pi,
        poemStart: ci === 0 ? pi : undefined,
      });
    });

    (poem.lines || []).forEach((line) => {
      const s = String(line).replace(/\s+$/, '');
      if (!s.trim()) return;
      chunkPoem(s, rows).forEach((c) => list.push({ chars: c.split(''), poemOf: pi }));
    });

    // 落款 + 钤印：能并进一列就并（日期与地点同列是古书常态），并不下才分列
    const sig = Lunar.signature(poem.date || info.defaultDate, style, poem.place);
    const texts = [sig.date, sig.place].filter(Boolean);
    texts.forEach((t, i) => {
      const isLast = i === texts.length - 1;
      list.push({
        chars: t.split(''), size: 0.74, sign: true, poemOf: pi,
        // 越靠后的落款列写得越下（像手书落款那样错落）
        startRow: Math.max(0, rows - t.length - (isLast ? 4 : 3)),
        seal: isLast,
      });
    });
    return list;
  }

  /* 每首诗独占若干页；页内尽力塞满，但不把诗题与正文拆开 */
  function paginatePoem(list, cols) {
    const pages = [];
    let cur = [];
    const prefCount = list.filter((c) => c.isPreface).length;
    // 序言长(>=4列)或全篇超过一页时，小序自成一面；短序与诗同面
    const splitPreface = prefCount >= 4 || list.length > cols;

    for (let i = 0; i < list.length; i++) {
      const col = list[i];
      if (cur.length >= cols) { pages.push(cur); cur = []; }
      // 小序（note）与诗本身分面：长小序自成一面，短小序同面
      if (splitPreface && !col.isPreface && cur.length && cur[cur.length - 1].isPreface) {
        pages.push(cur); cur = [];
      }
      // 落款整组（含钤印）不能拆：这一列放不下就整组挪到下一页
      if (col.sign && !cur.some((c) => c.sign)) {
        const need = list.slice(i).filter((c) => c.sign).length;
        if (cur.length + need > cols) { pages.push(cur); cur = []; }
      }
      cur.push(col);
    }
    if (cur.length) pages.push(cur);
    // 最后一页若只剩落款两三列（半面空），从上一页匀几列过来，免得出现空荡荡的一面
    if (pages.length > 1) {
      const last = pages[pages.length - 1];
      const signOnly = last.every((c) => c.sign);
      if (signOnly && last.length < 3) {
        const prev = pages[pages.length - 2];
        while (last.length < 3 && prev.length > 2) last.unshift(prev.pop());
      }
    }
    return pages;
  }

  /* 主入口：返回 { sheets:[{recto,verso}], toc, poemPages, totalSheets } */
  function build(info, poems, mm) {
    const rows = mm.rows, cols = mm.cols;

    /* ---- 正文：一诗一页（长诗续页） ---- */
    const bodyPages = [];
    const poemPages = [];        // 每首诗：[起始页, 结束页]
    let pageNo = 0;
    poems.forEach((poem, pi) => {
      const list = columnsOfPoem(poem, pi, info, rows);
      const pages = paginatePoem(list, cols);
      const first = pageNo + 1;
      pages.forEach((pageCols, idx) => {
        pageNo++;
        const l = Lunar.solarToLunar(poem.date || info.defaultDate);
        bodyPages.push({
          kind: 'body',
          columns: pageCols,
          pageLabel: cnNum(pageNo),
          runHead: (info.title || '') + (l ? '　' + l.ganzhi : ''),
          poemIndex: pi,
          poemLast: idx === pages.length - 1,
        });
      });
      poemPages.push([first, pageNo]);
    });

    /* ---- 目录：一列一条，题、干支、页码同列 ---- */
    const tocColumns = poems.map((poem, pi) => {
      const l = Lunar.solarToLunar(poem.date || info.defaultDate);
      return {
        chars: (poem.title || '无题').split(''),
        size: 0.88,
        note: cnNum(poemPages[pi][0]),
        year: l ? l.ganzhi : '',
      };
    });
    const tocChunks = [];
    if (poems.length > 1) {
      for (let i = 0; i < tocColumns.length; i += cols) tocChunks.push(tocColumns.slice(i, i + cols));
    }
    const tocPages = tocChunks.map((ch, i) => ({
      kind: 'toc', columns: ch, pageLabel: '', tocContinues: i > 0, first: i === 0,
    }));

    /* ---- 拼成「面」的序列，再两两成叶 ---- */
    const sides = [];
    sides.push({ kind: 'title' });                                  // 扉页
    if (tocPages.length) sides.push(...tocPages);                   // 目錄（多首诗时收录）
    sides.push(...bodyPages);                                       // 正文
    sides.push({
      kind: 'colophon',
      columns: (info.colophon || []).map((l) => ({ chars: l.split(''), size: 0.86 })),
      pageLabel: '', seal: { x: 0.2, y: 0.72 },
    });
    sides.push({ kind: 'blank', pageLabel: '' });                   // 空白护叶
    while (sides.length % 2) sides.push({ kind: 'blank', pageLabel: '' });

    const sheets = [];
    for (let i = 0; i < sides.length; i += 2) {
      // 直接在原对象上打 sideKey：保持引用一致，app 才能用「面」反查「叶」
      const r = sides[i], v = sides[i + 1];
      r.sideKey = 'r';
      v.sideKey = 'v';
      sheets.push({ recto: r, verso: v });
    }

    return {
      sheets, toc: tocColumns, poemPages, bodyPages, bodyCount: bodyPages.length,
      totalSheets: sheets.length, totalSides: sides.length,
    };
  }

  return { build, cnNum, columnsOfPoem };
})();
