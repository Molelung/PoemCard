/* ==========================================================================
 *  lunar.js —— 农历 / 干支 / 节气 / 月令（1900–2100）
 *  算法数据沿用中国传统历法的标准压缩表；落款格式按古籍习惯生成。
 *  仅做「公历 → 农历」单向推算，够落款用。
 * ========================================================================== */
window.Lunar = (function () {
  'use strict';

  const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x04950,
    0x0d4a0, 0x1f8a6, 0x0b550, 0x056a0, 0x1aba4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
    0x14b63,
  ];

  const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const ANIMALS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  const MONTH_ALIASES = ['孟春', '仲春', '季春', '孟夏', '仲夏', '季夏', '孟秋', '仲秋', '季秋', '孟冬', '仲冬', '季冬'];
  const LUNAR_DAYS = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
  ];
  const NUM = { 0: '〇', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九' };
  const SOLAR_TERMS = [
    '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
  ];
  const TERM_MS = [
    0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693,
    263365, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758,
  ];

  /* 公历月份的汉字（区别于农历月名，勿混用） */
  const SOLAR_MONTH_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  /* 四季 */
  const SEASON = ['春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬', '冬', '冬'];

  const leapMonth = (y) => LUNAR_INFO[y - 1900] & 0xf;
  const leapDays = (y) => (leapMonth(y) ? ((LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29) : 0);
  const monthDays = (y, m) => ((LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29);
  function yearDays(y) {
    let t = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) if (LUNAR_INFO[y - 1900] & i) t += 1;
    return t + leapDays(y);
  }
  /** 干支（以农历年为界，与落款习惯一致） */
  function ganZhi(year) {
    const g = ((year - 4) % 10 + 10) % 10;
    const z = ((year - 4) % 12 + 12) % 12;
    return GAN[g] + ZHI[z];
  }
  function termDay(year, n) {
    const d = new Date(31556925974.7 * (year - 1900) + TERM_MS[n] * 60000 + Date.UTC(1900, 0, 6, 2, 5));
    return d.getUTCDate();
  }
  function solarTerm(date) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    if (d === termDay(y, m * 2)) return SOLAR_TERMS[m * 2];
    if (d === termDay(y, m * 2 + 1)) return SOLAR_TERMS[m * 2 + 1];
    return null;
  }

  function numToCn(n) {
    return String(n).split('').map((c) => NUM[c] || c).join('');
  }
  /** 公历日期汉字：二〇二六年九月二十五 */
  function solarChinese(d) {
    const y = numToCn(d.getFullYear());
    const m = SOLAR_MONTH_CN[d.getMonth()];
    return `${y}年${m}月${numToCn(d.getDate())}日`;
  }

  /** 公历 → 农历 */
  function solarToLunar(input) {
    const date = input instanceof Date ? input : new Date(String(input).replace(/-/g, '/'));
    if (isNaN(date.getTime())) return null;
    let offset = Math.floor((date.getTime() - new Date(1900, 0, 31).getTime()) / 86400000);
    if (offset < -50 || offset > 73000) return null;      // 超出表格范围

    let year = 1900, temp = 0;
    for (year = 1900; year < 2100 && offset > 0; year++) {
      temp = yearDays(year);
      offset -= temp;
    }
    if (offset < 0) { offset += temp; year--; }

    const leap = leapMonth(year);
    let isLeap = false, month = 1;
    for (month = 1; month < 13 && offset > 0; month++) {
      if (leap > 0 && month === leap + 1 && !isLeap) {
        isLeap = true; month--; temp = leapDays(year);
      } else {
        temp = monthDays(year, month);
      }
      offset -= temp;
      if (isLeap && month === leap + 1) isLeap = false;
    }
    if (offset < 0) { offset += temp; month--; }
    else if (offset === 0 && leap > 0 && month === leap + 1) {
      if (isLeap) isLeap = false;
      else { isLeap = true; month--; }
    }

    const day = offset + 1;
    const gz = ganZhi(year);
    const mName = (isLeap ? '闰' : '') + LUNAR_MONTHS[month - 1] + '月';
    const dayName = LUNAR_DAYS[day - 1] || day + '日';
    const alias = MONTH_ALIASES[month - 1];
    const phase = day === 15 ? '望日' : (day === 16 ? '既望' : (day === 1 ? '朔日' : ''));

    return {
      lunarYear: year, lunarMonth: month, lunarDay: day, isLeap,
      ganzhi: gz, animal: ANIMALS[((year - 4) % 12 + 12) % 12],
      monthName: mName, dayName, monthAlias: alias, phase,
      term: solarTerm(date),
      solar: { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() },
      cn: {
        year: numToCn(date.getFullYear()),
        month: SOLAR_MONTH_CN[date.getMonth()],
        day: numToCn(date.getDate()),
        season: SEASON[date.getMonth()],
      },
      text: {
        solarFull: solarChinese(date),
        ganzhiSeason: gz + alias,
        ganzhiMonthDay: gz + '年' + mName + dayName,
        ganzhiTerm: gz + '·' + (solarTerm(date) || alias),
        solarSimple: numToCn(date.getFullYear()) + '年' + SEASON[date.getMonth()],
      },
    };
  }

  /* ---------- 落款 ----------
   * style:
   *   'season'  岁次丙午仲秋        （最像手书落款）
   *   'full'    丙午年八月十五
   *   'term'    丙午·秋分
   *   'solar'   二〇二六年秋
   * 返回若干「列」（竖排，一列一行字），落款通常一到两列
   * -------------------------------------------------------------------- */
  /** 落款：返回 { date, place } 两段（各成一列，写法从简） */
  function signature(input, style, place) {
    const l = solarToLunar(input);
    if (!l) return { date: '', place: place || '' };
    let date;
    if (style === 'full') date = l.ganzhi + '年' + l.monthName + l.dayName;
    else if (style === 'term') date = l.ganzhi + (l.term || l.monthAlias);
    else if (style === 'solar') date = l.cn.year + '年' + l.cn.season;
    else date = l.ganzhi + l.monthAlias;                    // 丙午仲秋
    return { date, place: place || '' };
  }

  return { solarToLunar, signature, ganZhi, numToCn, solarChinese,
           GAN, ZHI, ANIMALS, LUNAR_MONTHS, MONTH_ALIASES, LUNAR_DAYS, SOLAR_TERMS };
})();
