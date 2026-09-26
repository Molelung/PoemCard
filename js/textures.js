/* ==========================================================================
 *  textures.js —— 全部材质都是程序化生成的，不依赖任何外部图片
 *  宣纸纤维 / 帘纹 / 霉斑 / 朱丝栏 / 绢面暗纹 / 洒金 / 书口毛边 / 环境光
 * ========================================================================== */
window.Tex = (function () {
  'use strict';

  /* ---------- 随机数：固定种子，保证每次打开纹理一致 ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rr = (r, a, b) => a + r() * (b - a);
  const ri = (r, a, b) => Math.floor(rr(r, a, b + 1));

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    return { c, x };
  }

  let maxAniso = 4;
  const setAnisotropy = (v) => { maxAniso = v; };

  function tex(canvas, opt) {
    opt = opt || {};
    const t = new THREE.CanvasTexture(canvas);
    t.anisotropy = maxAniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    if (opt.srgb !== false) t.encoding = THREE.sRGBEncoding;
    if (opt.repeat) t.repeat.set(opt.repeat[0], opt.repeat[1]);
    if (opt.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  /* ---------- 调色 ---------- */
  const TONE = () => (window.BOOK_STYLE ? BOOK_STYLE.paperTone : 1);
  const AGING = () => (window.BOOK_STYLE ? BOOK_STYLE.aging : 0.6);

  function paperFill(x, w, h, warm) {
    const t = TONE();
    const base = [234, 222, 196];
    const deep = [228, 214, 184];
    const k = 1 + (1 - t) * 0.35;
    // 底色几乎不渐变，纸的不均匀交给云斑与纤维表现，避免出现横向色带
    const g = x.createLinearGradient(0, 0, w, h * 0.9);
    g.addColorStop(0, `rgb(${base.map((v) => Math.min(255, v * k * 1.004) | 0).join(',')})`);
    g.addColorStop(0.55, `rgb(${base.map((v) => Math.min(255, v * k) | 0).join(',')})`);
    g.addColorStop(1, `rgb(${deep.map((v) => Math.min(255, v * k) | 0).join(',')})`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    if (warm) { x.fillStyle = `rgba(206,175,120,${warm})`; x.fillRect(0, 0, w, h); }
  }

  /* ---------- 宣纸底：帘纹 + 云斑 + 纤维 + 霉斑 + 细小杂质 ---------- */
  function paperBase(w, h, seed) {
    const { c, x } = mkCanvas(w, h);
    const r = rng(seed);
    paperFill(x, w, h, 0.02);

    // 大块云斑（不均匀的纸浆厚度）
    for (let i = 0; i < 135; i++) {
      const px = r() * w, py = r() * h, rad = rr(r, w * 0.05, w * 0.42);
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      const dark = r() > 0.5;
      g.addColorStop(0, dark ? `rgba(190,168,126,${rr(r, 0.030, 0.088)})` : `rgba(255,252,244,${rr(r, 0.030, 0.095)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }

    // 帘纹：宣纸抄纸帘留下的细密竖纹（1~2mm 一道）
    const step = w / 190 * 1.7;                 // 约 1.7mm 一道
    for (let px = 0; px < w; px += step) {
      x.fillStyle = `rgba(160,138,100,${rr(r, 0.020, 0.045)})`;
      x.fillRect(px, 0, 1, h);
    }
    for (let px = 0; px < w; px += step * 8) {  // 略粗的帘条痕
      x.fillStyle = `rgba(168,146,106,${rr(r, 0.03, 0.06)})`;
      x.fillRect(px, 0, 1.6, h);
    }

    // 纤维：一根根的麻/檀皮纤维
    const fibers = Math.round((w * h) / 900);
    for (let i = 0; i < fibers; i++) {
      const px = r() * w, py = r() * h;
      const len = rr(r, 3, 20), ang = r() * Math.PI * 2;
      const light = r() > 0.42;
      x.strokeStyle = light ? `rgba(255,253,246,${rr(r, 0.05, 0.16)})` : `rgba(176,156,118,${rr(r, 0.04, 0.13)})`;
      x.lineWidth = rr(r, 0.5, 1.35);
      x.beginPath();
      x.moveTo(px, py);
      x.quadraticCurveTo(px + Math.cos(ang) * len * 0.5 + rr(r, -2, 2), py + Math.sin(ang) * len * 0.5 + rr(r, -2, 2), px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      x.stroke();
    }

    // 霉斑 / 水渍：边缘集聚
    const fox = Math.round(26 * (0.35 + AGING()));
    for (let i = 0; i < fox; i++) {
      const edge = r() < 0.62;
      const px = edge ? (r() < 0.5 ? rr(r, -w * 0.05, w * 0.3) : rr(r, w * 0.7, w * 1.05)) : r() * w;
      const py = edge ? (r() < 0.5 ? rr(r, -h * 0.05, h * 0.25) : rr(r, h * 0.75, h * 1.05)) : r() * h;
      const rad = rr(r, w * 0.02, w * 0.13);
      const g = x.createRadialGradient(px, py, rad * 0.15, px, py, rad);
      const a = rr(r, 0.05, 0.135) * (0.5 + AGING());
      g.addColorStop(0, `rgba(184,146,84,${a})`);
      g.addColorStop(0.62, `rgba(196,163,104,${a * 0.55})`);
      g.addColorStop(1, 'rgba(200,170,120,0)');
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }

    // 水渍圈（旧纸最典型的一种痕迹）
    const rings = Math.round(7 * (0.4 + AGING()));
    for (let i = 0; i < rings; i++) {
      const px = rr(r, -w * 0.1, w * 1.1), py = rr(r, -h * 0.1, h * 1.1);
      const rad = rr(r, w * 0.06, w * 0.26);
      x.strokeStyle = `rgba(176,142,88,${rr(r, 0.04, 0.12)})`;
      x.lineWidth = rr(r, 1.2, 5.5);
      x.beginPath(); x.arc(px, py, rad, 0, 6.2832); x.stroke();
      x.strokeStyle = `rgba(198,172,124,${rr(r, 0.02, 0.05)})`;
      x.lineWidth = rr(r, 3, 10);
      x.beginPath(); x.arc(px, py, rad * rr(r, 0.85, 1.05), 0, 6.2832); x.stroke();
    }

    // 细小杂质黑点
    const dots = Math.round((w * h) / 2600);
    for (let i = 0; i < dots; i++) {
      x.fillStyle = `rgba(114,96,68,${rr(r, 0.06, 0.30)})`;
      x.beginPath();
      x.arc(r() * w, r() * h, rr(r, 0.35, 1.25), 0, 6.2832);
      x.fill();
    }

    // 四周泛黄（老纸边角最黄）
    const eg = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
    eg.addColorStop(0, 'rgba(180,152,104,0)');
    eg.addColorStop(1, `rgba(176,144,92,${0.24 * (0.5 + AGING())})`);
    x.fillStyle = eg; x.fillRect(0, 0, w, h);

    return c;
  }

  /* ---------- 由灰度图生成法线贴图（让纤维在光下有起伏，高性能优化） ---------- */
  function normalFromCanvas(src, strength) {
    const maxDim = 384;
    let w = src.width, h = src.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.max(64, Math.round(w * scale));
      h = Math.max(64, Math.round(h * scale));
    }
    const { c, x } = mkCanvas(w, h);
    x.drawImage(src, 0, 0, w, h);
    const s = x.getImageData(0, 0, w, h).data;
    const out = x.createImageData(w, h);
    const outData = out.data;
    const k = strength * 0.024;

    for (let y = 0; y < h; y++) {
      const ym = y > 0 ? y - 1 : h - 1;
      const yp = y < h - 1 ? y + 1 : 0;
      const yrow = y * w * 4;
      const ym_row = ym * w * 4;
      const yp_row = yp * w * 4;
      for (let px = 0; px < w; px++) {
        const xm = px > 0 ? px - 1 : w - 1;
        const xp = px < w - 1 ? px + 1 : 0;
        const l = s[yrow + xm * 4], rgt = s[yrow + xp * 4];
        const u = s[ym_row + px * 4], d = s[yp_row + px * 4];
        let nx = (l - rgt) * k, ny = (d - u) * k, nz = 1;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const idx = yrow + px * 4;
        outData[idx] = (nx * inv * 0.5 + 0.5) * 255;
        outData[idx + 1] = (ny * inv * 0.5 + 0.5) * 255;
        outData[idx + 2] = (nz * inv * 0.5 + 0.5) * 255;
        outData[idx + 3] = 255;
      }
    }
    x.putImageData(out, 0, 0);
    return c;
  }

  /* ---------- 印章（阴文方印，带残边） ---------- */
  function drawSeal(x, cx, cy, size, text, opt) {
    opt = opt || {};
    const rot = opt.rot !== undefined ? opt.rot : 0.03;
    const S = Math.ceil(size * 1.25);
    const { c, x: sx } = mkCanvas(S, S);
    const red = opt.red || '#a8332b';
    const pad = (S - size) / 2;

    // 印底
    sx.save();
    sx.globalAlpha = opt.alpha !== undefined ? opt.alpha : 0.88;
    sx.fillStyle = red;
    const rd = size * 0.06;
    sx.beginPath();
    sx.moveTo(pad + rd, pad);
    sx.arcTo(pad + size, pad, pad + size, pad + size, rd);
    sx.arcTo(pad + size, pad + size, pad, pad + size, rd);
    sx.arcTo(pad, pad + size, pad, pad, rd);
    sx.arcTo(pad, pad, pad + size, pad, rd);
    sx.closePath();
    sx.fill();

    // 阴文（挖出字）
    sx.globalCompositeOperation = 'destination-out';
    const chars = String(text).split('');
    const n = chars.length;
    const cols = n <= 2 ? 1 : 2;
    const rows = n <= 2 ? n : Math.ceil(n / 2);
    const cw = size / cols, chs = size / rows;
    const fs = Math.min(cw, chs) * (opt.fontScale || 0.78);
    sx.font = `${fs}px ${BOOK_STYLE.fonts.head}`;
    sx.textAlign = 'center';
    sx.textBaseline = 'middle';
    // 古印自右向左、自上而下读
    for (let i = 0; i < n; i++) {
      const col = Math.floor(i / rows), row = i % rows;
      const px = pad + size - cw * (col + 0.5);
      const py = pad + chs * (row + 0.5);
      sx.fillText(chars[i], px, py);
    }
    // 残破边角
    sx.globalAlpha = 1;
    const nr = rng(20260925);
    for (let i = 0; i < 46; i++) {
      const t = nr() * 4;
      let px, py;
      if (t < 1) { px = pad + nr() * size; py = pad + rr(nr, -1, 3); }
      else if (t < 2) { px = pad + nr() * size; py = pad + size + rr(nr, -3, 1); }
      else if (t < 3) { px = pad + rr(nr, -1, 3); py = pad + nr() * size; }
      else { px = pad + size + rr(nr, -3, 1); py = pad + nr() * size; }
      sx.beginPath();
      sx.arc(px, py, rr(nr, 0.5, size * 0.035), 0, 6.2832);
      sx.fill();
    }
    sx.restore();

    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.drawImage(c, -S / 2, -S / 2);
    x.restore();
  }

  /* ---------- 单页画面：版框 + 界行 + 竖排文字 ----------
   *  mm 坐标系：左上角为 (0,0)，与纸页 190×285 对应
   *  u=0 一侧（左）永远是书脊侧，正反面同一套画法
   * -------------------------------------------------------- */
  const PUNCT = '，。、；：？！（）《》「」【】';
  const PUNCT_TRIM = '「」《》【】（）：；';

  function renderPage(paper0, paper1, page, mm, opt) {
    opt = opt || {};
    const sealImg = opt.sealImg || null;
    const PPM = mm.ppm;
    const W = mm.w * PPM, H = mm.h * PPM;
    const { c, x } = mkCanvas(W, H);
    const r = rng(1000 + (page.num || 0) * 37 + (page.sideKey ? page.sideKey.length * 91 : 0));
    const isV = page.sideKey === 'v';        // 反面：材质做了镜像，故留白与书口方向要对调

    x.drawImage(r() > 0.5 ? paper0 : paper1, 0, 0, W, H);

    const font = BOOK_STYLE.fonts.body;
    const ruleCol = BOOK_STYLE.redRules ? 'rgba(150,68,52,' : 'rgba(60,52,40,';

    /* 钤印：有真印章图就用图，否则退回画一个方印 */
    function stamp(cx, cy, h, rot) {
      if (sealImg && sealImg.naturalWidth) {
        const w = h * (sealImg.naturalWidth / sealImg.naturalHeight);
        x.save();
        x.translate(cx, cy);
        x.rotate(rot || 0);
        x.globalAlpha = 0.94;
        x.drawImage(sealImg, -w / 2, -h / 2, w, h);
        x.restore();
      } else {
        drawSeal(x, cx, cy, h * 0.62, (window.BOOK_INFO && BOOK_INFO.sealText) || '印', { rot: rot });
      }
    }

    // ---- 版框范围（mm）。书脊一侧留白更大 ----
    const fL = isV ? mm.frameR : mm.frameL;
    const fR = isV ? mm.frameL : mm.frameR;
    const boxL = fL, boxT = mm.frameT;
    const boxR = mm.w - fR, boxB = mm.h - mm.frameB;
    const boxW = boxR - boxL, boxH = boxB - boxT;
    const cols = mm.cols, rows = mm.rows;
    const colW = boxW / cols, rowH = boxH / rows;
    // 竖排右起：第一列在书口一侧。反面因镜像，画布坐标同样是"右起"
    const colCenter = (i) => (boxL + colW * (cols - 1 - i) + colW / 2) * PPM;

    // ---- 版框双线 ----
    if (page.kind !== 'blank') {
      x.strokeStyle = ruleCol + '0.55)';
      x.lineWidth = Math.max(1, 0.7 * PPM);
      x.strokeRect(boxL * PPM, boxT * PPM, boxW * PPM, boxH * PPM);
      x.strokeStyle = ruleCol + '0.34)';
      x.lineWidth = Math.max(1, 0.32 * PPM);
      const g = 2.4;
      x.strokeRect((boxL + g) * PPM, (boxT + g) * PPM, (boxW - g * 2) * PPM, (boxH - g * 2) * PPM);
      // 界行（列间细线）
      x.strokeStyle = ruleCol + '0.26)';
      x.lineWidth = Math.max(1, 0.26 * PPM);
      for (let i = 1; i < cols; i++) {
        const px = (boxL + colW * i) * PPM;
        if (page.kind === 'toc') continue;
        x.beginPath(); x.moveTo(px, (boxT + g) * PPM); x.lineTo(px, (boxB - g) * PPM); x.stroke();
      }
      if (page.kind === 'toc') {
        for (let i = 1; i < cols; i++) {
          const px = (boxL + colW * i) * PPM;
          x.beginPath(); x.moveTo(px, (boxT + g) * PPM); x.lineTo(px, (boxB - g) * PPM); x.stroke();
        }
      }
    }

    // ---- 竖排文字 ----
    const inkBase = 34, inkK = 0.86;
    function drawColumn(col, colIndex) {
      const actualCol = col.colIndex !== undefined ? col.colIndex : colIndex;
      const size = col.size || 1;
      const fsPx = rowH * PPM * 0.80 * size;
      x.font = `${fsPx}px ${col.head ? BOOK_STYLE.fonts.head : font}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      const colX = colCenter(actualCol);
      const chars = col.chars;
      const row0 = col.startRow || 0;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === ' ') continue;
        const py = (boxT + rowH * (row0 + i + 0.5)) * PPM;
        const isP = PUNCT.indexOf(ch) >= 0;
        const ink = inkBase + rr(r, -6, 12);
        const alpha = inkK + rr(r, -0.09, 0.12);
        x.save();
        let px = colX, pyy = py, scale = 1;
        if (isP) {
          // 竖排标点：缩在字格右上（、。等）；括号类占满格
          const trim = PUNCT_TRIM.indexOf(ch) >= 0;
          px = colX + (trim ? 0 : colW * PPM * 0.24);
          pyy = py - (trim ? 0 : rowH * PPM * 0.24);
          if (!trim) scale = 0.86;
        }
        x.translate(px, pyy);
        x.scale(scale, scale);
        x.fillStyle = `rgba(${ink},${ink - 6},${ink - 16},${alpha})`;
        x.fillText(ch, 0.4, 0.4);            // 极轻的墨晕
        x.fillText(ch, 0, 0);
        x.restore();
      }
      // 目录条目：题后空一格写干支，再空一格写页码
      if (col.year) {
        const yfs = fsPx * 0.50;
        x.font = `${yfs}px ${font}`;
        x.fillStyle = 'rgba(112,74,56,0.82)';
        x.fillText(col.year, colX, (boxT + rowH * (chars.length + 1.25)) * PPM);
      }
      if (col.note) {
        const nfs = fsPx * 0.46;
        x.font = `${nfs}px ${font}`;
        x.fillStyle = 'rgba(72,58,42,0.78)';
        x.fillText(col.note, colX, (boxT + rowH * (chars.length + (col.year ? 3.4 : 1.2))) * PPM);
      }
      // 落款钤印（写在落款末尾下方，严格限制在地脚线内）
      if (col.seal) {
        const sealH = rowH * PPM * 1.85;
        const sealY = Math.min((boxB - rowH * 1.15) * PPM, (boxT + rowH * (row0 + chars.length + 1.25)) * PPM);
        stamp(colX, sealY, sealH, rr(r, -0.035, 0.035));
      }
    }
    if (page.columns) page.columns.forEach(drawColumn);

    // ---- 扉页（书名页）：书名居中偏右，卷次、著者依次在左，左下钤印 ----
    if (page.kind === 'title') {
      const t = BOOK_INFO.title || '';
      const fs = boxH * PPM * 0.125;
      const step = fs * 1.16;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      const cxT = (boxL + boxW * 0.60) * PPM;
      const topY = boxT * PPM + (boxH * PPM - (t.length - 1) * step) / 2;
      x.font = `${fs}px ${BOOK_STYLE.fonts.head}`;
      for (let i = 0; i < t.length; i++) {
        const ink = 30 + rr(r, -5, 10);
        x.fillStyle = `rgba(${ink},${ink},${ink + 2},0.92)`;
        x.fillText(t[i], cxT + 0.4, topY + i * step + 0.4);
        x.fillText(t[i], cxT, topY + i * step);
      }
      // 卷次
      const fs2 = fs * 0.34;
      const st = BOOK_INFO.subTitle || '';
      x.font = `${fs2}px ${font}`;
      x.fillStyle = 'rgba(58,50,40,0.80)';
      const cx2 = (boxL + boxW * 0.42) * PPM;
      for (let i = 0; i < st.length; i++) x.fillText(st[i], cx2, topY + i * fs2 * 1.45 + fs * 0.1);
      // 著者
      const fs3 = fs * 0.30;
      x.font = `${fs3}px ${font}`;
      x.fillStyle = 'rgba(58,50,40,0.78)';
      const au = BOOK_INFO.author || '';
      const ax = (boxL + boxW * 0.30) * PPM;
      const ay0 = topY + fs * 2.2;
      for (let i = 0; i < au.length; i++) x.fillText(au[i], ax, ay0 + i * fs3 * 1.5);
      // 钤印（真印章图）
      stamp((boxL + boxW * 0.15) * PPM, (boxT + boxH * 0.50) * PPM, fs * 2.1, 0.02);
    }

    // ---- 目录页眉 ----
    if (page.kind === 'toc') {
      const fs = rowH * PPM * 0.72;
      x.font = `${fs}px ${BOOK_STYLE.fonts.head}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = 'rgba(40,34,26,0.85)';
      const s = '目  錄';
      x.fillText(s, (boxL + boxW * 0.5) * PPM, (boxT - rowH * 0.95) * PPM);
      x.strokeStyle = ruleCol + '0.45)';
      x.lineWidth = Math.max(1, 0.4 * PPM);
      x.beginPath();
      x.moveTo((boxL + boxW * 0.16) * PPM, (boxT - rowH * 0.45) * PPM);
      x.lineTo((boxL + boxW * 0.84) * PPM, (boxT - rowH * 0.45) * PPM);
      x.stroke();
    }

    // ---- 正文页眉（书名小字，在地脚上方的鱼尾位置）----
    if (page.kind === 'body' && page.runHead) {
      const fs = rowH * PPM * 0.34;
      x.font = `${fs}px ${BOOK_STYLE.fonts.head}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = 'rgba(66,56,42,0.55)';
      x.fillText(page.runHead, (boxL + boxW * 0.5) * PPM, (boxT - rowH * 0.72) * PPM);
    }

    // ---- 页末钤印（卷末等）----
    if (page.seal) {
      const h = rowH * PPM * (page.seal.h || 2.6);
      stamp((boxL + boxW * (page.seal.x || 0.2)) * PPM, (boxT + boxH * (page.seal.y || 0.75)) * PPM, h, page.seal.rot || 0.03);
    }

    // ---- 地脚 / 边款页码 ----
    if (page.pageLabel) {
      const fs = rowH * PPM * 0.36;
      x.font = `${fs}px ${font}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = 'rgba(70,58,44,0.72)';
      x.fillText(page.pageLabel, (boxL + boxW * 0.5) * PPM, (boxB + rowH * 0.62) * PPM);
    }

    // ---- 书脊侧阴影（书口暗）----
    const gw = fL * PPM * 1.5;
    const gg = isV ? x.createLinearGradient(W, 0, W - gw, 0) : x.createLinearGradient(0, 0, gw, 0);
    gg.addColorStop(0, 'rgba(92,72,48,0.30)');
    gg.addColorStop(0.35, 'rgba(92,72,48,0.10)');
    gg.addColorStop(1, 'rgba(92,72,48,0)');
    x.fillStyle = gg; x.fillRect(isV ? W - gw : 0, 0, gw, H);

    // ---- 纸页边缘泛黄/磨损（宽而柔，避免出现生硬色带） ----
    const e = Math.max(6, 5.2 * PPM);
    const edgeFade = (x0, y0, x1, y1, rx, ry) => {
      const g2 = x.createLinearGradient(x0, y0, x1, y1);
      g2.addColorStop(0, 'rgba(152,122,74,0.19)');
      g2.addColorStop(0.45, 'rgba(152,122,74,0.07)');
      g2.addColorStop(1, 'rgba(152,122,74,0)');
      x.fillStyle = g2; x.fillRect(rx, ry, Math.abs(x1 - x0) || W, Math.abs(y1 - y0) || H);
    };
    edgeFade(0, 0, e, 0, 0, 0);
    edgeFade(W, 0, W - e, 0, W - e, 0);
    edgeFade(0, 0, 0, e, 0, 0);
    edgeFade(0, H, 0, H - e, 0, H - e);

    return c;
  }

  /* ---------- 绢面（封面布面） ---------- */
  function silk(w, h, seed, opt) {
    opt = opt || {};
    const { c, x } = mkCanvas(w, h);
    const r = rng(seed);
    const base = opt.base || [24, 34, 47];      // 藏青
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `rgb(${base[0] + 8},${base[1] + 8},${base[2] + 10})`);
    g.addColorStop(1, `rgb(${Math.max(0, base[0] - 10)},${Math.max(0, base[1] - 8)},${Math.max(0, base[2] - 6)})`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);

    // 平纹织物：横竖经纬
    const pitch = Math.max(2, w / 460);
    for (let i = 0; i < w; i += pitch) {
      x.fillStyle = `rgba(255,255,255,${0.020 + r() * 0.022})`; x.fillRect(i, 0, pitch * 0.5, h);
      x.fillStyle = `rgba(0,0,0,${0.045 + r() * 0.03})`; x.fillRect(i + pitch * 0.5, 0, pitch * 0.5, h);
    }
    for (let j = 0; j < h; j += pitch) {
      x.fillStyle = `rgba(255,255,255,${0.016 + r() * 0.02})`; x.fillRect(0, j, w, pitch * 0.5);
      x.fillStyle = `rgba(0,0,0,${0.035 + r() * 0.03})`; x.fillRect(0, j + pitch * 0.5, w, pitch * 0.5);
    }
    // 织物斑驳 / 使用痕迹
    for (let i = 0; i < 120; i++) {
      const px = r() * w, py = r() * h, rad = rr(r, w * 0.04, w * 0.3);
      const gg = x.createRadialGradient(px, py, 0, px, py, rad);
      const l = r() > 0.45;
      gg.addColorStop(0, l ? `rgba(255,246,225,${rr(r, 0.012, 0.05)})` : `rgba(0,0,0,${rr(r, 0.02, 0.06)})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gg; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    // 磨白（四角、书脊处最容易磨）
    if (opt.wear !== false) {
      const corners = [[0, 0], [w, 0], [0, h], [w, h]];
      corners.forEach(([px, py]) => {
        const rad = w * 0.16;
        const gg = x.createRadialGradient(px, py, 0, px, py, rad);
        gg.addColorStop(0, `rgba(214,200,172,${rr(r, 0.10, 0.20)})`);
        gg.addColorStop(1, 'rgba(214,200,172,0)');
        x.fillStyle = gg; x.fillRect(Math.min(px, px - rad), Math.min(py, py - rad), rad * 2, rad * 2);
      });
      for (let i = 0; i < 26; i++) {   // 划痕
        const px = r() * w, py = r() * h;
        x.strokeStyle = `rgba(220,208,180,${rr(r, 0.03, 0.10)})`;
        x.lineWidth = rr(r, 0.5, 1.6);
        x.beginPath(); x.moveTo(px, py);
        x.lineTo(px + rr(r, -w * 0.1, w * 0.1), py + rr(r, -h * 0.06, h * 0.06));
        x.stroke();
      }
    }
    return c;
  }

  /* ---------- 封面（含题签） ---------- */
  function coverArt(w, h, seed, mm, opt) {
    opt = opt || {};
    const { c, x } = mkCanvas(w, h);
    const PPM = mm.ppm;
    x.drawImage(silk(w, h, seed, { base: opt.base || [40, 54, 68] }), 0, 0);

    // 双线压印框
    const m = 9 * PPM;
    x.strokeStyle = 'rgba(196,172,120,0.24)';
    x.lineWidth = Math.max(1, 0.9 * PPM);
    x.strokeRect(m, m, w - m * 2, h - m * 2);
    x.strokeStyle = 'rgba(196,172,120,0.16)';
    x.lineWidth = Math.max(1, 0.34 * PPM);
    x.strokeRect(m + 2.6 * PPM, m + 2.6 * PPM, w - (m + 2.6 * PPM) * 2, h - (m + 2.6 * PPM) * 2);

    // 题签：竖长条宣纸贴在左上（离书口一侧），带阴影
    const slipW = (mm.slipW || 46) * PPM, slipH = (mm.slipH || 190) * PPM;
    const slipX = (mm.slipX || 26) * PPM, slipY = (mm.slipY || 30) * PPM;
    const { c: sc, x: sx } = mkCanvas(Math.ceil(slipW), Math.ceil(slipH));
    paperFill(sx, slipW, slipH, 0.03);
    const r2 = rng(seed + 77);
    for (let i = 0; i < 40; i++) {          // 题签自己的斑
      const px = r2() * slipW, py = r2() * slipH, rad = rr(r2, slipW * 0.06, slipW * 0.5);
      const gg = sx.createRadialGradient(px, py, 0, px, py, rad);
      gg.addColorStop(0, `rgba(190,160,110,${rr(r2, 0.02, 0.07)})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      sx.fillStyle = gg; sx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    const ig = sx.createLinearGradient(0, 0, slipW, slipH);
    ig.addColorStop(0, 'rgba(150,120,72,0.16)'); ig.addColorStop(0.5, 'rgba(150,120,72,0.03)'); ig.addColorStop(1, 'rgba(150,120,72,0.14)');
    sx.fillStyle = ig; sx.fillRect(0, 0, slipW, slipH);
    // 题签红框
    sx.strokeStyle = 'rgba(140,60,48,0.42)';
    sx.lineWidth = Math.max(1, 0.5 * PPM);
    sx.strokeRect(1.4 * PPM, 1.4 * PPM, slipW - 2.8 * PPM, slipH - 2.8 * PPM);
    // 题签字（竖排，从上往下）
    const txt = opt.slipText || BOOK_INFO.titleSlip;
    const charStep = slipH * 0.78 / Math.max(1, txt.length);
    const fs = Math.min(charStep * 0.82, slipW * 0.62);
    sx.font = `${fs}px ${BOOK_STYLE.fonts.head}`;
    sx.textAlign = 'center'; sx.textBaseline = 'middle';
    sx.fillStyle = 'rgba(32,28,22,0.90)';
    const cx0 = slipW / 2, y0 = slipH * 0.11 + charStep / 2;
    for (let i = 0; i < txt.length; i++) sx.fillText(txt[i], cx0, y0 + i * charStep);

    // 贴上去（投影）
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.55)';
    x.shadowBlur = 3.2 * PPM;
    x.shadowOffsetX = 0.9 * PPM;
    x.shadowOffsetY = 1.1 * PPM;
    x.drawImage(sc, slipX, slipY);
    x.restore();

    // 四眼装订：书脊侧四个线孔与过线（贴面看得到的那几针）
    (function stitches() {
      const x0 = 7.5 * PPM;              // 距书脊侧边缘
      const holeY = mm.h * 0.5;          // 中间位置起算
      const gap = mm.h * 0.235;
      const cys = [holeY - gap * 1.5, holeY - gap * 0.5, holeY + gap * 0.5, holeY + gap * 1.5];
      x.save();
      x.strokeStyle = 'rgba(226,214,186,0.85)';
      x.lineCap = 'round';
      const hx = x0 * 0.86;                 // 线孔横坐标
      const ex = 2.2 * PPM;                 // 过线沿书脊边走的那一道
      // 过线：沿书脊边竖走，在每个线孔处斜插进去（线装的实际走线）
      x.save();
      x.strokeStyle = 'rgba(228,215,184,0.92)';
      x.lineWidth = Math.max(1.4, 0.95 * PPM);
      x.lineCap = 'round';
      x.shadowColor = 'rgba(0,0,0,0.45)';
      x.shadowBlur = 1.6 * PPM;
      x.shadowOffsetX = 0.5 * PPM;
      for (let i = 0; i < cys.length - 1; i++) {
        x.beginPath();
        x.moveTo(ex, cys[i]);
        x.lineTo(ex, cys[i + 1]);
        x.stroke();
      }
      cys.forEach((cy) => {                  // 孔到边线的斜针
        x.beginPath();
        x.moveTo(ex, cy);
        x.lineTo(hx, cy);
        x.stroke();
      });
      x.restore();
      // 孔
      cys.forEach((cy) => {
        x.fillStyle = 'rgba(16,12,9,0.6)';
        x.beginPath(); x.arc(hx, cy, 1.0 * PPM, 0, 6.2832); x.fill();
        x.fillStyle = 'rgba(232,220,192,0.12)';
        x.beginPath(); x.arc(hx, cy, 2.1 * PPM, 0, 6.2832); x.fill();
      });
      x.restore();
    })();

    // 封面左下角小印
    if (opt.sealImg && opt.sealImg.naturalWidth) {
      const sh = 15 * PPM * 2.1;
      const sw = sh * (opt.sealImg.naturalWidth / opt.sealImg.naturalHeight);
      x.save();
      x.translate((mm.sealX || 62) * PPM, (mm.h - (mm.sealY || 34)) * PPM);
      x.rotate(-0.05);
      x.globalAlpha = 0.72;
      x.drawImage(opt.sealImg, -sw / 2, -sh / 2, sw, sh);
      x.restore();
    } else {
      drawSeal(x, (mm.sealX || 62) * PPM, (mm.h - (mm.sealY || 34)) * PPM, 15 * PPM, BOOK_INFO.sealText || '印', { rot: -0.05, alpha: 0.72 });
    }

    return c;
  }

  /* ---------- 洒金内衬纸（封里/护页） ---------- */
  function endpaper(w, h, seed) {
    const { c, x } = mkCanvas(w, h);
    const r = rng(seed);
    paperFill(x, w, h, 0.16);
    for (let i = 0; i < 80; i++) {
      const px = r() * w, py = r() * h, rad = rr(r, w * 0.06, w * 0.4);
      const gg = x.createRadialGradient(px, py, 0, px, py, rad);
      gg.addColorStop(0, `rgba(196,164,104,${rr(r, 0.04, 0.12)})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gg; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 980; i++) {   // 金屑
      const px = r() * w, py = r() * h, s = rr(r, 1.1, 4.6);
      x.save();
      x.translate(px, py); x.rotate(r() * 6.28);
      x.fillStyle = `rgba(${228 + ri(r, 0, 26)},${184 + ri(r, 0, 44)},${92 + ri(r, 0, 54)},${rr(r, 0.35, 0.92)})`;
      x.beginPath();
      x.moveTo(-s, -s * 0.5); x.lineTo(s * 0.9, -s * 0.8); x.lineTo(s * 0.6, s * 0.7); x.lineTo(-s * 0.7, s * 0.6);
      x.closePath(); x.fill();
      x.restore();
    }
    const eg = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    eg.addColorStop(0, 'rgba(180,150,96,0)'); eg.addColorStop(1, 'rgba(174,142,88,0.22)');
    x.fillStyle = eg; x.fillRect(0, 0, w, h);
    return c;
  }

  /* ---------- 书口（纸叠侧面的细密竖纹） ---------- */
  /* dir='v'：线沿画布 y 方向（用于书脊布纹）
   * dir='h'：线沿画布 x 方向（用于书口毛边，线条对应一张张纸边） */
  function striations(w, h, seed, opt) {
    opt = opt || {};
    const { c, x } = mkCanvas(w, h);
    const r = rng(seed);
    x.fillStyle = opt.base || '#e6dcc2';
    x.fillRect(0, 0, w, h);
    const n = opt.lines || 190;
    const horiz = opt.dir === 'h';
    const L = horiz ? w : h;      // 线长
    const S = horiz ? h : w;      // 线间隔方向
    for (let i = 0; i < n; i++) {
      const p = (i / n) * S + rr(r, -0.25, 0.25);
      const a = rr(r, 0.05, 0.30);
      const col = `rgba(${ri(r, 120, 175)},${ri(r, 100, 150)},${ri(r, 60, 105)},${a})`;
      for (const [style, off] of [[col, 0], [`rgba(255,252,238,${rr(r, 0.06, 0.24)})`, 1]]) {
        if (off && r() < 0.4) continue;
        x.strokeStyle = style;
        x.lineWidth = off ? 0.6 : rr(r, 0.4, 1.5);
        x.beginPath();
        if (horiz) { x.moveTo(0, p + off); x.lineTo(w, p + off + rr(r, -0.5, 0.5)); }
        else { x.moveTo(p + off, 0); x.lineTo(p + off + rr(r, -0.5, 0.5), h); }
        x.stroke();
      }
    }
    for (let i = 0; i < 40; i++) {   // 污渍
      const px = r() * w, py = r() * h, rad = rr(r, w * 0.03, w * 0.2);
      const gg = x.createRadialGradient(px, py, 0, px, py, rad);
      gg.addColorStop(0, `rgba(168,134,84,${rr(r, 0.04, 0.12)})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gg; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    return c;
  }

  /* ---------- 环境贴图（等距柱状）：暖色书斋氛围，给纸面一丝反射 ---------- */
  function envEquirect(w, h) {
    const { c, x } = mkCanvas(w, h);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, '#6d7b8c');   // 天
    g.addColorStop(0.34, '#aeb6b4');
    g.addColorStop(0.50, '#c9c0a8');   // 地平线偏暖
    g.addColorStop(0.62, '#5b5148');
    g.addColorStop(1.00, '#191512');   // 地
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // 主光窗
    const add = (px, py, rad, col, a) => {
      const gg = x.createRadialGradient(px, py, 0, px, py, rad);
      gg.addColorStop(0, col.replace('A', a));
      gg.addColorStop(1, col.replace('A', '0'));
      x.fillStyle = gg; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    };
    add(w * 0.72, h * 0.30, w * 0.30, 'rgba(255,232,196,A)', '0.95');
    add(w * 0.18, h * 0.34, w * 0.22, 'rgba(190,206,224,A)', '0.42');
    add(w * 0.46, h * 0.14, w * 0.2, 'rgba(255,244,224,A)', '0.4');
    return c;
  }

  /* ---------- 桌面 ---------- */
  function desk(w, h, seed) {
    const { c, x } = mkCanvas(w, h);
    const r = rng(seed);
    x.fillStyle = '#171310';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const px = r() * w, py = r() * h, rad = rr(r, w * 0.03, w * 0.5);
      const gg = x.createRadialGradient(px, py, 0, px, py, rad);
      const l = r() > 0.5;
      gg.addColorStop(0, l ? `rgba(96,74,54,${rr(r, 0.02, 0.06)})` : `rgba(0,0,0,${rr(r, 0.04, 0.12)})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gg; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 900; i++) {  // 木屑感细颗粒
      x.fillStyle = `rgba(${ri(r, 30, 78)},${ri(r, 24, 62)},${ri(r, 18, 48)},${rr(r, 0.05, 0.3)})`;
      x.fillRect(r() * w, r() * h, rr(r, 0.6, 2.4), rr(r, 0.6, 2.0));
    }
    for (let i = 0; i < 22; i++) {    // 木纹走势
      const y0 = r() * h;
      x.strokeStyle = `rgba(0,0,0,${rr(r, 0.03, 0.10)})`;
      x.lineWidth = rr(r, 1, 6);
      x.beginPath();
      x.moveTo(0, y0);
      for (let px = 0; px < w; px += w / 8) x.lineTo(px, y0 + Math.sin(px / w * 6 + i) * rr(r, 2, 16));
      x.stroke();
    }
    return c;
  }

  /* ---------- 接触阴影（软椭圆） ---------- */
  function contactShadow(w, h) {
    const { c, x } = mkCanvas(w, h);
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return c;
  }

  /* ---------- 浮尘粒子（一枚柔和的光点） ---------- */
  function dotSprite(size) {
    const { c, x } = mkCanvas(size, size);
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.00, 'rgba(255,248,230,1)');
    g.addColorStop(0.28, 'rgba(255,238,200,0.45)');
    g.addColorStop(0.62, 'rgba(240,214,160,0.10)');
    g.addColorStop(1.00, 'rgba(240,214,160,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return c;
  }

  /* ---------- 桌面光池（灯在桌面上晕开的一圈暖光） ---------- */
  function lightPool(w, h) {
    const { c, x } = mkCanvas(w, h);
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0.00, 'rgba(104,80,54,0.46)');
    g.addColorStop(0.30, 'rgba(78,60,42,0.27)');
    g.addColorStop(0.62, 'rgba(52,42,30,0.10)');
    g.addColorStop(1.00, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return c;
  }

  return {
    rng, rr, ri, mkCanvas, tex, setAnisotropy,
    paperBase, normalFromCanvas, renderPage, drawSeal,
    silk, coverArt, endpaper, striations, envEquirect, desk, contactShadow, lightPool, dotSprite,
  };
})();
