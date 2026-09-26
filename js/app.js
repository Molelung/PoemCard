/* ==========================================================================
 *  app.js —— 悬浮书册：场景 / 灯光 / 相机 / 交互 / 界面
 *  · 书悬浮在空中（无桌面、无地面），背景透明由 CSS 出氛围
 *  · 灯光跟着相机走，所以怎么转书，纸面都有好光
 *  · 拖拽＝自由旋转（上下左右都能转），点击＝翻页，拖纸口＝慢翻
 *  · 合着的时候点封面＝哗啦啦连翻到最新那一首
 * ========================================================================== */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const waitFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const CFG = {
    /* 纸页纹理倍率：越大越清晰、生成越慢、显存越多 */
    texScale: Math.min(isMobile ? 0.95 : 1.5, (BOOK_STYLE && BOOK_STYLE.texScale) || 1.5),
    maxPixelRatio: isMobile ? 1.5 : 2,
    idleFloat: true,
    sound: true,
  };

  /* ==========================================================================
   *  进度
   * ========================================================================== */
  const loader = $('#loader'), loaderBar = $('#loader-bar'), loaderPct = $('#loader-pct'), loaderMsg = $('#loader-msg');
  function progress(p, msg) {
    if (loaderBar) loaderBar.style.width = (p * 100).toFixed(0) + '%';
    if (loaderPct) loaderPct.textContent = (p * 100).toFixed(0) + '%';
    if (msg && loaderMsg) loaderMsg.textContent = msg;
  }

  /* ==========================================================================
   *  音效：柔和的纸声（合成，无音频文件）。刻意做得很轻。
   * ========================================================================== */
  const Sfx = {
    ctx: null, on: CFG.sound, noise: null,
    boot() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {          // 棕噪：比白噪柔和，不刺耳
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      this.noise = buf;
    },
    /** 一叶纸翻动：低通扫频的短促气声，音量很小 */
    page(speed, when, vol) {
      if (!this.on) return;
      this.boot();
      const c = this.ctx;
      if (!c || c.state === 'suspended') return;
      const t0 = c.currentTime + (when || 0);
      const v = clamp(speed || 1, 0.5, 1.6);
      const dur = 0.20 + 0.12 * v;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.9 + Math.random() * 0.25;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(900 + Math.random() * 700, t0);
      lp.frequency.exponentialRampToValueAtTime(360, t0 + dur);
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 260;
      const g = c.createGain();
      const peak = 0.020 * v * (vol === undefined ? 1 : vol);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.045);      // 慢起音＝不"啪"
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(c.destination);
      src.start(t0); src.stop(t0 + dur + 0.06);
    },
    /** 连翻：一串错开的轻响 */
    riffle(n) {
      const k = Math.min(8, Math.max(3, n));
      for (let i = 0; i < k; i++) this.page(1.3, i * 0.055, 0.85 - i * 0.06);
    },
  };

  /* ==========================================================================
   *  资源
   * ========================================================================== */
  async function loadBundledFont() {
    if (BOOK_STYLE && BOOK_STYLE.useBundledFont === false) return false;
    try {
      const face = new FontFace('Zhongchun Fangsong', "url('fonts/ZhongchunFangsong-S2T.ttf')");
      await Promise.race([face.load(), new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 25000))]);
      document.fonts.add(face);
      return true;
    } catch (e) {
      console.warn('自带「仲春仿宋」未加载，退回系统楷体：' + e.message);
      return false;
    }
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('图片加载失败：' + src));
      img.src = src;
    });
  }

  /* ==========================================================================
   *  场景
   * ========================================================================== */
  let renderer, scene, camera, book, raycaster, plan;
  let keyLight, rimLight, dust, dustGeo;
  const floatGroup = new THREE.Group();        // 悬浮微动（起伏/侧倾）挂这里
  const worldGroup = new THREE.Group();        // 相机环绕的锚点

  const view = {
    az: 0.36, pol: 1.16, zoom: 1,
    vAz: 0, vPol: 0,                    // 惯性
    pan: new THREE.Vector3(0, 0, 0),    // 画面平移（沿相机右/上方向）
    target: new THREE.Vector3(0, 0, 0),
    pose: 0, poseT: 0,                  // 0 = 平放，1 = 立起
  };
  const pointer = {
    down: false, mode: null, x0: 0, y0: 0, lx: 0, ly: 0, lt: 0,
    moved: 0, item: null, hitItem: null, dir: 0, p0: 0, gain: 1, vel: 0,
    hoverItem: null, az0: 0, pol0: 0,
  };
  let lastInteract = 0;
  let autoRiffled = false;
  let wheelAcc = 0;

  function initRenderer() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearAlpha(0);                       // 背景透明，氛围交给 CSS
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('stage').appendChild(renderer.domElement);
  }

  function initScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.02, 40);
    raycaster = new THREE.Raycaster();

    // 环境贴图（暖色书斋）
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = new THREE.CanvasTexture(Tex.envEquirect(768, 384));
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    const rt = pmrem.fromEquirectangular(envTex);
    scene.environment = rt.texture;
    envTex.dispose();
    pmrem.dispose();

    // 三点光：位置每帧跟着相机算，转到哪一面都有光
    keyLight = new THREE.DirectionalLight(0xfff3e0, 1.14);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    keyLight.shadow.camera.near = 0.05;
    keyLight.shadow.camera.far = 3.2;
    const S = 0.46;
    keyLight.shadow.camera.left = -S;
    keyLight.shadow.camera.right = S;
    keyLight.shadow.camera.top = S;
    keyLight.shadow.camera.bottom = -S;
    keyLight.shadow.bias = -0.00018;
    keyLight.shadow.normalBias = 0.0024;
    keyLight.shadow.radius = 2.6;
    scene.add(keyLight, keyLight.target);

    rimLight = new THREE.DirectionalLight(0xffd9a8, 0.5);
    scene.add(rimLight, rimLight.target);

    const fill = new THREE.DirectionalLight(0xd9d2c4, 0.30);
    fill.position.set(-0.5, 0.35, 0.6);
    scene.add(fill);

    scene.add(new THREE.HemisphereLight(0xa8a196, 0x2b231a, 0.30));

    scene.add(worldGroup);
    worldGroup.add(floatGroup);

    // 浮尘：让"悬在空中"有体积感
    const N = isMobile ? 90 : 190;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1.5;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 1.1;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    }
    dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.0055, sizeAttenuation: true, transparent: true, opacity: 0.46,
      map: Tex.tex(Tex.dotSprite(64)), blending: THREE.AdditiveBlending, depthWrite: false,
      color: 0xe8d9b4,
    }));
    scene.add(dust);
  }

  /** 灯光跟着相机：始终是相机右上偏侧的主光 + 背后的轮廓光 */
  function updateLights() {
    const c = camera.position;
    const toCam = new THREE.Vector3(c.x, c.y, c.z);
    if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, 1);
    toCam.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, toCam).normalize();
    const dir = new THREE.Vector3()
      .addScaledVector(toCam, 0.82)
      .addScaledVector(up, 0.60)
      .addScaledVector(right, -0.44)
      .normalize();
    keyLight.position.copy(dir).multiplyScalar(1.5);
    keyLight.target.position.set(0, 0, 0);

    const rd = new THREE.Vector3()
      .addScaledVector(toCam, -0.55)
      .addScaledVector(up, 0.32)
      .addScaledVector(right, 0.5)
      .normalize();
    rimLight.position.copy(rd).multiplyScalar(1.6);
    rimLight.target.position.set(0, 0, 0);
    keyLight.target.updateMatrixWorld();
    rimLight.target.updateMatrixWorld();
  }

  /* ---------------- 相机取景：八角点投影 ----------------
   * 把书的包围盒八个角点投到相机坐标系，逐个求"要多远才不出画"，
   * 取最大值。斜看、立起、旋转到任何角度都不会裁边。
   * ------------------------------------------------------------------ */
  function bookCorners() {
    const e = book ? book.extent() : { minX: 0, maxX: 0.2 };
    const P = book ? book.P : {};
    const yTop = (P.BOARD_T || 0.0026) + (P.CLEAR || 0.0005) + (book ? book.N * book.TH : 0.008) + (P.BOARD_T || 0.0026);
    const zz = (book ? book.H : 0.285) / 2 + (P.SQ || 0.005);
    const pts = [];
    for (const x of [e.minX, e.maxX]) {
      for (const y of [0, yTop]) {
        for (const z of [-zz, zz]) pts.push(new THREE.Vector3(x, y, z));
      }
    }
    book.group.updateMatrixWorld(true);
    return pts.map((p) => p.applyMatrix4(book.group.matrixWorld));
  }
  function fitBox(pts) {
    const c = new THREE.Vector3();
    pts.forEach((p) => c.add(p));
    c.multiplyScalar(1 / Math.max(1, pts.length));
    const sp = Math.sin(view.pol), cp = Math.cos(view.pol);
    const dir = new THREE.Vector3(sp * Math.sin(view.az), cp, sp * Math.cos(view.az)); // 目标→相机
    const fwd = dir.clone().negate();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const t = Math.tan((camera.fov * Math.PI) / 180 / 2);
    const asp = camera.aspect;
    let d = 0.001;
    for (const p of pts) {
      const v = p.clone().sub(c);
      const x = v.dot(right), y = v.dot(up), z = v.dot(dir);
      // 该点要落在视锥内，需要 d ≥ z + |x|/(t·aspect) 且 d ≥ z + |y|/t
      d = Math.max(d, z + Math.abs(x) / (t * asp), z + Math.abs(y) / t);
    }
    return { d: d * 1.045 + 0.004, center: c };
  }
  function fitDistance() {
    return fitBox(bookCorners()).d;
  }
  function applyCamera(dt) {
    const fit = book ? fitBox(bookCorners()) : { d: 0.7, center: new THREE.Vector3() };
    view.target.lerp(fit.center, 1 - Math.exp(-3.2 * dt));

    view.az += view.vAz * dt;                 // 松手后的惯性
    view.pol += view.vPol * dt;
    const damp = Math.exp(-2.8 * dt);
    view.vAz *= damp; view.vPol *= damp;
    if (Math.abs(view.vAz) < 1e-5) view.vAz = 0;
    if (Math.abs(view.vPol) < 1e-5) view.vPol = 0;

    view.pol = clamp(view.pol, 0.055, Math.PI - 0.055);
    view.zoom = clamp(view.zoom, 0.40, 2.8);
    const d = fit.d * view.zoom;
    const sp = Math.sin(view.pol);
    const cp = new THREE.Vector3(
      view.target.x + d * sp * Math.sin(view.az),
      view.target.y + d * Math.cos(view.pol),
      view.target.z + d * sp * Math.cos(view.az)
    );
    // 平移：沿相机自身的右/上方向推拉画面（这样拖去哪就看哪）
    const fwd = new THREE.Vector3().subVectors(view.target, cp).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const look = view.target.clone()
      .addScaledVector(right, view.pan.x)
      .addScaledVector(up, view.pan.y);
    cp.addScaledVector(right, view.pan.x).addScaledVector(up, view.pan.y);
    camera.position.copy(cp);
    camera.lookAt(look);
    view.pan.x = clamp(view.pan.x, -0.35, 0.35);
    view.pan.y = clamp(view.pan.y, -0.30, 0.30);
  }

  /* ---------------- 拾取 ---------------- */
  const pickList = [];
  function buildPickList() {
    pickList.length = 0;
    book.group.traverse((o) => { if (o.isMesh && (o.userData.item || o.userData.pick)) pickList.push(o); });
  }
  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickList, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud.pick === 'none') return null;
      if (ud.pick === 'f') return { type: 'block', dir: 1 };
      if (ud.pick === 'b') return { type: 'block', dir: -1 };
      const it = ud.item;
      if (!it) continue;
      if (it.p > 0.02 && it.p < 0.985) continue;      // 半途中的页不当目标
      const idx = book.items.indexOf(it);
      return { type: 'item', item: it, dir: idx >= book.cursor ? 1 : -1, edge: isNearForeEdge(it, h.point) };
    }
    return null;
  }
  /** 命中点是否落在纸口那 1/3（只有这里拖拽才算"翻页"，纸面其它地方拖动＝转书） */
  function isNearForeEdge(it, point) {
    const obj = it.kind === 'cover' ? it.mesh : it.group;
    const local = obj.worldToLocal(point.clone());
    return Math.max(0, local.x) > book.W * 0.62;
  }
  function pageScreenWidth() {
    const a = new THREE.Vector3(0, 0, 0).project(camera);
    const b = new THREE.Vector3(book.W, 0, 0).project(camera);
    return Math.max(70, Math.abs(b.x - a.x) * 0.5 * renderer.domElement.clientWidth);
  }

  /* ---------------- 状态 → 页码 / 最新一叶 ---------------- */
  function cursorForPage(pageData) {
    for (let i = 0; i < plan.sheets.length; i++) {
      if (plan.sheets[i].recto === pageData) return i + 1;   // 该面在右侧
      if (plan.sheets[i].verso === pageData) return i + 2;   // 该面在左侧
    }
    return 0;
  }
  function newestPage() {
    const last = POEMS.length - 1;
    const range = plan.poemPages[last];
    if (!range) return null;
    const pages = plan.bodyPages.filter((p) => p.poemIndex === last);
    // 有长小序时，扬到"诗题所在那一面"，而不是小序那一面
    return pages.find((p) => (p.columns || []).some((c) => c.isTitle)) || pages[0];
  }
  function riffleTo(cursor) {
    if (cursor === null || cursor === undefined) return;
    const n = Math.abs(cursor - book.cursor);
    book.goTo(cursor, { riffle: true });
    if (n > 2) Sfx.riffle(n); else Sfx.page(1);
    syncUI();
    lastInteract = performance.now();
  }

  /* ---------------- UI ---------------- */
  const ui = {};
  function sideLabel(pg) {
    if (!pg) return '—';
    const k = pg.kind;
    if (k === 'cover') return BOOK_INFO.title || '封面';
    if (k === 'endpaper') return '封里';
    if (k === 'title') return '扉页';
    if (k === 'toc') return '目錄';
    if (k === 'body') {
      const poem = POEMS[pg.poemIndex];
      const hasTitle = (pg.columns || []).some((c) => c.isTitle);
      if (hasTitle) return poem ? poem.title : '正文';
      return (poem ? poem.title + ' · ' : '') + '小序';
    }
    if (k === 'colophon') return '卷末跋语';
    if (k === 'blank') return '护叶';
    return '';
  }

  function openScroll() {
    if (!ui.scrollOverlay) return;
    ui.scrollOverlay.classList.add('open');
    ui.scrollOverlay.setAttribute('aria-hidden', 'false');
    Sfx.page(0.85);
    lastInteract = performance.now();
  }

  function closeScroll() {
    if (!ui.scrollOverlay) return;
    ui.scrollOverlay.classList.remove('open');
    ui.scrollOverlay.setAttribute('aria-hidden', 'true');
    Sfx.page(0.95);
    lastInteract = performance.now();
  }

  function buildUI() {
    ui.curPoemTitle = $('#cur-poem-title');
    ui.curPageInfo = $('#cur-page-info');
    ui.btnPrev = $('#btn-prev');
    ui.btnNext = $('#btn-next');
    ui.btnSound = $('#btn-sound');
    ui.btnPose = $('#btn-pose');
    ui.hint = $('#hint');

    ui.scrollOverlay = $('#scroll-overlay');
    ui.scrollBackdrop = $('#scroll-backdrop');
    ui.btnOpenScroll = $('#btn-open-scroll');
    ui.btnCloseScroll = $('#btn-close-scroll');
    ui.btnRollUp = $('#btn-roll-up');
    ui.sBtnPose = $('#s-btn-pose');
    ui.sBtnSound = $('#s-btn-sound');
    ui.sBtnReset = $('#s-btn-reset');
    ui.scrollNavPages = $('#scroll-nav-pages');

    if (ui.btnPrev) ui.btnPrev.addEventListener('click', () => doFlip(-1));
    if (ui.btnNext) ui.btnNext.addEventListener('click', () => doFlip(1));

    if (ui.btnOpenScroll) ui.btnOpenScroll.addEventListener('click', openScroll);
    if (ui.btnCloseScroll) ui.btnCloseScroll.addEventListener('click', closeScroll);
    if (ui.btnRollUp) ui.btnRollUp.addEventListener('click', closeScroll);
    if (ui.scrollBackdrop) ui.scrollBackdrop.addEventListener('click', closeScroll);

    const toggleSound = () => {
      Sfx.on = !Sfx.on;
      if (ui.btnSound) {
        ui.btnSound.classList.toggle('off', !Sfx.on);
        ui.btnSound.textContent = Sfx.on ? '清音' : '幽静';
        ui.btnSound.setAttribute('aria-pressed', String(Sfx.on));
      }
      if (ui.sBtnSound) {
        ui.sBtnSound.querySelector('.chip-txt').textContent = Sfx.on ? '清音 · 启' : '清音 · 闭';
      }
      if (Sfx.on) Sfx.page(0.9);
      lastInteract = performance.now();
    };

    const togglePose = () => {
      view.poseT = view.poseT ? 0 : 1;
      Sfx.page(0.85);
      syncUI();
      lastInteract = performance.now();
    };

    const resetView = () => {
      view.az = 0.36; view.pol = 1.16; view.zoom = 1; view.vAz = view.vPol = 0;
      view.pan.set(0, 0, 0);
      view.poseT = 0;
      Sfx.page(0.85);
      syncUI();
      lastInteract = performance.now();
    };

    if (ui.btnSound) ui.btnSound.addEventListener('click', toggleSound);
    if (ui.sBtnSound) ui.sBtnSound.addEventListener('click', toggleSound);
    if (ui.btnPose) ui.btnPose.addEventListener('click', togglePose);
    if (ui.sBtnPose) ui.sBtnPose.addEventListener('click', togglePose);
    if (ui.sBtnReset) ui.sBtnReset.addEventListener('click', resetView);

    // 卷轴内各叶直达导航
    if (ui.scrollNavPages) {
      ui.scrollNavPages.querySelectorAll('.nav-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tgt = parseInt(btn.dataset.cursor, 10);
          if (!isNaN(tgt)) {
            const n = Math.abs(tgt - book.cursor);
            book.goTo(tgt, { riffle: n > 2 });
            n > 2 ? Sfx.riffle(n) : Sfx.page(1);
            syncUI();
            lastInteract = performance.now();
          }
        });
      });
    }

    syncUI();
  }

  function syncUI() {
    const sp = book.spread();
    const L = sp.left, R = sp.right;
    let main = null;
    if (R && R.kind === 'body') main = R;
    else if (L && L.kind === 'body') main = L;
    else if (R && R.kind !== 'cover' && R.kind !== 'endpaper') main = R;
    else if (L && L.kind !== 'endpaper' && L.kind !== 'cover') main = L;

    let title, sub = '';
    if (main) {
      title = sideLabel(main);
      if (main.kind === 'body') {
        const poem = POEMS[main.poemIndex];
        const l = poem && Lunar.solarToLunar(poem.date);
        if (l) sub = l.ganzhi + l.monthAlias + (l.term ? ' · ' + l.term : '');
        if (poem && poem.place) sub += (sub ? ' · ' : '') + poem.place;
      }
    } else {
      title = BOOK_INFO.title || '墨瀾詩草';
      sub = book.cursor === 0 ? '合册 · 点封面翻开' : (book.cursor > book.N ? '末叶 · 跋语终' : '');
    }

    if (ui.curPoemTitle) {
      ui.curPoemTitle.textContent = title === '封面' ? BOOK_INFO.title || '墨瀾詩草' : `《${title}》`;
    }
    if (ui.curPageInfo) {
      let pageText = '';
      if (book.cursor === 0) pageText = '合　册';
      else if (book.cursor > book.N) pageText = '卷末 · 跋语终';
      else pageText = `第 ${book.cursor} 叶 / 共 ${book.N} 叶` + (sub ? ` · ${sub}` : '');
      ui.curPageInfo.textContent = pageText;
    }

    if (ui.btnPrev) ui.btnPrev.disabled = book.cursor <= 0;
    if (ui.btnNext) ui.btnNext.disabled = book.cursor >= book.N + 1;
    if (ui.btnPose) ui.btnPose.textContent = view.poseT ? '伏案' : '立册';

    // 同步卷轴内导览选中态
    if (ui.scrollNavPages) {
      ui.scrollNavPages.querySelectorAll('.nav-item').forEach((btn) => {
        const c = parseInt(btn.dataset.cursor, 10);
        btn.classList.toggle('active', c === book.cursor);
      });
    }
  }

  function doFlip(dir) {
    const ok = dir > 0 ? book.next() : book.prev();
    if (ok) { Sfx.page(dir > 0 ? 1.05 : 0.92); lastInteract = performance.now(); }
    syncUI();
    return ok;
  }
  let hintTimer = 0;
  function showHint(text, ms) {
    if (!ui.hint) return;
    ui.hint.textContent = text;
    ui.hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => ui.hint.classList.remove('show'), ms || 2000);
  }

  /* ---------------- 交互 ---------------- */
  function bindEvents() {
    const el = renderer.domElement;
    el.style.cursor = 'grab';
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      lastInteract = performance.now();
      Sfx.boot();
      if (Sfx.ctx && Sfx.ctx.state === 'suspended') Sfx.ctx.resume();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      pointer.down = true;
      pointer.x0 = e.clientX; pointer.y0 = e.clientY;
      pointer.lx = e.clientX; pointer.ly = e.clientY; pointer.lt = performance.now();
      pointer.moved = 0; pointer.vel = 0; pointer.item = null; pointer.hitItem = null;

      const wantPan = e.button === 2 || e.altKey;
      const hit = wantPan ? null : pickAt(e.clientX, e.clientY);
      if (wantPan) {
        pointer.mode = 'pan';
        pointer.pan0 = view.pan.clone();
        pointer.az0 = view.az; pointer.pol0 = view.pol;
      } else if (hit && hit.type === 'item' && hit.edge) {
        pointer.mode = 'flip';
        pointer.item = hit.item;
        pointer.dir = hit.dir;
        pointer.p0 = hit.item.p;
        pointer.gain = pageScreenWidth() * 0.92;
        book.beginDrag(hit.item);
      } else {
        pointer.mode = hit && hit.type === 'block' ? 'blockClick' : (hit && hit.type === 'item' ? 'clickOnly' : 'orbit');
        pointer.dir = hit ? hit.dir : 0;
        pointer.hitItem = hit && hit.item ? hit.item : null;
        pointer.az0 = view.az; pointer.pol0 = view.pol;
        view.vAz = 0; view.vPol = 0;
      }
      el.style.cursor = 'grabbing';
    });

    el.addEventListener('pointermove', (e) => {
      const now = performance.now();
      const dt = Math.max(8, now - pointer.lt) / 1000;
      pointer.lt = now;
      if (pointer.down) {
        const dx = e.clientX - pointer.lx, dy = e.clientY - pointer.ly;
        pointer.lx = e.clientX; pointer.ly = e.clientY;
        pointer.moved += Math.abs(dx) + Math.abs(dy);
        if (pointer.mode === 'flip') {
          pointer.vel = pointer.vel * 0.6 + ((-dx / pointer.gain) / dt) * 0.4;
          book.dragTo(pointer.item, pointer.p0 - (e.clientX - pointer.x0) / pointer.gain, true);
        } else if (pointer.mode === 'pan') {
          // 平移：把拖动换算成世界单位（按当前距离缩放，手感恒定）
          const scale = (fitDistance() * view.zoom) / renderer.domElement.clientHeight * 1.6;
          view.pan.x = pointer.pan0.x - (e.clientX - pointer.x0) * scale;
          view.pan.y = pointer.pan0.y + (e.clientY - pointer.y0) * scale;
          view.vAz = view.vPol = 0;
        } else {
          // 自由旋转：上下左右随便转，松手带惯性
          const k = 0.0078;
          const nAz = pointer.az0 - (e.clientX - pointer.x0) * k;
          const nPol = clamp(pointer.pol0 - (e.clientY - pointer.y0) * k, 0.055, Math.PI - 0.055);
          view.vAz = (nAz - view.az) / dt * 0.45 + view.vAz * 0.55;
          view.vPol = (nPol - view.pol) / dt * 0.45 + view.vPol * 0.55;
          view.az = nAz;
          view.pol = nPol;
        }
        if (pointer.moved > 10 && ui.hint) ui.hint.classList.remove('show');
      } else {
        const hit = pickAt(e.clientX, e.clientY);
        const it = hit && hit.type === 'item' ? hit.item : null;
        if (it !== pointer.hoverItem) {
          setHover(pointer.hoverItem, false);
          setHover(it, true);
          pointer.hoverItem = it;
        }
        el.style.cursor = it ? (hit.edge ? 'ew-resize' : 'pointer') : 'grab';
      }
    });

    const endPointer = () => {
      if (!pointer.down) return;
      pointer.down = false;
      const now = performance.now();
      lastInteract = now;
      if (pointer.mode === 'flip') {
        if (pointer.moved < 9) {
          const it = pointer.item;
          const to = pointer.dir > 0 ? 1 : 0;
          if (!(to > 0.5 && maybeOpenToNewest(it))) {
            it.target = to; it.vel = 0;
            const itemIdx = book.items.indexOf(it);
            book.cursor = clamp(itemIdx + (to ? 1 : 0), 0, book.N + 1);
            Sfx.page(1.1);
          }
        } else {
          book.endDrag(now - pointer.lt > 150 ? 0 : pointer.vel * 1.15);
          Sfx.page(0.95);
        }
        syncUI();
      } else if (pointer.mode === 'blockClick' && pointer.moved < 9) {
        doFlip(pointer.dir);
      } else if (pointer.mode === 'clickOnly' && pointer.moved < 9) {
        if (!(pointer.dir > 0 && maybeOpenToNewest(pointer.hitItem))) doFlip(pointer.dir >= 0 ? 1 : -1);
      }
      pointer.mode = null;
      pointer.item = null;
      pointer.hitItem = null;
      el.style.cursor = 'grab';
    };
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);

    // 滚轮：拉近推远；Shift+滚轮：翻页
    window.addEventListener('wheel', (e) => {
      if (e.target.closest && (e.target.closest('.ui') || e.target.closest('.scroll-overlay'))) return;
      lastInteract = performance.now();
      if (e.shiftKey) {
        wheelAcc += e.deltaY;
        if (Math.abs(wheelAcc) > 42) { doFlip(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
      } else {
        view.zoom = clamp(view.zoom * (1 + Math.sign(e.deltaY) * 0.07), 0.40, 2.8);
      }
      e.preventDefault();
    }, { passive: false });

    // 键盘
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      lastInteract = performance.now();
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'd' || k === 'D') { doFlip(1); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'a' || k === 'A') { doFlip(-1); e.preventDefault(); }
      else if (k === 'Home') { Sfx.riffle(5); book.goTo(0, { riffle: true }); syncUI(); }
      else if (k === 'End') { const p = newestPage(); if (p) riffleTo(cursorForPage(p)); }
      else if (k === 's' || k === 'S') {
        if (ui.scrollOverlay && ui.scrollOverlay.classList.contains('open')) closeScroll();
        else openScroll();
        e.preventDefault();
      }
      else if (k === 'Escape') {
        if (ui.scrollOverlay && ui.scrollOverlay.classList.contains('open')) { closeScroll(); e.preventDefault(); }
      }
      else if (k === 'r' || k === 'R') {
        view.az = 0.36; view.pol = 1.16; view.zoom = 1; view.vAz = view.vPol = 0;
        view.pan.set(0, 0, 0);
        view.poseT = 0; syncUI();
      }
      else if (k === 'f' || k === 'F') { view.poseT = view.poseT ? 0 : 1; syncUI(); }
    });

    // 双指捏合缩放
    let pinch0 = 0;
    const dist2 = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinch0 = dist2(e);
        pointer.pan0 = view.pan.clone();
        pointer.px0 = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pointer.py0 = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const d = dist2(e);
        if (pinch0 && Math.abs(d - pinch0) > 3) {
          view.zoom = clamp(view.zoom * (pinch0 / d), 0.40, 2.8);
          pinch0 = d;
        } else {
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const scale = (fitDistance() * view.zoom) / renderer.domElement.clientHeight * 1.6;
          view.pan.x = pointer.pan0.x - (cx - pointer.px0) * scale;
          view.pan.y = pointer.pan0.y + (cy - pointer.py0) * scale;
        }
        e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /** 点封面（或首次向右翻）→ 哗啦啦扬到最新一首；返回是否已接管本次点击 */
  function maybeOpenToNewest(item) {
    if (!item || item.kind !== 'cover' || autoRiffled) return false;
    const p = newestPage();
    if (!p) return false;
    autoRiffled = true;
    // 先把封面掀开，稍后一串连翻到最新
    item.target = 1; item.vel = 0;
    book.cursor = 1;
    syncUI();
    Sfx.page(1.1);
    const c = cursorForPage(p);
    if (c > 1) setTimeout(() => riffleTo(c), 420);
    return true;
  }

  function setHover(it, on) {
    if (!it || it.kind !== 'sheet') return;
    it.group.children.forEach((m) => {
      if (m.material && m.material.emissive) {
        m.material.emissive.setHex(on ? 0x2e2410 : 0x000000);
        m.material.emissiveIntensity = on ? 0.5 : 0;
      }
    });
  }

  /* ==========================================================================
   *  启动
   * ========================================================================== */
  async function boot() {
    initRenderer();
    initScene();
    progress(0.02, '研墨…');

    // 尝试同步 Cloudflare D1 远程数据库数据（离线自动回退本地）
    if (window.PoemAPI) {
      try {
        await window.PoemAPI.syncRemoteData();
      } catch (_) {}
    }

    const hasFont = await loadBundledFont();
    let sealImg = null;
    try {
      const sealSrc = (typeof window !== 'undefined' && window.SEAL_DATA_URL) || (BOOK_INFO && BOOK_INFO.sealImg) || 'assets/seal.png';
      sealImg = await loadImage(sealSrc);
    } catch (e) { console.warn(e.message + '（改用内置方印）'); }
    progress(0.06, hasFont ? '排字（仲春仿宋）…' : '排字…');

    plan = Typeset.build(BOOK_INFO, POEMS, LAYOUT);
    progress(0.10, '裁纸…');

    const PPM = LAYOUT.ppm * CFG.texScale;
    const PW = Math.round(LAYOUT.w * PPM), PH = Math.round(LAYOUT.h * PPM);
    const paperA = Tex.paperBase(PW, PH, 12345);
    await waitFrame();
    progress(0.22, '调墨…');
    const paperB = Tex.paperBase(PW, PH, 54321);
    await waitFrame();

    const mm = Object.assign({}, LAYOUT, { ppm: PPM });
    const sides = [];
    plan.sheets.forEach((s) => sides.push(s.recto, s.verso));
    for (let i = 0; i < sides.length; i++) {
      sides[i].canvas = Tex.renderPage(paperA, paperB, sides[i], mm, { sealImg });
      progress(0.22 + 0.5 * ((i + 1) / sides.length), '写页 ' + (i + 1) + '/' + sides.length);
      if (i % 2 === 1) await waitFrame();
    }
    progress(0.74, '制封面…');
    const COVER_MM = { ppm: 3.9 * CFG.texScale, w: 209, h: 295, slipW: 44, slipH: 176, slipX: 46, slipY: 34, sealX: 74, sealY: 42 };
    const coverCanvas = Tex.coverArt(
      Math.round(COVER_MM.w * COVER_MM.ppm), Math.round(COVER_MM.h * COVER_MM.ppm),
      20260925, COVER_MM, { slipText: BOOK_INFO.titleSlip, sealImg });
    const innerW = Math.round(768 * CFG.texScale), innerH = Math.round(1152 * CFG.texScale);
    const innerCanvasA = Tex.endpaper(innerW, innerH, 771);
    await waitFrame();
    const innerCanvasB = Tex.endpaper(innerW, innerH, 9137);
    await waitFrame();
    const paperNormalCanvas = Tex.normalFromCanvas(paperA, 0.55);
    progress(0.82, '压布纹…');
    const coverNormalCanvas = Tex.normalFromCanvas(Tex.silk(768, 768, 4242, { wear: false }), 0.65);
    progress(0.86, '装订…');

    book = BookView.create({
      pages: plan.sheets,
      paperCanvas: paperA,
      paperNormalCanvas,
      coverCanvas, innerCanvasA, innerCanvasB, coverNormalCanvas,
      makePageTex: (page) => { const t = Tex.tex(page.canvas); page.canvas = null; return t; },
    });
    floatGroup.add(book.group);

    buildPickList();
    buildUI();
    bindEvents();
    applyCamera(0.016);
    updateLights();

    // 默认直接打开 3D 诗集正文叶（《旧颜》清秋月夜展开面）
    const targetPage = newestPage();
    const initialCursor = targetPage ? cursorForPage(targetPage) : 2;
    book.goTo(initialCursor, { instant: true });
    autoRiffled = true;
    syncUI();

    progress(0.97, '开卷');
    await waitFrame();
    renderer.render(scene, camera);
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 900);
    setTimeout(() => showHint('展卷鉴赏　·　拖动旋转　·　右键平移　·　滚轮缩放　·　F 姿态切换', 4500), 700);

    window.BookApp = {
      book, camera, renderer, scene, view, get plan() { return plan; },
      next: () => doFlip(1), prev: () => doFlip(-1),
      riffleTo, latest: () => { const p = newestPage(); if (p) riffleTo(cursorForPage(p)); },
      goTo: (n, o) => { book.goTo(n, o); syncUI(); },
      toScreen: (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth, y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight };
      },
      state: () => ({ cursor: book.cursor, N: book.N, p: book.items.map((i) => +i.p.toFixed(3)) }),
      /* 取景自检：返回所需距离、当前相机距离、以及最差角点的越界量（调试用） */
      debugFit: () => {
        const pts = bookCorners();
        const f = fitBox(pts);
        const camDist = camera.position.distanceTo(view.target);
        const t = Math.tan((camera.fov * Math.PI) / 180 / 2);
        const sp = Math.sin(view.pol), cp2 = Math.cos(view.pol);
        const dir = new THREE.Vector3(sp * Math.sin(view.az), cp2, sp * Math.cos(view.az));
        const fwd = dir.clone().negate();
        let want = 0, worst = null;
        for (const p of pts) {
          const v = p.clone().sub(f.center);
          const z = v.dot(dir);
          const x = v.dot(new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize());
          const y = v.dot(new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize().cross(fwd).normalize());
          const need = Math.max(z + Math.abs(x) / (t * camera.aspect), z + Math.abs(y) / t);
          if (need > want) { want = need; worst = { x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), need: +need.toFixed(3) }; }
        }
        return { fitD: +f.d.toFixed(4), camDist: +camDist.toFixed(4), zoom: view.zoom,
                 按需距离: +(want * 1.045 + 0.004).toFixed(4), 最差角点: worst,
                 center: f.center.toArray().map((v) => +v.toFixed(3)),
                 target: view.target.toArray().map((v) => +v.toFixed(3)) };
      },
    };

    animate();
  }

  /* ==========================================================================
   *  主循环（含自适应画质）
   * ========================================================================== */
  let last = 0, fpsAcc = 0, fpsN = 0, quality = CFG.maxPixelRatio, qualityCooldown = 0;
  function animate(t) {
    requestAnimationFrame(animate);
    const now = t || performance.now();
    let dt = (now - last) / 1000;
    last = now;
    // 只做上限保护（防止切标签页回来跳变），不再把大 dt 压成 0.016：
    // 那样在低帧率机器上会让"视线追踪/翻页"整体变成慢动作（这是取景对不准的根因）
    if (!(dt > 0)) dt = 0.016;
    else dt = Math.min(dt, 0.25);

    book.update(dt);

    // 立起 / 平放姿态缓动
    if (Math.abs(view.pose - view.poseT) > 1e-4) {
      view.pose += (view.poseT - view.pose) * (1 - Math.exp(-3.4 * dt));
      book.group.rotation.x = view.pose * 1.44;
    }

    // 悬浮：缓慢起伏 + 轻微侧倾 + 极慢自转（空闲越久越明显）
    if (CFG.idleFloat) {
      const idle = (now - lastInteract) / 1000;
      const s = clamp((idle - 2.5) / 6, 0, 1);
      floatGroup.position.y = Math.sin(now * 0.00042) * 0.0055 * s;
      floatGroup.rotation.z = Math.sin(now * 0.00031) * 0.03 * s;
      floatGroup.rotation.x = Math.sin(now * 0.00023 + 1.1) * 0.02 * s;
      if (s > 0.92) view.az += dt * 0.011;
    } else {
      floatGroup.position.y = floatGroup.rotation.z = floatGroup.rotation.x = 0;
    }

    // 浮尘缓慢游动
    if (dust) {
      const pos = dustGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * 0.006 * (0.4 + Math.sin(i * 1.7 + now * 0.0002) * 0.6);
        const x = pos.getX(i) + Math.sin(now * 0.00013 + i) * dt * 0.004;
        if (y > 0.55) y = -0.55;
        pos.setXY(i, x, y);
      }
      pos.needsUpdate = true;
      dust.material.opacity = 0.40 + Math.sin(now * 0.0007) * 0.06;
    }

    applyCamera(dt);
    updateLights();
    renderer.render(scene, camera);

    // 自适应画质
    fpsAcc += dt; fpsN++;
    qualityCooldown -= dt;
    if (fpsAcc >= 1.2) {
      const fps = fpsN / fpsAcc;
      fpsAcc = 0; fpsN = 0;
      if (qualityCooldown <= 0) {
        if (fps < 42 && quality > 0.72) {
          quality = Math.max(0.72, quality - 0.18);
          renderer.setPixelRatio(quality);
          qualityCooldown = 2.5;
        } else if (fps > 57 && quality < CFG.maxPixelRatio - 0.01) {
          quality = Math.min(CFG.maxPixelRatio, quality + 0.12);
          renderer.setPixelRatio(quality);
          qualityCooldown = 4;
        }
      }
    }
  }

  window.addEventListener('load', () => {
    boot().catch((err) => {
      console.error(err);
      if (loaderMsg) loaderMsg.textContent = '出错了：' + err.message;
    });
  });
})();
