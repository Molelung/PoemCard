/* ==========================================================================
 *  cards.js —— 诗笺卡片：把一首诗渲染成一张（或一长卷）图
 *  与书页用同一套 renderPage，所以「页面上看到的」就是「导出得到的」
 *  本文件不需要 three.js
 * ========================================================================== */
window.PoemCards = (function () {
  'use strict';

  const state = { paper: [], seal: null, plan: null, ready: false };

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('图片加载失败：' + src));
      img.src = src;
    });
  }

  async function loadBundledFont() {
    if (typeof BOOK_STYLE !== 'undefined' && BOOK_STYLE.useBundledFont === false) return false;
    try {
      const face = new FontFace('Zhongchun Fangsong', "url('fonts/ZhongchunFangsong-S2T.ttf')");
      await Promise.race([
        face.load(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 20000)),
      ]);
      document.fonts.add(face);
      return true;
    } catch (e) {
      console.warn('自带「仲春仿宋」未加载，退回系统楷体：' + e.message);
      return false;
    }
  }

  /** 准备纸纹、印章、排版（一次性） */
  async function init(onStep) {
    if (state.ready) return state;
    const step = (t) => onStep && onStep(t);
    step('研墨…');
    await loadBundledFont();
    try {
      const sealSrc = (typeof window !== 'undefined' && window.SEAL_DATA_URL) || (BOOK_INFO && BOOK_INFO.sealImg) || 'assets/seal.png';
      state.seal = await loadImage(sealSrc);
    } catch (e) { console.warn(e.message + '（改用内置方印）'); }
    step('裁纸…');
    const PW = Math.round(LAYOUT.w * LAYOUT.ppm), PH = Math.round(LAYOUT.h * LAYOUT.ppm);
    state.paper = [Tex.paperBase(PW, PH, 12345), Tex.paperBase(PW, PH, 54321)];
    step('排字…');
    state.plan = Typeset.build(BOOK_INFO, POEMS, LAYOUT);
    state.ready = true;
    return state;
  }

  /** 某首诗占的页面（可能多面 → 长诗） */
  function pagesOfPoem(poemIndex) {
    return state.plan.bodyPages.filter((p) => p.poemIndex === poemIndex);
  }

  /** 只渲染某一面 */
  function renderPage(poemIndex, pageIdx, ppmScale) {
    const pages = pagesOfPoem(poemIndex);
    const p = pages[Math.min(pageIdx || 0, pages.length - 1)];
    if (!p) return null;
    const mm = Object.assign({}, LAYOUT, { ppm: LAYOUT.ppm * (ppmScale || 1) });
    return Tex.renderPage(state.paper[0], state.paper[1], p, mm, { sealImg: state.seal });
  }

  /** 渲染一首诗为一张图；长诗自动纵向拼成长卷 */
  function renderPoem(poemIndex, opts) {
    opts = opts || {};
    const ppmScale = opts.ppmScale || 1;
    const pages = pagesOfPoem(poemIndex);
    if (!pages.length) return null;
    if (opts.cardCover) {
      const titleIdx = pages.findIndex((p) => (p.columns || []).some((c) => c.isTitle));
      return renderPage(poemIndex, titleIdx >= 0 ? titleIdx : 0, ppmScale);
    }
    if (opts.firstOnly) return renderPage(poemIndex, 0, ppmScale);
    const mm = Object.assign({}, LAYOUT, { ppm: LAYOUT.ppm * ppmScale });
    const canvases = pages.map((p) => Tex.renderPage(state.paper[0], state.paper[1], p, mm, { sealImg: state.seal }));
    if (canvases.length === 1) return canvases[0];
    // 多面拼成一长卷
    const gap = Math.round(2 * mm.ppm);          // 2mm 接缝
    const w = canvases[0].width;
    const h = canvases.reduce((s, c) => s + c.height, 0) + gap * (canvases.length - 1);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const x = out.getContext('2d');
    x.fillStyle = '#efe6d2';
    x.fillRect(0, 0, w, h);
    let y = 0;
    canvases.forEach((c, i) => {
      x.drawImage(c, 0, y);
      y += c.height;
      if (i < canvases.length - 1) {
        x.fillStyle = 'rgba(120,92,52,0.18)';
        x.fillRect(0, y, w, gap);
        y += gap;
      }
    });
    return out;
  }

  /** 把 canvas 存成 PNG（toBlob 在超大图或软件渲染下可能很慢，故加超时回退） */
  function toPngBlob(canvas, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (blob) => { if (!done) { done = true; resolve(blob); } };
      try {
        canvas.toBlob((b) => finish(b), 'image/png');
      } catch (e) { /* 某些环境直接抛错，走回退 */ }
      setTimeout(() => {
        if (done) return;
        try { finish(dataURLtoBlob(canvas.toDataURL('image/png'))); }
        catch (e) { finish(null); }
      }, timeoutMs || 12000);
    });
  }
  function dataURLtoBlob(url) {
    const i = url.indexOf(',');
    const head = url.slice(0, i), body = url.slice(i + 1);
    const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
    return new Blob([arr], { type: mime });
  }

  function download(canvas, filename) {
    return toPngBlob(canvas).then((blob) => {
      if (!blob) throw new Error('导出失败：无法编码为 PNG');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 6000);
      return true;
    });
  }

  /** 一首诗的全部信息（用于展示） */
  function infoOf(poem) {
    const l = Lunar.solarToLunar(poem.date || BOOK_INFO.defaultDate);
    return {
      title: poem.title || '无题',
      lines: poem.lines || [],
      note: poem.note || '',
      place: poem.place || '',
      date: poem.date || '',
      lunar: l,
      ganzhi: l ? l.ganzhi : '',
      lunarText: l ? l.monthName + l.dayName : '',
      season: l ? l.monthAlias : '',
      term: l ? l.term : '',
      animal: l ? l.animal : '',
      sign: (() => { if (!l) return ''; const sg = Lunar.signature(poem.date || BOOK_INFO.defaultDate, poem.signature || BOOK_INFO.signature, poem.place); return [sg.date, sg.place].filter(Boolean).join('　'); })(),
      pages: pagesOfPoem(POEMS.indexOf(poem)).length || 1,
    };
  }

  /** 逐面导出（多面诗按面各存一张，避免拼成长扁条看不清） */
  async function downloadPages(poemIndex, ppmScale, baseName) {
    const n = pagesOfPoem(poemIndex).length;
    if (n <= 1) return download(renderPoem(poemIndex, { ppmScale }), baseName + '.png');
    for (let k = 0; k < n; k++) {
      const cv = renderPage(poemIndex, k, ppmScale);
      await download(cv, `${baseName}_${k + 1}of${n}.png`);
      await new Promise((r) => setTimeout(r, 350));
    }
    return true;
  }

  return { init, renderPoem, renderPage, pagesOfPoem, download, downloadPages, infoOf, state };
})();
