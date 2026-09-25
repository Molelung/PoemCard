/* ==========================================================================
 *  book.js —— 书体建模与翻页动画
 *
 *  翻页的核心是「纸不是刚体」：
 *   1) 每一叶绕书脊（z 轴）翻转 0→π；
 *   2) 翻转过程中纸面按圆弧弯曲，书口一侧滞后于根部（所以纸看起来是软的）；
 *   3) 书叶在「右侧叠层」与「左侧叠层」里的高度不同：翻过去的叶子会落到左边
 *      已翻纸摞之上、相对原来下沉 —— 真实书页确实这样层叠换位，缺这一步的
 *      翻书动画会像硬纸片在半空乱飘；
 *   4) 书口（纸摞侧面的毛边）厚度随左右纸摞增减实时变化；
 *   5) 书脊是一块软布，随开合起伏、摊平时自然伏下去。
 * ========================================================================== */
window.BookView = (function () {
  'use strict';

  const DEF = {
    PAGE_W: 0.190,          // 页宽（书脊→书口）
    PAGE_H: 0.285,          // 页高
    BOARD_T: 0.0026,        // 封面硬纸板厚
    SQ: 0.005,              // 封面三边出边（飘口）
    BLOCK_THICK: 0.0085,    // 整叠纸厚度
    SEG_X: 28,              // 页宽方向细分（弯曲用）
    SEG_Y: 4,               // 页高方向细分（纸面微颤用）
    EDGE_REF: 0.0072,       // 书口纹理对应的厚度
    SPRING: 200,            // 翻页弹簧刚度
    DAMP: 0.99,             // 阻尼比（1 = 临界阻尼）
    GUTTER_LEN: 0.030,      // 书脊侧下凹区长度
    GUTTER_DIP: 0.0026,     // 摊开时纸页在书脊侧下凹的深度
    CLEAR: 0.00045,         // 纸摞与封面之间的净空（防止共面闪烁）
    WRAP: 0.014,            // 封面包过书脊的宽度（线装书脊由封面自身包过来）
    SHAVE: 0.0010,          // 书口块顶面往下让的分量（防止穿模）
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  function create(opts) {
    const P = Object.assign({}, DEF, opts.dim || {});
    const W = P.PAGE_W, H = P.PAGE_H, SEG_X = P.SEG_X, SEG_Y = P.SEG_Y;
    const SQ = P.SQ, BT = P.BOARD_T;
    const pages = opts.pages || [];
    const N = pages.length;
    const TH = clamp(P.BLOCK_THICK / Math.max(1, N), 0.0005, 0.0018);
    const group = new THREE.Group();
    const items = [];
    const sheets = [];
    const mats = {};

    /* ---------- 圆角板（封面） ---------- */
    function roundedBox(w, h, d, r, seg) {
      r = Math.max(0.0002, Math.min(r, Math.min(w, h, d) / 2 - 1e-5));
      const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const cx = clamp(v.x, -ix, ix), cy = clamp(v.y, -iy, iy), cz = clamp(v.z, -iz, iz);
        const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
        const len = Math.hypot(dx, dy, dz) || 1;
        pos.setXYZ(i, cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
      }
      g.computeVertexNormals();
      return g;
    }

    function buildBoard(faceTex, innerTex) {
      const w = W + SQ + P.WRAP, d = H + SQ * 2;
      const geo = roundedBox(w, BT, d, BT * 0.32, 3);
      geo.translate(w / 2 - P.WRAP, 0, 0);        // 铰链在 x=0，左侧多包 14mm
      const edge = mats.boardEdge;
      const mesh = new THREE.Mesh(geo, [edge, edge, faceTex, innerTex, edge, edge]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.y = BT / 2;
      const pivot = new THREE.Group();
      pivot.add(mesh);
      group.add(pivot);
      return { pivot, mesh, w, d };
    }

    /* ---------- 书口（纸摞侧面） ---------- */
    function buildBlock(side) {
      const gw = P.GUTTER_LEN;
      const geo = new THREE.BoxGeometry(W - gw, 1, H);
      const edgeMat = new THREE.MeshStandardMaterial({ map: opts.edgeTex, roughness: 0.92, metalness: 0 });
      const capMat = new THREE.MeshStandardMaterial({ color: 0xd6c8a8, roughness: 0.95, metalness: 0 });
      const innerMat = new THREE.MeshStandardMaterial({ color: 0x2b2318, roughness: 1, metalness: 0 });
      // 书脊侧那一面朝沟槽，用暗色；书口侧用纸边纹理
      const mats = side > 0
        ? [edgeMat, edgeMat, capMat, capMat, edgeMat, edgeMat]
        : [edgeMat, edgeMat, capMat, capMat, edgeMat, edgeMat];
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.userData.pick = side > 0 ? 'f' : 'b';   // 点书口＝翻页
      group.add(mesh);
      return mesh;
    }

    /* ---------- 书叶：正反两面同用一个网格体（FrontSide/BackSide 各一半） ---------- */
    function buildSheet(idx, pageData) {
      const geo = new THREE.PlaneGeometry(W, H, SEG_X, SEG_Y);
      geo.rotateX(-Math.PI / 2);
      geo.translate(W / 2, 0, 0);
      // 形变后包围球会失效，直接给一个永远包得住的，省去每帧重算
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Math.hypot(W, H / 2) + 0.03);

      const rectoTex = opts.makePageTex(pageData.recto, 'r', idx);
      const versoTex = opts.makePageTex(pageData.verso, 'v', idx);
      versoTex.wrapS = THREE.RepeatWrapping;
      versoTex.repeat.x = -1;          // 背面镜像，字才不是反的
      versoTex.offset.x = 1;

      const common = {
        normalMap: opts.paperNormal,
        normalScale: new THREE.Vector2(0.32, 0.32),
        roughness: 0.94, metalness: 0,
        sheen: 0.30, sheenRoughness: 0.9,
        sheenColor: new THREE.Color(0xfff2dd),
        envMapIntensity: 0.42,
      };
      const matR = new THREE.MeshPhysicalMaterial(Object.assign({ map: rectoTex, side: THREE.FrontSide }, common));
      const matV = new THREE.MeshPhysicalMaterial(Object.assign({ map: versoTex, side: THREE.BackSide }, common));
      const g = new THREE.Group();
      const mR = new THREE.Mesh(geo, matR);
      const mV = new THREE.Mesh(geo, matV);
      mR.castShadow = true; mV.castShadow = false;
      mR.receiveShadow = true; mV.receiveShadow = true;
      g.add(mR, mV);
      g.position.y = 0;
      group.add(g);

      // 每个顶点距书脊的弧长 / 页高坐标
      const pAttr = geo.attributes.position;
      const n = pAttr.count;
      const sArr = new Float32Array(n), zArr = new Float32Array(n);
      for (let i = 0; i < n; i++) { sArr[i] = Math.max(0, pAttr.getX(i)); zArr[i] = pAttr.getZ(i); }

      const item = {
        kind: 'sheet', idx, r: idx, group: g, geo, seg: { s: sArr, z: zArr, n },
        p: 0, target: 0, vel: 0, delay: 0,
        phase: (idx * 1.71) % 6.283,
        pageData,
      };
      mR.userData.item = item; mV.userData.item = item;
      sheets.push(item);
      return item;
    }

    /* ================= 组装 ================= */
    // 材质素材
    opts.edgeTex = Tex.tex(Tex.striations(256, 256, 4242, { lines: 64, dir: 'h', base: '#ded1b0' }), { wrap: true });
    opts.spineTex = Tex.tex(Tex.striations(48, 512, 918, { lines: 130, dir: 'v', base: '#2a333d' }), { wrap: true });
    opts.paperNormal = Tex.tex(Tex.normalFromCanvas(opts.paperCanvas, 0.55), { srgb: false });

    mats.boardEdge = new THREE.MeshStandardMaterial({ color: 0x9d8d73, roughness: 0.94, metalness: 0 });
    const coverMat = new THREE.MeshPhysicalMaterial({
      map: Tex.tex(opts.coverCanvas), roughness: 0.90, metalness: 0, clearcoat: 0.03, clearcoatRoughness: 0.85,
      envMapIntensity: 0.55,
      normalMap: opts.coverNormalCanvas ? Tex.tex(opts.coverNormalCanvas, { srgb: false, wrap: true }) : null,
      normalScale: new THREE.Vector2(0.45, 0.45),
    });
    const innerMatA = new THREE.MeshPhysicalMaterial({ map: Tex.tex(opts.innerCanvasA), roughness: 0.95, metalness: 0 });
    const innerMatB = new THREE.MeshPhysicalMaterial({ map: Tex.tex(opts.innerCanvasB), roughness: 0.95, metalness: 0 });

    const backBoard = buildBoard(coverMat, innerMatB);
    const frontBoard = buildBoard(coverMat, innerMatA);

    /* ---------- 书脊侧实心纸边（线装书的书脊＝纸页侧边＋过线） ---------- */
    function buildSpineFill() {
      const g = new THREE.BoxGeometry(0.008, 1, H);
      const m = new THREE.MeshStandardMaterial({ map: opts.edgeTex, roughness: 0.92, metalness: 0 });
      const mesh = new THREE.Mesh(g, [m, m, m, m, m, m]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    }

    /* ---------- 四眼线装：书脊边上的过线与穿针 ---------- */
    function buildThreads() {
      const mat = new THREE.MeshStandardMaterial({ color: 0xd8cba9, roughness: 0.68, metalness: 0.04 });
      const g = new THREE.Group();
      group.add(g);
      const gap = H * 0.235, cy = 0;      // 书的 z 中心是 0（不是 H/2，否则线会跑到书外）
      const zs = [cy - gap * 1.5, cy - gap * 0.5, cy + gap * 0.5, cy + gap * 1.5];
      const R = 0.00095;
      const parts = [];
      for (let i = 0; i < zs.length - 1; i++) {          // 竖向过线
        const len = zs[i + 1] - zs[i] + 0.0012;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 7), mat);
        m.rotation.x = Math.PI / 2;
        m.position.set(-0.0054, 0, (zs[i] + zs[i + 1]) / 2);
        m.receiveShadow = true;
        g.add(m); parts.push({ mesh: m });
      }
      zs.forEach((z) => {                                 // 四针穿过书芯
        const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.016, 8), mat);
        m.rotation.z = Math.PI / 2;
        m.position.set(0.0015, 0, z);
        m.receiveShadow = true;
        g.add(m); parts.push({ mesh: m });
      });
      return { group: g, parts, zs };
    }

    pages.forEach((pg, i) => buildSheet(i, pg));
    const ordered = sheets.slice();                  // 阅读序（buildSheet 内部已入栈）
    const blockR = buildBlock(1);
    const blockL = buildBlock(-1);
    const spineFillR = buildSpineFill();
    const spineFillL = buildSpineFill();
    const threads = buildThreads();

    // 翻动单元：0 = 前封面，1..N = 书叶（阅读序）
    const coverItem = {
      kind: 'cover', r: -1, pivot: frontBoard.pivot, mesh: frontBoard.mesh,
      p: 0, target: 0, vel: 0, delay: 0,
      pageData: { recto: { kind: 'cover' }, verso: { kind: 'endpaper' } },
    };
    items.push(coverItem, ...ordered);

    frontBoard.mesh.userData.item = coverItem;
    backBoard.mesh.userData.pick = 'none';     // 封底不可翻

    const api = {
      group, items, P, TH, N, W, H, blockR, blockL, spineFillR, spineFillL, threads,
      cursor: 0,
    };

    Object.assign(api, {
      /* 目标层高 */
      restY(it) {
        const C = P.CLEAR;
        if (it.kind === 'cover') return lerp(BT + C + N * TH, 0, smooth(clamp(it.p, 0, 1)));
        return BT + C + lerp(N - 1 - it.r, it.r, smooth(clamp(it.p, 0, 1))) * TH;
      },
      curl(it) { return Math.sin(Math.PI * clamp(it.p, 0, 1)) * (0.50 + 0.09 * Math.sin(it.phase)); },
      updateGeom(it) {
        const geo = it.geo, seg = it.seg, alpha = this.curl(it), t = clamp(it.p, 0, 1);
        const pos = geo.attributes.position;
        const R = alpha > 1e-4 ? W / alpha : 0;
        const h = alpha / 2;
        const wob = 0.00005 + 0.00034 * Math.sin(Math.PI * t);
        // 摊平状态下，靠书脊一侧自然下凹（装订成册的关键特征）
        const dip = (this.gutterDip || 0) * (1 - Math.sin(Math.PI * t));
        const gl = P.GUTTER_LEN;
        for (let i = 0; i < seg.n; i++) {
          const s = seg.s[i], z = seg.z[i];
          let x, y;
          if (R > 0) {
            const a = h - (alpha * s) / W;
            x = R * (Math.sin(h) - Math.sin(a));
            y = R * (Math.cos(h) - Math.cos(a));
          } else { x = s; y = 0; }
          y += wob * Math.sin((s / W) * Math.PI) *
               (0.62 * Math.sin(z * 9.0 + it.phase) + 0.38 * Math.sin(z * 17.0 - it.phase * 1.7));
          if (dip > 1e-6) {
            const k = Math.max(0, 1 - s / gl);
            y -= dip * Math.pow(k, 1.45);
          }
          pos.setXYZ(i, x, y, z);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      },
      apply(it) {
        const rot = clamp(it.p, 0, 1) * Math.PI;
        if (it.kind === 'cover') {
          it.pivot.rotation.z = rot;
          it.pivot.position.y = this.restY(it);
        } else {
          it.group.rotation.z = rot;
          it.group.position.y = this.restY(it);
          this.updateGeom(it);
        }
      },
      tickDelays(dt) {
        for (const it of items) {
          if (it.delay > 0) {
            it.delay -= dt;
            if (it.delay <= 0) { it.delay = 0; it.vel = it.target > 0.5 ? 3.0 : -3.0; }
          }
        }
      },
      update(dt) {
        dt = Math.min(dt, 0.25);
        // 开合程度决定纸页在书脊处的下凹深度（摊平时凹，合拢时平）
        const coverP = clamp(items[0].p, 0, 1);
        const newDip = P.GUTTER_DIP * smooth(coverP);
        const dipChanged = Math.abs(newDip - (this.gutterDip || 0)) > 3e-5;
        this.gutterDip = newDip;

        // 固定步长积分：帧率再低弹簧也不会发散（这是之前"翻回去乱跳"的根因）
        const STEP = 1 / 120;
        this._acc = (this._acc || 0) + dt;
        let steps = 0;
        while (this._acc >= STEP && steps < 32) {
          this.tickDelays(STEP);
          this._integrate(STEP);
          this._acc -= STEP;
          steps++;
        }
        if (steps >= 32) this._acc = 0;

        for (const it of items) {
          if (dipChanged) it._dirty = true;
          if (it._dirty) { this.apply(it); it._dirty = false; }
        }
        this.updatePiles();
        return !!this._moving;
      },
      _integrate(dt) {
        const K = P.SPRING, D = 2 * Math.sqrt(K) * P.DAMP;
        let moving = false;
        for (const it of items) {
          if (it.delay > 0) { moving = true; continue; }
          if (it.p === it.target && it.vel === 0) continue;
          it.vel += (K * (it.target - it.p) - D * it.vel) * dt;
          it.p += it.vel * dt;
          if (Math.abs(it.p - it.target) < 0.0015 && Math.abs(it.vel) < 0.3) {
            it.p = it.target; it.vel = 0;
          }
          it._dirty = true;
          moving = true;
        }
        this._moving = moving;
      },
      updatePiles() {
        let turnedSheets = 0, coverP = 0;
        for (const it of items) {
          if (it.kind === 'cover') coverP = clamp(it.p, 0, 1);
          else turnedSheets += clamp(it.p, 0, 1);
        }
        const rightCount = N - turnedSheets;
        const rightTop = BT + P.CLEAR + Math.max(0, rightCount - 1) * TH;
        const rightTh = Math.max(0, rightTop - BT - P.SHAVE);
        const leftTop = turnedSheets > 0.02 ? BT + P.CLEAR + (turnedSheets - 1) * TH : BT;
        const leftTh = Math.max(0, leftTop - BT - P.SHAVE);

        const gw = P.GUTTER_LEN;
        const bw = W - gw;
        if (rightTh > 0.00012) {
          blockR.visible = true;
          blockR.scale.y = rightTh;
          blockR.position.set(gw + bw / 2, BT + rightTh / 2, 0);
          blockR.material[0].map.repeat.set(1, rightTh / P.EDGE_REF);
        } else blockR.visible = false;

        if (leftTh > 0.00012) {
          blockL.visible = true;
          blockL.scale.y = leftTh;
          blockL.position.set(-(gw + bw / 2), BT + leftTh / 2, 0);
          blockL.material[1].map.repeat.set(1, leftTh / P.EDGE_REF);
        } else blockL.visible = false;

        // 书脊侧实心纸边 + 线装过线（随开合升降）
        const spineTop = BT + lerp(P.CLEAR + N * TH, 0, smooth(coverP)) - P.GUTTER_DIP - 0.0006;
        const midY = (BT + Math.max(BT + 0.0006, spineTop)) / 2;
        [spineFillR, spineFillL].forEach((m, k) => {
          const th = Math.max(0, spineTop - BT);
          if (th > 0.0004) {
            m.visible = true;
            m.scale.y = th;
            m.position.set((k === 0 ? 1 : -1) * 0.004, BT + th / 2, 0);
          } else m.visible = false;
        });
        threads.parts.forEach((pt) => {
          pt.mesh.position.y = midY;
          pt.mesh.visible = spineTop > BT + 0.0006;
        });
      },
      /* ---------- 交互 ---------- */
      next() {
        if (this.cursor >= N + 1) return false;
        const it = items[this.cursor];
        it.target = 1; it.vel = Math.max(it.vel, 3.4);
        this.cursor++;
        return true;
      },
      prev() {
        if (this.cursor <= 0) return false;
        this.cursor--;
        const it = items[this.cursor];
        it.target = 0; it.vel = Math.min(it.vel, -3.4);
        return true;
      },
      /** 跳到第 n 个状态（0=合上，1=开了封面，…，N+1=全翻完） */
      goTo(n, opt) {
        opt = opt || {};
        const tgt = clamp(Math.round(n), 0, N + 1);
        const from = this.cursor;
        this.cursor = tgt;
        items.forEach((it, i) => {
          const want = i < tgt ? 1 : 0;
          if (opt.instant) { it.p = want; it.target = want; it.vel = 0; it.delay = 0; this.apply(it); it._dirty = false; return; }
          it.target = want;
          const turning = i < tgt && i >= from;
          const back = i >= tgt && i < from;
          const k = turning ? i - from : (back ? from - 1 - i : -1);
          const stagger = opt.riffle ? 0.026
            : (opt.stagger !== undefined ? opt.stagger : 0.075);
          it.delay = stagger * Math.max(0, k);
          if (it.delay > 0) it.vel = 0;
        });
        if (opt.instant) this.updatePiles();
      },
      beginDrag(it) { this._drag = it; it.vel = 0; },
      dragTo(it, p, syncCursor) {
        it.p = clamp(p, 0, 1); it.target = it.p; it.vel = 0; it.delay = 0;
        it._dirty = false;
        this.apply(it);
        if (syncCursor) {
          this.cursor = it.kind === 'cover' ? (p > 0.5 ? 1 : 0) : clamp(it.r + (p > 0.5 ? 1 : 0), 0, N + 1);
        }
      },
      endDrag(fling) {
        const it = this._drag;
        this._drag = null;
        if (!it) return null;
        let to;
        if (fling > 0.35) to = 1;
        else if (fling < -0.35) to = 0;
        else to = it.p > 0.32 ? 1 : 0;
        it.target = to;
        it.vel = 0;
        this.cursor = it.kind === 'cover'
          ? (to > 0.5 ? 1 : 0)
          : clamp(it.r + (to > 0.5 ? 1 : 0), 0, N + 1);
        return { item: it, to };
      },
      spread() {
        const c = this.cursor;
        const left = c >= 1 ? items[c - 1].pageData.verso : null;
        const right = c <= N ? items[c].pageData.recto : null;
        return { left, right, index: c, total: N + 1 };
      },
      /** 包围盒按「目标状态」算，不用动画中间态，取景才不会每翻一页就推拉一次 */
      extent() {
        const minX = this.cursor >= 1 ? -(W + SQ) : 0;
        const maxX = W + SQ;
        return { minX, maxX, cx: (minX + maxX) / 2, half: (maxX - minX) / 2 };
      },
    });

    api.goTo(0, { instant: true });
    return api;
  }

  return { create, DEF };
})();
