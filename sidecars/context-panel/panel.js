/**
 * panel.js — Antigravity 会话统计 v3（侧边面板 + 上下文总览）
 * 总览 UI 设计与布局借鉴参考自 dsh-context 项目。
 *
 * 两种形态共存：
 *   1. 【侧边面板】在官方 right side panel 的「新标签页」界面注入当前会话统计卡片
 *   2. 【总览浮层】点击侧边栏「上下文总览」菜单项，查看所有对话与总用量
 *
 * 交互：
 *   - 环形图 / 堆叠条：鼠标悬停某一段（或图例）→ 该段加粗突出、其余淡化、中心显示该项数值
 *   - 柱状图 / 热力图 / 列表：悬停浮出详情提示
 *   - 活跃度：7 行（周一 ~ 周日）× N 周列，可切换 Token / 轮次 / 会话
 *   - 会话：卡片网格，支持搜索、按工作区筛选、排序；点击跳转（找不到则复制 ID）
 *
 * 当前会话通过 URL `/c/<conversationId>` 识别。数据由 main.mjs 通过占位符注入（注释里勿写占位符本身）。
 */
(() => {
  const VER = '3.0.14';
  const ROOT_ID = '__agy_ctx_root_v3__';
  const ITEM_ID = '__agy_ctx_item_v3__';
  const SIDE_ID = '__agy_ctx_side_v3__';
  const TIP_ID = '__agy_ctx_tip_v3__';
  const STYLE_ID = '__agy_ctx_style_v3__';

  /* ---------- 已注入：只推数据 ---------- */
  if (document.getElementById(ROOT_ID)) {
    ensureStyles();
    if (window.__agyCtxVer === VER && window.__agyCtxUpdate) {
      try { window.__agyCtxUpdate(__PAYLOAD__); } catch (e) { /* ignore */ }
      return 'already-injected';
    }
    // 版本不同：卸载旧实例后重新注入
    if (typeof window.__agyCtxDispose === 'function') {
      try { window.__agyCtxDispose(); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- 兼容 v2：移除旧样式并隐藏旧元素（旧定时器无法回收，重载窗口后彻底消失） ---------- */
  const legacyStyle = document.getElementById('__agy_ctx_style__');
  if (legacyStyle) legacyStyle.remove();

  let DATA = __PAYLOAD__;
  let RANGE = 'all';
  let EXEC_FILTER = 'all';
  let HEAT_METRIC = 'tokens';
  let SQ = '';
  let SWS = '';
  let SSORT = 'recent';
  let SSCOPE = 'main';
  const EXPANDED = {};
  const EXEC_EXPANDED = {};
  const cleanups = [];
  // 左侧 sidebox 默认折叠；用户手动展开/收起后记住，且不被 5 秒重绘重置
  const SIDE_COLLAPSE_KEY = 'agy-context:side-collapsed';
  let sideCollapsed = true;

  /* ==========================================================================
     工具函数与跨端口持久化
     ========================================================================== */
  const readSetting = (k, def) => {
    try {
      if (window.__agySettings && window.__agySettings[k] != null) {
        const val = String(window.__agySettings[k]);
        try { localStorage.setItem(k, val); } catch (e) {}
        return val;
      }
    } catch (e) {}
    try { const v = localStorage.getItem(k); if (v !== null) return v; } catch (e) {}
    try {
      const m = document.cookie.match(new RegExp('(?:^|; )' + k.replace(/[-:]/g, '_') + '=([^;]*)'));
      if (m) {
        const val = decodeURIComponent(m[1]);
        try { localStorage.setItem(k, val); } catch (e) {}
        return val;
      }
    } catch (e) {}
    return def;
  };

  const writeSetting = (k, v) => {
    try { localStorage.setItem(k, v); } catch (e) {}
    try {
      document.cookie = k.replace(/[-:]/g, '_') + '=' + encodeURIComponent(v) + '; path=/; max-age=31536000; SameSite=Lax';
    } catch (e) {}
    try {
      window.__agySettings = window.__agySettings || {};
      window.__agySettings[k] = v;
      window.__actxPendingSettings = window.__actxPendingSettings || {};
      window.__actxPendingSettings[k] = v;
    } catch (e) {}
  };

  try {
    const v = readSetting(SIDE_COLLAPSE_KEY, null);
    if (v !== null) sideCollapsed = v === '1';
  } catch (e) { /* ignore */ }

  /* ==========================================================================
     工具函数
     ========================================================================== */
  const DAY = 86400000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fn = (n) => {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  };
  const usd = (v) => {
    v = Number(v) || 0;
    if (v === 0) return '$0';
    return v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2);
  };
  const dur = (sec) => {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + 'h' + String(m).padStart(2, '0') + 'm';
    if (m > 0) return m + 'm' + String(s).padStart(2, '0') + 's';
    return s + 's';
  };
  const pctStr = (v, tot) => (tot > 0 ? (v / tot * 100) : 0).toFixed(1);
  const sumVals = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const sortEntries = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);

  const dkey = (t) => new Date(t).toISOString().slice(0, 10);
  const parseDay = (k) => Date.parse(k + 'T00:00:00Z');
  const parseTs = (s) => {
    if (!s) return NaN;
    if (typeof s === 'number') return s;
    return Date.parse(String(s).replace(' ', 'T'));
  };
  const WD = ['一', '二', '三', '四', '五', '六', '日'];
  const wdIdx = (t) => (new Date(t).getUTCDay() + 6) % 7;

  function relTime(s) {
    const t = parseTs(s);
    if (!Number.isFinite(t)) return '';
    const d = Date.now() - t;
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < DAY) return Math.floor(d / 3600e3) + ' 小时前';
    if (d < 30 * DAY) return Math.floor(d / DAY) + ' 天前';
    return dkey(t);
  }

  const PALETTE = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#f97316', '#64748b', '#14b8a6', '#a855f7'];
  const col = (i) => PALETTE[i % PALETTE.length];

  const CTX_COLORS = {
    '系统提示词': '#6366f1', '工具定义': '#f59e0b', '用户消息': '#10b981', '注入内容': '#d946ef',
    '技能注入': '#f97316', '助手消息': '#3b82f6', '模型思考': '#ec4899', '工具结果': '#06b6d4',
  };
  const CTX_ORDER = ['系统提示词', '工具定义', '用户消息', '注入内容', '技能注入', '助手消息', '模型思考', '工具结果'];

  const TIME_SEGS = [
    { key: 'toolExec', name: '工具执行', color: '#3b82f6' },
    { key: 'modelReply', name: '模型回复', color: '#8b5cf6' },
    { key: 'modelThink', name: '模型思考', color: '#ec4899' },
    { key: 'userWait', name: '等待输入', color: '#f59e0b' },
    { key: 'systemOverhead', name: '系统开销', color: '#94a3b8' },
  ];

  const IC = {
    chart: '<path d="M4 20V10M10 20V5M16 20v-6M22 20H2"/>',
    pie: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
    code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
    term: '<path d="M4 6l6 6-6 6M12 19h8"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1L20 20M8.1 15.9L20 4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };
  const icon = (k) => '<svg class="agy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (IC[k] || '') + '</svg>';

  const LOGO_DATA = '__LOGO__';
  const LOGO_SRC = LOGO_DATA.startsWith('data:image') ? LOGO_DATA : '';
  const logoMiHtml = () => LOGO_SRC
    ? '<img class="agy-mi-logo" src="' + LOGO_SRC + '" alt="logo" />'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + IC.chart + '</svg>';
  const logoHdHtml = () => LOGO_SRC
    ? '<img class="agy-hd-logo-img" src="' + LOGO_SRC + '" alt="logo" />'
    : icon('chart');

  const PREF_KEY = 'agy-context:prefs';
  const DEFAULT_PREFS = { winSize: 1000000, autoRefresh: true, compact: false };
  let PREFS = Object.assign({}, DEFAULT_PREFS);
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    PREFS = Object.assign(PREFS, saved);
  } catch (e) { /* ignore */ }

  /* ==========================================================================
     样式
     ========================================================================== */
  function ensureStyles() {
    let st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      document.head.appendChild(st);
    }
    st.textContent = STYLES_TEXT;
  }
  const STYLES_TEXT = `
/* 旧版本元素隐藏 */
#__agy_context_root__,#__agy_ctx_menu_item__,#__agy_ctx_side__{display:none!important}

.agy-scope{--c-page:#f3f4f7;--c-card:#fff;--c-fg:#15171c;--c-fg2:#3d4657;--c-mut:#6b7280;--c-dim:#9aa1ad;
  --c-line:#e8eaef;--c-soft:#f5f6f9;--c-hover:#f0f3f9;--c-accent:#3b82f6;--c-ok:#10b981;--c-warn:#f59e0b;--c-bad:#ef4444;
  --c-track:#eef1f6;--c-heat0:#ebedf1;
  font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--c-fg)}
.agy-scope *{box-sizing:border-box}
.agy-mono{font-family:ui-monospace,"Cascadia Code",Consolas,monospace}
.agy-ic{width:15px;height:15px;flex:0 0 15px;display:block}

/* ---------- 浮层 ---------- */
#${ROOT_ID}{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
.agy-mask{position:absolute;inset:0;pointer-events:auto;display:none;background:rgba(20,22,28,.34);
  backdrop-filter:blur(3px);align-items:center;justify-content:center;padding:18px}
.agy-mask.on{display:flex;animation:agyF .14s ease}
@keyframes agyF{from{opacity:0}to{opacity:1}}
.agy-box{width:1360px;max-width:94vw;height:90vh;display:flex;flex-direction:column;background:var(--c-page);
  border-radius:16px;border:1px solid var(--c-line);box-shadow:0 30px 80px rgba(16,18,24,.28),0 2px 8px rgba(16,18,24,.06);
  animation:agyP .2s cubic-bezier(.2,.9,.3,1.1);overflow:hidden}
@keyframes agyP{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
.agy-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:var(--c-card);
  border-bottom:1px solid var(--c-line);flex:0 0 auto;gap:12px}
.agy-hd-l{display:flex;align-items:center;gap:10px;min-width:0}
.agy-hd-logo{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;overflow:hidden;flex:0 0 28px}
.agy-hd-logo img, .agy-hd-logo-img{width:28px;height:28px;border-radius:8px;object-fit:cover;display:block}
.agy-hd-t{font-size:15px;font-weight:680;letter-spacing:-.1px;display:flex;align-items:center;gap:7px}
.agy-hd-ver{font-size:10px;font-weight:600;color:var(--c-dim);background:var(--c-soft);
  border:1px solid var(--c-line);border-radius:5px;padding:1px 6px;letter-spacing:0;font-variant-numeric:tabular-nums}
.agy-gear{border:1px solid var(--c-line);background:var(--c-card);cursor:pointer;color:var(--c-mut);
  width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all .13s}
.agy-gear:hover{color:var(--c-fg);border-color:#c8d2e4;background:var(--c-soft)}
.agy-gear.on{color:var(--c-fg);border-color:#b9cdf5;background:var(--c-soft)}
.agy-gear svg{width:15px;height:15px}

/* 设置面板 */
.agy-hd-r{position:relative}
.agy-settings{position:absolute;top:38px;right:0;width:250px;background:var(--c-card);
  border:1px solid var(--c-line);border-radius:11px;box-shadow:0 14px 38px rgba(16,18,24,.16),0 2px 8px rgba(16,18,24,.06);
  padding:12px 13px;display:none;z-index:50}
.agy-settings.on{display:block;animation:agyF .12s ease}
.agy-set-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.agy-set-t{font-size:12px;font-weight:660}
.agy-set-x{border:none;background:transparent;cursor:pointer;color:var(--c-mut);font-size:17px;
  width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center}
.agy-set-x:hover{background:var(--c-soft);color:var(--c-fg)}
.agy-set-r{display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:11.5px}
.agy-set-l{color:var(--c-fg2)}
.agy-set-sel{border:1px solid var(--c-line);background:var(--c-card);border-radius:6px;
  padding:3px 7px;font:inherit;font-size:11px;color:var(--c-fg);outline:none;cursor:pointer}
.agy-set-sel:focus{border-color:#b9cdf5}
.agy-set-sw{position:relative;display:inline-flex;cursor:pointer}
.agy-set-sw input{position:absolute;opacity:0;width:0;height:0}
.agy-set-sw span{width:32px;height:18px;border-radius:9px;background:#d7dce6;transition:background .16s;position:relative;display:block}
.agy-set-sw span::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;
  border-radius:50%;background:#fff;transition:transform .16s;box-shadow:0 1px 3px rgba(16,18,24,.2)}
.agy-set-sw input:checked + span{background:var(--c-accent)}
.agy-set-sw input:checked + span::after{transform:translateX(14px)}
.agy-set-ft{margin-top:10px;padding-top:9px;border-top:1px solid var(--c-line);
  font-size:10.5px;color:var(--c-mut);line-height:1.65}

/* 紧凑模式 */
.agy-compact .agy-body{padding:10px 12px 14px;gap:8px}
.agy-box.agy-compact .agy-card{padding:9px 10px}
.agy-compact .agy-card-t{font-size:11px}
.agy-hd-s{font-size:11px;color:var(--c-dim);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agy-hd-r{display:flex;align-items:center;gap:8px}
.agy-seg{display:flex;gap:2px;background:var(--c-soft);padding:3px;border-radius:8px;border:1px solid var(--c-line)}
.agy-seg button{border:none;background:transparent;font:inherit;font-size:12px;padding:4px 11px;border-radius:6px;
  cursor:pointer;color:var(--c-mut);transition:all .13s;white-space:nowrap}
.agy-seg button:hover{color:var(--c-fg)}
.agy-seg button.on{background:var(--c-fg);color:var(--c-card);font-weight:600}
.agy-seg.sm{padding:2px;border-radius:7px}
.agy-seg.sm button{font-size:11px;padding:3px 8px;border-radius:5px}
.agy-x{border:none;background:transparent;cursor:pointer;color:var(--c-mut);font-size:20px;width:30px;height:30px;
  border-radius:8px;display:flex;align-items:center;justify-content:center}
.agy-x:hover{background:var(--c-soft);color:var(--c-fg)}

.agy-body{flex:1;overflow-y:auto;padding:14px 16px 20px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;align-content:start;scrollbar-width:none;-ms-overflow-style:none}
.agy-body::-webkit-scrollbar{display:none;width:0;height:0}
.agy-scroll::-webkit-scrollbar{width:8px;height:8px}
.agy-scroll::-webkit-scrollbar-thumb{background:#d6dae2;border-radius:4px}
.agy-box .s3{grid-column:span 3}.agy-box .s4{grid-column:span 4}.agy-box .s5{grid-column:span 5}.agy-box .s6{grid-column:span 6}
.agy-box .s7{grid-column:span 7}.agy-box .s8{grid-column:span 8}.agy-box .s12{grid-column:1/-1}
@media (max-width:1180px){.agy-box .s3{grid-column:span 6}.agy-box .s4,.agy-box .s5,.agy-box .s7,.agy-box .s8{grid-column:span 6}}
@media (max-width:820px){.agy-box .s3,.agy-box .s4,.agy-box .s5,.agy-box .s6,.agy-box .s7,.agy-box .s8{grid-column:1/-1}}
.agy-sec{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:11px;font-weight:650;color:var(--c-dim);
  letter-spacing:.6px;margin:6px 2px -2px}
.agy-sec::after{content:"";flex:1;height:1px;background:var(--c-line)}

.agy-box .agy-card{background:var(--c-card);border:1px solid var(--c-line);border-radius:12px;padding:13px 15px;
  display:flex;flex-direction:column;min-width:0;transition:box-shadow .18s}
.agy-box .agy-card:hover{box-shadow:0 4px 18px rgba(16,18,24,.05)}
.agy-ch{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;min-height:22px}
.agy-ct{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:660;white-space:nowrap}
.agy-ct .agy-ic{color:var(--c-mut)}
.agy-cx{font-size:11.5px;color:var(--c-mut);white-space:nowrap;display:flex;align-items:center;gap:8px}
.agy-cx b{color:var(--c-fg);font-weight:600}
.agy-empty{color:var(--c-dim);font-size:12px;padding:18px 0;text-align:center}
.agy-ft{margin-top:10px;padding-top:8px;border-top:1px dashed var(--c-line);font-size:10.5px;color:var(--c-dim)}

/* KPI */
.agy-kgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.agy-k{background:var(--c-card);border:1px solid var(--c-line);border-radius:12px;padding:12px 10px;text-align:center;
  display:flex;flex-direction:column;justify-content:center;gap:3px;cursor:default;transition:transform .16s,box-shadow .16s,border-color .16s}
.agy-k:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(16,18,24,.08);border-color:#d5dbe6}
.agy-k-l{font-size:11.5px;color:var(--c-mut)}
.agy-k-v{font-size:24px;font-weight:720;letter-spacing:-.6px;line-height:1.15;font-variant-numeric:tabular-nums}
.agy-k-v.acc{background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.agy-k-d{font-size:10.5px;color:var(--c-dim)}

/* 每日柱状图 */
.agy-dch{display:flex;gap:6px;height:170px}
.agy-dax{display:flex;flex-direction:column;justify-content:space-between;font-size:9.5px;color:var(--c-dim);
  padding-bottom:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.agy-dax.r{text-align:left}.agy-dax.l{text-align:right}
.agy-dplot{flex:1;position:relative;display:flex;align-items:stretch;gap:2px;min-width:0}
.agy-dgrid{position:absolute;left:0;right:0;top:0;bottom:18px;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none}
.agy-dgrid i{display:block;border-top:1px dashed var(--c-line)}
.agy-dc{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;border-radius:6px;cursor:default;position:relative;z-index:1;transition:background .12s}
.agy-dc:hover{background:rgba(59,130,246,.07)}
.agy-dbars{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:2px;padding:0 2px}
.agy-dbars i{display:block;width:42%;max-width:14px;border-radius:3px 3px 0 0;position:relative;transition:height .5s cubic-bezier(.2,.8,.3,1),filter .12s}
.agy-dbars i.t{background:linear-gradient(180deg,#60a5fa,#3b82f6)}
.agy-dbars i.c{background:linear-gradient(180deg,#34d399,#10b981)}
.agy-dc:hover .agy-dbars i{filter:brightness(1.08) saturate(1.15)}
.agy-dbars em{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);font-style:normal;font-size:9px;
  color:var(--c-mut);white-space:nowrap;margin-bottom:2px}
.agy-dx{height:18px;line-height:18px;font-size:9.5px;color:var(--c-dim);white-space:nowrap}
.agy-dc.today .agy-dx{color:var(--c-accent);font-weight:650}
.agy-lg{display:flex;gap:12px;justify-content:flex-end;font-size:10.5px;color:var(--c-mut);margin-top:4px}
.agy-lg span{display:inline-flex;align-items:center;gap:4px}
.agy-lg i{width:8px;height:8px;border-radius:2px;display:inline-block}

/* 环形图 + 图例（可交互） */
.agy-dnw{display:flex;align-items:center;gap:18px}
.agy-dn{position:relative;flex:0 0 auto}
.agy-dn svg{transform:rotate(-90deg);overflow:visible;display:block}
.agy-arc{stroke-width:var(--sw);transition:stroke-width .2s cubic-bezier(.2,.8,.3,1),opacity .2s;cursor:pointer}
.agy-dng.hot .agy-arc:not(.on){opacity:.18}
.agy-arc.on{stroke-width:calc(var(--sw) + 6px)}
.agy-dn-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  pointer-events:none;text-align:center;padding:0 14%}
.agy-dn-v{font-size:16px;font-weight:720;letter-spacing:-.4px;line-height:1.1;transition:color .15s}
.agy-dn-l{font-size:10px;color:var(--c-mut);display:block;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-dn-p{font-size:9.5px;font-weight:650;color:var(--c-dim);display:none}
.agy-dng.hot .agy-dn-p{display:block}
.agy-leggrid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:4px 14px;min-width:0}
.agy-leg{display:flex;align-items:flex-start;gap:7px;padding:5px 7px;border-radius:7px;cursor:pointer;transition:background .12s,opacity .18s;min-width:0}
.agy-leg:hover,.agy-leg.on{background:var(--c-hover)}
.agy-dng.hot .agy-leg:not(.on){opacity:.42}
.agy-leg-d{width:9px;height:9px;border-radius:3px;flex:0 0 9px;margin-top:3px}
.agy-leg-m{flex:1;min-width:0}
.agy-leg-r{display:flex;align-items:baseline;gap:6px}
.agy-leg-n{flex:1;font-size:12px;font-weight:600;color:var(--c-fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-leg-p{font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
.agy-leg-v{font-size:10.5px;color:var(--c-dim);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 堆叠条（可交互） */
.agy-stk{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--c-track);gap:1px}
.agy-stk i{display:block;height:100%;cursor:pointer;transition:opacity .18s,filter .18s}
.agy-dng.hot .agy-stk i:not(.on){opacity:.22}
.agy-stk i.on{filter:saturate(1.3)}

/* 热力图（7 行 × N 周） */
.agy-heat{display:grid;gap:3px;align-items:center}
.agy-hm{font-size:9.5px;color:var(--c-dim);white-space:nowrap;height:13px;line-height:13px}
.agy-hw{font-size:9.5px;color:var(--c-dim);text-align:right;padding-right:4px}
.agy-hc{aspect-ratio:1;border-radius:3px;background:var(--c-heat0);transition:transform .12s,box-shadow .12s;cursor:default}
.agy-hc:hover{transform:scale(1.35);box-shadow:0 0 0 1.5px var(--c-card),0 2px 8px rgba(16,18,24,.25);z-index:2;position:relative}
.agy-hc.fut{background:transparent;border:1px dashed var(--c-line)}
.agy-hc.today{outline:1.5px solid var(--c-accent);outline-offset:1px}
.agy-hlg{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;font-size:10.5px;color:var(--c-dim)}
.agy-hlg-s{display:flex;align-items:center;gap:3px}
.agy-hlg-s i{width:10px;height:10px;border-radius:2px;display:inline-block}

/* 排行列表（技能/工具/命令） */
.agy-rk{display:flex;flex-direction:column;gap:2px;max-height:228px;overflow-y:auto;margin-right:-6px;padding-right:6px}
.agy-rk-r{position:relative;display:flex;align-items:center;gap:8px;padding:6px 8px 8px;border-radius:7px;font-size:11.5px;
  cursor:default;transition:background .12s}
.agy-rk-r:hover{background:var(--c-hover)}
.agy-rk-d{width:7px;height:7px;border-radius:50%;flex:0 0 7px}
.agy-rk-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c-fg2)}
.agy-rk-v{color:var(--c-mut);font-variant-numeric:tabular-nums;font-size:11px}
.agy-rk-b{position:absolute;left:8px;right:8px;bottom:3px;height:2px;border-radius:1px;background:transparent}
.agy-rk-b i{display:block;height:100%;border-radius:1px;opacity:.55;transition:width .5s cubic-bezier(.2,.8,.3,1),opacity .12s}
.agy-rk-r:hover .agy-rk-b i{opacity:1}

/* 小柱（活跃时段） */
.agy-hr{display:flex;align-items:flex-end;gap:2px;height:110px}
.agy-hr-c{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;border-radius:4px;cursor:default}
.agy-hr-c:hover{background:rgba(139,92,246,.08)}
.agy-hr-c i{display:block;width:70%;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#a78bfa,#8b5cf6);min-height:2px}
.agy-hr-c.pk i{background:linear-gradient(180deg,#f472b6,#ec4899)}
.agy-hr-x{display:flex;justify-content:space-between;font-size:9.5px;color:var(--c-dim);margin-top:4px}

/* 会话卡片 */
.agy-stool{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.agy-search{flex:1;min-width:200px;display:flex;align-items:center;gap:6px;border:1px solid var(--c-line);border-radius:8px;
  padding:0 10px;height:32px;background:var(--c-soft);color:var(--c-dim);transition:border-color .12s,background .12s}
.agy-search:focus-within{border-color:#93b4f6;background:var(--c-card)}
.agy-search input{flex:1;border:none;outline:none;background:transparent;font:inherit;font-size:12.5px;color:var(--c-fg)}
.agy-sel{height:32px;border:1px solid var(--c-line);border-radius:8px;background:var(--c-card);color:var(--c-fg);font:inherit;font-size:12px;padding:0 8px;outline:none;cursor:pointer}
.agy-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 12px}
.agy-chip{border:1px solid var(--c-line);background:var(--c-card);border-radius:999px;padding:3px 11px;font:inherit;font-size:11.5px;
  color:var(--c-fg2);cursor:pointer;transition:all .12s;display:inline-flex;align-items:center;gap:5px}
.agy-chip:hover{border-color:#c3cfdf}
.agy-chip em{font-style:normal;color:var(--c-dim);font-size:10.5px}
.agy-chip.on{background:var(--c-fg);border-color:var(--c-fg);color:var(--c-card)}
.agy-chip.on em{color:inherit;opacity:.7}
.agy-sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.agy-sc{position:relative;border:1px solid var(--c-line);border-radius:11px;padding:12px 13px 10px;background:var(--c-card);
  cursor:pointer;display:flex;flex-direction:column;gap:9px;transition:transform .16s,box-shadow .16s,border-color .16s;min-width:0}
.agy-sc:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(16,18,24,.09);border-color:#c9d5ea}
.agy-sc.cur{border-color:#93b4f6;box-shadow:0 0 0 3px rgba(59,130,246,.10)}
.agy-sc.flash{border-color:var(--c-ok)!important}
.agy-sc-h{display:flex;align-items:flex-start;gap:8px}
.agy-sc-t{flex:1;min-width:0;font-size:13px;font-weight:650;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.agy-sc-t .live{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c-ok);margin-right:6px;vertical-align:1px;
  box-shadow:0 0 0 3px rgba(16,185,129,.18)}
.agy-sc-w{flex:0 0 auto;text-align:right;font-size:10.5px;color:var(--c-dim);line-height:1.45;white-space:nowrap}
.agy-sc-w b{display:block;color:var(--c-mut);font-weight:500;font-size:11px}
.agy-tags{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.agy-tag{font-size:10px;padding:1px 7px;border-radius:5px;background:var(--c-soft);color:var(--c-mut);border:1px solid var(--c-line);white-space:nowrap}
.agy-tag.blue{background:rgba(59,130,246,.09);color:#2563eb;border-color:transparent}
.agy-tag.vio{background:rgba(139,92,246,.10);color:#7c3aed;border-color:transparent}
.agy-sc-m{display:flex;align-items:center;gap:14px}
.agy-sc-m .agy-dn-v{font-size:12px}
.agy-sc-m .agy-dn-l{font-size:9px}
.agy-sc-kv{flex:1;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11.5px;min-width:0}
.agy-sc-kv span{color:var(--c-mut)}
.agy-sc-kv b{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.agy-sc-f{font-size:10.5px;color:var(--c-dim);border-top:1px solid var(--c-line);padding-top:7px;display:flex;gap:6px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agy-sc-f .k{color:var(--c-mut)}
.agy-sc-kids{display:flex;flex-direction:column;gap:2px;border-top:1px dashed var(--c-line);padding-top:6px}
.agy-sc-kid{display:flex;gap:6px;font-size:10.5px;color:var(--c-mut);padding:2px 4px;border-radius:5px}
.agy-sc-kid:hover{background:var(--c-hover)}
.agy-sc-kid span:first-child{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-more{margin-top:12px;align-self:center;border:1px solid var(--c-line);background:var(--c-card);border-radius:8px;padding:5px 16px;
  font:inherit;font-size:12px;color:var(--c-mut);cursor:pointer}
.agy-more:hover{color:var(--c-fg);border-color:#c3cfdf}

/* 上下文大数字 */
.agy-big{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:9px}
.agy-big-v{font-size:22px;font-weight:720;letter-spacing:-.5px}
.agy-big-u{font-size:11.5px;color:var(--c-mut);margin-left:4px}
.agy-big-p{font-size:13px;font-weight:680}

/* 上下文事件 / 文件活动 */
.agy-ev-tags{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px}
.agy-ev-tag{font-size:10.5px;padding:2px 8px;border-radius:5px;font-weight:550}
.agy-list{display:flex;flex-direction:column;gap:1px;max-height:250px;overflow-y:auto}
.agy-ev-row{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:5px;font-size:11px}
.agy-ev-row:hover{background:var(--c-hover)}
.agy-ev-nm{flex:0 0 64px;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-ev-d{flex:1;color:var(--c-mut);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-ev-w{flex:0 0 auto;color:var(--c-dim);font-size:10.5px;font-variant-numeric:tabular-nums}
.agy-fa-b{font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;white-space:nowrap}
.agy-fa-b.w{background:rgba(16,185,129,.12);color:#0d8f63}
.agy-fa-b.e{background:rgba(245,158,11,.14);color:#b45309}
.agy-fa-b.r{background:rgba(59,130,246,.10);color:#2563eb}
.agy-fa-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;font-size:11.5px;transition:background .1s}
.agy-fa-row:hover{background:var(--c-hover)}
.agy-fa-lang{flex:0 0 32px;height:19px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:9.5px;font-weight:700}
.agy-fa-path{flex:1;display:flex;align-items:baseline;gap:6px;min-width:0}
.agy-fa-dir{color:var(--c-dim);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%}
.agy-fa-nm{color:var(--c-fg2);font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-fa-bs{display:flex;gap:3px;flex:0 0 auto}
.agy-fa-ch{flex:0 0 44px;text-align:right;color:var(--c-dim);font-size:10.5px;font-variant-numeric:tabular-nums}

/* 命令执行 */
.agy-csum{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px}
.agy-csum div{background:var(--c-soft);border-radius:9px;padding:9px 12px}
.agy-csum b{display:block;font-size:19px;font-weight:720;letter-spacing:-.4px}
.agy-csum span{font-size:10.5px;color:var(--c-mut)}
.agy-csum b.bad{color:var(--c-bad)}.agy-csum b.ok{color:var(--c-ok)}
.agy-cn{background:linear-gradient(90deg,rgba(245,158,11,.08),transparent);border-left:2px solid var(--c-warn);border-radius:6px;padding:8px 11px;margin-bottom:10px}
.agy-cn-r{display:flex;align-items:center;gap:10px;font-size:11.5px;padding:2px 0}
.agy-cn-k{flex:0 0 60px;color:var(--c-mut)}.agy-cn-k.bad{color:var(--c-bad)}
.agy-cn-v{flex:1;color:var(--c-fg2);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-cn-n{font-weight:650;font-variant-numeric:tabular-nums}.agy-cn-n.bad{color:var(--c-bad)}
.agy-cmd-list{display:flex;flex-direction:column;gap:1px;max-height:420px;overflow-y:auto}
.agy-cmd-row{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:6px;font-size:11.5px;cursor:pointer;transition:background .1s}
.agy-cmd-row:hover,.agy-cmd-row.open{background:var(--c-hover)}
.agy-cmd-ico{flex:0 0 14px;text-align:center;font-size:10px;font-weight:700}
.agy-cmd-row.ok .agy-cmd-ico{color:var(--c-ok)}.agy-cmd-row.fail .agy-cmd-ico{color:var(--c-bad)}.agy-cmd-row.run .agy-cmd-ico{color:var(--c-warn)}
.agy-cmd-prog{flex:0 0 96px;color:var(--c-fg2);font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agy-cmd-txt{flex:1;color:var(--c-mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}
.agy-cmd-meta{flex:0 0 auto;color:var(--c-dim);font-size:10.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.agy-cmd-tag{flex:0 0 auto;font-size:9.5px;padding:0 5px;border-radius:3px;background:#e8f5ef;color:#0d8f63}
.agy-cmd-detail{margin:2px 0 8px 22px;border:1px solid var(--c-line);border-radius:8px;overflow:hidden}
.agy-cmd-dh{display:flex;justify-content:space-between;padding:5px 10px;font-size:10.5px;font-weight:640;color:var(--c-mut);background:var(--c-soft);border-bottom:1px solid var(--c-line)}
.agy-cmd-pre{margin:0;padding:8px 10px;font-size:10.5px;line-height:1.55;color:var(--c-fg2);white-space:pre-wrap;word-break:break-all;max-height:170px;overflow-y:auto}
.agy-err{grid-column:1/-1;color:var(--c-bad);font-size:12.5px;padding:20px}

/* 菜单项 */
#${ITEM_ID}{display:flex}
#${ITEM_ID} .agy-mi{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 16px;opacity:.75}
#${ITEM_ID} .agy-mi svg{width:15px;height:15px;display:block}
#${ITEM_ID} .agy-mi img, #${ITEM_ID} .agy-mi-logo{width:16px;height:16px;border-radius:3px;object-fit:cover;display:block}

/* 浮动提示 */
#${TIP_ID}{position:fixed;z-index:2147483600;pointer-events:none;background:rgba(17,19,24,.94);color:#f3f4f6;border-radius:8px;
  padding:7px 10px;font:11.5px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  box-shadow:0 8px 24px rgba(0,0,0,.22);opacity:0;transform:translateY(4px);transition:opacity .1s,transform .1s;max-width:340px;white-space:pre-line;word-break:break-all}
#${TIP_ID}.on{opacity:1;transform:none}
#${TIP_ID} b{display:block;font-weight:650;color:#fff;margin-bottom:2px}
#${TIP_ID} .d{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:0}

/* ---------- 侧边面板 ---------- */
#${SIDE_ID}{width:100%!important;max-width:36rem!important;box-sizing:border-box!important;min-width:0!important;align-self:stretch!important;margin:0 auto 14px!important;container-type:inline-size}
#${SIDE_ID} .agy-sd{width:100%!important;max-width:100%!important;box-sizing:border-box!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:9px!important}
/* 折叠标题栏：默认只显示这一行，点击展开/收起完整内容 */
#${SIDE_ID} .agy-sd-bar{display:flex!important;align-items:center!important;gap:7px!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;min-width:0!important;background:var(--c-card)!important;border:1px solid var(--c-line)!important;border-radius:9px!important;padding:8px 10px!important;font:inherit!important;font-size:11.5px!important;font-weight:650!important;color:var(--c-fg)!important;text-align:left!important;cursor:pointer!important;transition:border-color .12s,background .12s!important}
#${SIDE_ID} .agy-sd-bar:hover{border-color:#93b4f6!important;color:var(--c-accent)!important}
#${SIDE_ID} .agy-sd-caret{flex:0 0 auto!important;font-size:10px!important;color:var(--c-mut)!important;transition:transform .15s!important;display:inline-block!important}
#${SIDE_ID} .agy-sd-bar.open .agy-sd-caret{transform:rotate(90deg)!important}
#${SIDE_ID} .agy-sd-bar-t{flex:1 1 auto!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
#${SIDE_ID} .agy-sd-body{width:100%!important;max-width:100%!important;box-sizing:border-box!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:9px!important;max-height:calc(100vh - 120px)!important;overflow-y:auto!important;overflow-x:hidden!important;padding-right:2px!important}
#${SIDE_ID} .agy-sd-body.collapsed{display:none!important}
#${SIDE_ID} .agy-sd-content{width:100%!important;max-width:100%!important;box-sizing:border-box!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:9px!important}

#${SIDE_ID} .agy-sd-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;width:100%!important;box-sizing:border-box!important;min-width:0!important;padding:0 0 8px!important;border-bottom:1px solid var(--c-line)!important}
#${SIDE_ID} .agy-sd-head-m{flex:1 1 auto!important;min-width:0!important;overflow:hidden!important}
#${SIDE_ID} .agy-sd-ht{font-size:12.5px!important;font-weight:650!important;line-height:1.35!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#${SIDE_ID} .agy-sd-hm{font-size:10px!important;color:var(--c-dim)!important;margin-top:3px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#${SIDE_ID} .agy-sd-btn{flex:0 0 auto!important;border:1px solid var(--c-line)!important;background:var(--c-card)!important;border-radius:7px!important;padding:3px 9px!important;font:inherit!important;font-size:10.5px!important;color:var(--c-mut)!important;cursor:pointer!important;transition:all .12s!important;display:inline-flex!important;align-items:center!important;gap:4px!important;white-space:nowrap!important}
#${SIDE_ID} .agy-sd-btn:hover{border-color:#93b4f6!important;color:var(--c-accent)!important}
#${SIDE_ID} .agy-sd-btn .agy-ic{width:12px!important;height:12px!important;flex-basis:12px!important}

/* 动态自适应 KPI 网格：随着宽度大小动态自适应变化 */
#${SIDE_ID} .agy-sd-kpis{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(125px,1fr))!important;gap:7px!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;min-width:0!important}
@container (min-width: 480px){
  #${SIDE_ID} .agy-sd-kpis{grid-template-columns:repeat(4,1fr)!important}
}
@container (max-width: 479px) and (min-width: 250px){
  #${SIDE_ID} .agy-sd-kpis{grid-template-columns:repeat(2,1fr)!important}
}
@container (max-width: 249px){
  #${SIDE_ID} .agy-sd-kpis{grid-template-columns:1fr!important}
}

#${SIDE_ID} .agy-sd-k{background:var(--c-soft)!important;border:1px solid transparent!important;border-radius:9px!important;padding:8px 10px!important;cursor:default!important;transition:all .15s!important;box-sizing:border-box!important;min-width:0!important;overflow:hidden!important}
#${SIDE_ID} .agy-sd-k:hover{background:var(--c-card)!important;border-color:var(--c-line)!important;box-shadow:0 4px 14px rgba(16,18,24,.07)!important;transform:translateY(-1px)!important}
#${SIDE_ID} .agy-sd-kv{font-size:16px!important;font-weight:720!important;letter-spacing:-.4px!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#${SIDE_ID} .agy-sd-kv.acc{background:linear-gradient(135deg,#3b82f6,#8b5cf6)!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent!important}
#${SIDE_ID} .agy-sd-kl{font-size:10px!important;color:var(--c-mut)!important;margin-top:1px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#${SIDE_ID} .agy-sd-kd{font-size:9.5px!important;color:var(--c-dim)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#${SIDE_ID} .agy-sd-card{background:var(--c-card)!important;border:1px solid var(--c-line)!important;border-radius:10px!important;padding:10px 11px!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-sd-ch{display:flex!important;align-items:center!important;justify-content:space-between!important;margin-bottom:8px!important}
#${SIDE_ID} .agy-sd-ct{font-size:11.5px!important;font-weight:650!important;display:flex!important;align-items:center!gap:5px!important}
#${SIDE_ID} .agy-sd-ct .agy-ic{width:13px!important;height:13px!important;flex-basis:13px!important;color:var(--c-mut)!important}
#${SIDE_ID} .agy-sd-cx{font-size:10px!important;color:var(--c-dim)!important}

#${SIDE_ID} .agy-dnw{gap:10px}
#${SIDE_ID} .agy-dn-v{font-size:12px}
#${SIDE_ID} .agy-dn-l{font-size:8.5px}
#${SIDE_ID} .agy-leggrid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))!important;gap:2px!important;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-leg{padding:3px 6px!important;gap:6px!important;align-items:center!important;min-width:0!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-leg-d{width:7px;height:7px;flex-basis:7px;margin-top:0}
#${SIDE_ID} .agy-leg-m{display:flex;align-items:center;gap:6px;min-width:0;flex:1}
#${SIDE_ID} .agy-leg-r{flex:1;min-width:0}
#${SIDE_ID} .agy-leg-n{font-size:10.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
#${SIDE_ID} .agy-leg-p{font-size:10px;font-weight:600;flex:0 0 38px;text-align:right}
#${SIDE_ID} .agy-leg-v{font-size:9.5px;flex:0 0 auto;white-space:nowrap}
#${SIDE_ID} .agy-big-v{font-size:17px}
#${SIDE_ID} .agy-big-u{font-size:10px}
#${SIDE_ID} .agy-big-p{font-size:11.5px}
#${SIDE_ID} .agy-big{margin-bottom:7px}
#${SIDE_ID} .agy-stk{height:8px;margin-bottom:6px;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-sd-leg2{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:0 6px}
/* ---- 侧边面板：卡片与列表自适应 ---- */
#${SIDE_ID} .agy-card{grid-column:1/-1!important;padding:10px 11px!important;border-radius:9px!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;min-width:0!important;overflow:hidden!important}
#${SIDE_ID} .agy-card-h{margin-bottom:8px;gap:6px}
#${SIDE_ID} .agy-card-t{font-size:10.5px}
#${SIDE_ID} .agy-card-x{font-size:9px}
#${SIDE_ID} .agy-kgrid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(110px,1fr))!important;gap:7px!important;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-list{max-height:200px;width:100%!important;box-sizing:border-box!important;overflow-x:hidden!important}
#${SIDE_ID} .agy-csum{grid-template-columns:1fr 1fr;gap:6px;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-heat{grid-template-columns:auto repeat(auto-fill,minmax(0,1fr))!important;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-sec{font-size:10.5px;margin:12px 0 7px}
#${SIDE_ID} .agy-empty{font-size:9.5px;padding:8px 0}
#${SIDE_ID} .agy-scroll{max-height:180px;width:100%!important;box-sizing:border-box!important;overflow-x:hidden!important}
#${SIDE_ID} .agy-sgrid{grid-template-columns:1fr;width:100%!important;box-sizing:border-box!important}
/* 侧边面板分节标题 */
#${SIDE_ID} .agy-sd-sec{font-size:9px;font-weight:660;color:var(--c-dim);letter-spacing:.6px;text-transform:uppercase;margin:10px 0 6px;display:flex;align-items:center;gap:5px;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-sd-sec::after{content:"";flex:1;height:1px;background:var(--c-line)}
#${SIDE_ID} .agy-sd-sec:first-child{margin-top:2px}
#${SIDE_ID} .agy-sd-leg2 .agy-leg-v{display:none}
#${SIDE_ID} .agy-rk{max-height:none;margin:0;padding:0;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-rk-r{font-size:10.5px;padding:4px 6px 6px;width:100%!important;box-sizing:border-box!important}
#${SIDE_ID} .agy-rk-v{font-size:10px}
#${SIDE_ID} .agy-sd-empty{font-size:11px;color:var(--c-dim);padding:10px 0}

#${SIDE_ID} .agy-cmd-row,
#${SIDE_ID} .agy-ev-row,
#${SIDE_ID} .agy-f-row{width:100%!important;max-width:100%!important;box-sizing:border-box!important;min-width:0!important}
#${SIDE_ID} .agy-cmd-txt,
#${SIDE_ID} .agy-ev-d,
#${SIDE_ID} .agy-f-path{min-width:0!important;flex:1 1 auto!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
#${SIDE_ID} .agy-ft{width:100%!important;max-width:100%!important;box-sizing:border-box!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}

/* ---------- 深色 ---------- */
body.theme-dark .agy-scope,body[class*="theme-dark"] .agy-scope,body.vscode-dark .agy-scope{
  --c-page:#141518;--c-card:#1c1d22;--c-fg:#e8e9ec;--c-fg2:#c9ccd3;--c-mut:#9ba1ad;--c-dim:#6f7581;--c-line:#2a2c33;
  --c-soft:#22242a;--c-hover:#262a33;--c-track:#2a2d34;--c-heat0:#262830;--c-accent:#60a5fa}
body.theme-dark .agy-cmd-tag,body[class*="theme-dark"] .agy-cmd-tag{background:rgba(16,185,129,.15)}
`;
  ensureStyles();

  /* ==========================================================================
     浮动提示 + 交互委托（环形图 / 堆叠条 / 图例联动）
     ========================================================================== */
  const tip = document.createElement('div');
  tip.id = TIP_ID;
  document.body.appendChild(tip);

  function inOurs(el) {
    return !!(el && el.closest && (el.closest('#' + ROOT_ID) || el.closest('#' + SIDE_ID)));
  }
  function tipHtml(raw) {
    const lines = String(raw).split('\n');
    let head = lines.shift();
    let dot = '';
    const m = /^\[(#[0-9a-fA-F]{3,8})\]\s*/.exec(head);
    if (m) { dot = '<span class="d" style="background:' + m[1] + '"></span>'; head = head.slice(m[0].length); }
    return '<b>' + dot + esc(head) + '</b>' + esc(lines.join('\n'));
  }
  function placeTip(x, y) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  let tipFor = null;
  function onMove(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!t || !inOurs(t)) {
      if (tipFor) { tip.classList.remove('on'); tipFor = null; }
      return;
    }
    if (tipFor !== t) {
      tipFor = t;
      tip.innerHTML = tipHtml(t.getAttribute('data-tip'));
      tip.classList.add('on');
    }
    placeTip(e.clientX, e.clientY);
  }

  function setHot(group, idx) {
    if (!group) return;
    const items = group.querySelectorAll('[data-i]');
    if (idx == null) {
      group.classList.remove('hot');
      items.forEach((n) => n.classList.remove('on'));
    } else {
      group.classList.add('hot');
      items.forEach((n) => n.classList.toggle('on', n.getAttribute('data-i') === idx));
    }
    const cv = group.querySelector('[data-cv]');
    const cl = group.querySelector('[data-cl]');
    if (!cv || !cl) return;
    if (idx == null) {
      cv.textContent = cv.getAttribute('data-def');
      cl.textContent = cl.getAttribute('data-def');
      cv.style.color = '';
    } else {
      const src = group.querySelector('[data-i="' + idx + '"][data-n]');
      if (!src) return;
      cv.textContent = src.getAttribute('data-v');
      cl.textContent = src.getAttribute('data-n');
      const cp = group.querySelector('[data-cp]');
      if (cp) cp.textContent = src.getAttribute('data-p') + '%';
      cv.style.color = src.getAttribute('data-c') || '';
    }
  }
  function onOver(e) {
    const it = e.target && e.target.closest ? e.target.closest('[data-dng] [data-i]') : null;
    if (!it || !inOurs(it)) return;
    const g = it.closest('[data-dng]');
    setHot(g, it.getAttribute('data-i'));
  }
  function onOut(e) {
    const it = e.target && e.target.closest ? e.target.closest('[data-dng] [data-i]') : null;
    if (!it) return;
    const g = it.closest('[data-dng]');
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-dng] [data-i]') : null;
    if (to && to.closest('[data-dng]') === g) return;
    setHot(g, null);
  }
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  cleanups.push(() => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
  });

  /* ==========================================================================
     组件
     ========================================================================== */
  /**
   * 环形图。segs: [{name, value, color, label?}]
   * opts: { size, sw, cv, cl, fmt }
   */
  function donutSvg(segs, opts) {
    const size = opts.size || 120, sw = opts.sw || 12;
    const fmt = opts.fmt || fn;
    const r = size / 2 - sw / 2 - 4, c = size / 2, C = 2 * Math.PI * r;
    const total = segs.reduce((a, b) => a + (b.value || 0), 0);
    const gap = segs.filter((s) => s.value > 0).length > 1 ? Math.min(2, C * 0.006) : 0;
    let acc = 0;
    const arcs = segs.map((s, i) => {
      const frac = total > 0 ? s.value / total : 0;
      const len = frac * C;
      const dash = Math.max(0.001, len - gap);
      const p = pctStr(s.value, total);
      const lbl = s.label != null ? s.label : fmt(s.value);
      const el = '<circle class="agy-arc" data-i="' + i + '" data-n="' + esc(s.name) + '" data-v="' + esc(lbl) +
        '" data-p="' + p + '" data-c="' + s.color + '" data-tip="' + esc('[' + s.color + '] ' + s.name + '\n' + lbl + ' · ' + p + '%') +
        '" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + s.color +
        '" stroke-dasharray="' + dash + ' ' + (C - dash) + '" stroke-dashoffset="' + (-acc) + '"></circle>';
      acc += len;
      return el;
    }).join('');
    return '<div class="agy-dn" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '" style="--sw:' + sw + 'px">' +
        '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--c-track)" stroke-width="' + sw + '"></circle>' +
        arcs + '</svg>' +
      '<div class="agy-dn-c"><div class="agy-dn-v" data-cv data-def="' + esc(opts.cv) + '">' + esc(opts.cv) + '</div>' +
        '<div class="agy-dn-l" data-cl data-def="' + esc(opts.cl) + '">' + esc(opts.cl) + '</div><div class="agy-dn-p" data-cp></div></div>' +
    '</div>';
  }

  function legendItems(segs, opts) {
    const fmt = opts.fmt || fn;
    const total = segs.reduce((a, b) => a + (b.value || 0), 0);
    return segs.map((s, i) => {
      const lbl = s.label != null ? s.label : fmt(s.value);
      const sub = s.sub ? ' · ' + s.sub : '';
      return '<div class="agy-leg" data-i="' + i + '">' +
        '<span class="agy-leg-d" style="background:' + s.color + '"></span>' +
        '<div class="agy-leg-m"><div class="agy-leg-r"><span class="agy-leg-n">' + esc(s.name) + '</span>' +
          '<span class="agy-leg-p">' + pctStr(s.value, total) + '%</span></div>' +
          '<div class="agy-leg-v">' + (opts.approx ? '≈' : '') + esc(lbl) + esc(sub) + '</div></div>' +
      '</div>';
    }).join('');
  }

  function donutBlock(segs, opts) {
    segs = segs.filter((s) => s.value > 0);
    if (!segs.length) return '<div class="agy-empty">暂无数据</div>';
    return '<div class="agy-dnw agy-dng" data-dng>' + donutSvg(segs, opts) +
      '<div class="agy-leggrid">' + legendItems(segs, opts) + '</div></div>';
  }

  function stackBlock(parts, used, pctOfWin) {
    // parts: [{name,value,color}]
    const legend = parts.map((p, i) => {
      const pp = pctStr(p.value, used);
      return '<div class="agy-leg" data-i="' + i + '">' +
        '<span class="agy-leg-d" style="background:' + p.color + '"></span>' +
        '<div class="agy-leg-m"><div class="agy-leg-r"><span class="agy-leg-n">' + esc(p.name) + '</span>' +
        '<span class="agy-leg-p">' + pp + '%</span></div><div class="agy-leg-v">≈' + fn(p.value) + ' tok</div></div></div>';
    }).join('');
    const segs = parts.map((p, i) => '<i data-i="' + i + '" style="width:' + (used > 0 ? p.value / used * pctOfWin : 0) +
      '%;background:' + p.color + '" data-tip="' + esc('[' + p.color + '] ' + p.name + '\n≈' + fn(p.value) + ' tok · ' + pctStr(p.value, used) + '%') + '"></i>').join('');
    return { stack: '<div class="agy-stk">' + segs + '</div>', legend };
  }

  function rankList(entries) {
    if (!entries.length) return '<div class="agy-empty">暂无数据</div>';
    const max = entries[0][1] || 1;
    const total = entries.reduce((a, b) => a + b[1], 0);
    return '<div class="agy-rk agy-scroll">' + entries.map((e, i) => {
      const color = col(i);
      return '<div class="agy-rk-r" ' +
        ' data-tip="' + esc('[' + color + '] ' + e[0] + '\n×' + e[1] + ' · 占比 ' + pctStr(e[1], total) + '%') + '">' +
        '<span class="agy-rk-d" style="background:' + color + '"></span>' +
        '<span class="agy-rk-n agy-mono">' + esc(e[0]) + '</span>' +
        '<span class="agy-rk-v">×' + fn(e[1]) + '</span>' +
        '<span class="agy-rk-b"><i style="width:' + Math.max(2, e[1] / max * 100) + '%;background:' + color + '"></i></span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function cardHead(ic, title, extra) {
    return '<div class="agy-ch"><div class="agy-ct">' + icon(ic) + esc(title) + '</div>' +
      (extra ? '<div class="agy-cx">' + extra + '</div>' : '') + '</div>';
  }

  /* ==========================================================================
     数据：范围过滤 + 聚合
     ========================================================================== */
  function currentConvId() {
    const m = /^\/c\/([0-9a-f-]{36})/i.exec(location.pathname || '');
    return m ? m[1] : null;
  }
  function sessionById(id) {
    if (!id || !DATA || !Array.isArray(DATA.sessions)) return null;
    return DATA.sessions.find((s) => String(s.id).toLowerCase() === id.toLowerCase()) || null;
  }
  const sessTime = (s) => parseTs(s.endAt || s.lastModified || s.startAt);
  const rangeDays = () => (RANGE === '7d' ? 7 : RANGE === '30d' ? 30 : 0);
  const sessName = (s) => (s.title && s.title !== '(未命名)' ? s.title : s.shortId);
  const wsName = (p) => {
    const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  };

  function addInto(dst, src) {
    for (const [k, v] of Object.entries(src || {})) dst[k] = (dst[k] || 0) + (Number(v) || 0);
    return dst;
  }

  function filtered() {
    const d = DATA || {};
    const days = rangeDays();
    const cut = days ? Date.now() - days * DAY : 0;
    let sessions = (d.sessions || []).slice();
    if (days) sessions = sessions.filter((s) => { const t = sessTime(s); return Number.isFinite(t) && t >= cut; });

    const tot = { sessions: sessions.length, main: 0, sub: 0, tokens: 0, input: 0, output: 0, cache: 0, cost: 0,
      requests: 0, activeSeconds: 0, toolCalls: 0, steps: 0 };
    const tools = {}, skills = {}, progs = {}, models = {}, timeCats = {};
    let hasSessCats = false, hasSessSkills = false, hasSessProgs = false;
    for (const s of sessions) {
      const tk = s.tokens || {};
      if (s.isSubagent) tot.sub++; else tot.main++;
      tot.tokens += tk.total || 0; tot.input += tk.input || 0; tot.output += tk.output || 0; tot.cache += tk.cache || 0;
      tot.cost += tk.costUSD || 0; tot.requests += tk.requests || 0;
      tot.activeSeconds += s.activeSeconds || 0; tot.toolCalls += s.toolTotal || 0; tot.steps += s.steps || 0;
      addInto(tools, s.toolCalls); addInto(models, s.models);
      if (s.timeCats) { hasSessCats = true; addInto(timeCats, s.timeCats); }
      if (s.skills) { hasSessSkills = true; addInto(skills, s.skills); }
      if (s.programCounts) { hasSessProgs = true; addInto(progs, s.programCounts); }
    }
    const all = !days;
    const execRecords = (d.execRecords || []).filter((r) => {
      if (all) return true;
      const t = parseTs(r.at);
      return Number.isFinite(t) && t >= cut;
    });
    return {
      all: d, sessions, tot, execRecords,
      tools: sortEntries(Object.keys(tools).length || !all ? tools : d.toolUsage),
      skills: sortEntries(hasSessSkills || !all ? skills : d.skills),
      progs: sortEntries(hasSessProgs || !all ? progs : d.programCounts).filter(([k]) => k && !/^created$/i.test(k)),
      models: sortEntries(Object.keys(models).length || !all ? models : d.models),
      timeCats: hasSessCats ? timeCats : (d.timeCats || {}),
    };
  }

  /* ==========================================================================
     总览卡片
     ========================================================================== */
  function cardKpis(f) {
    const t = f.tot;
    const cacheRate = (t.input + t.cache) > 0 ? t.cache / (t.input + t.cache) * 100 : 0;
    const speed = t.activeSeconds > 0 ? t.output / t.activeSeconds : 0;
    const k = (label, val, sub, tipText, acc) =>
      '<div class="agy-k" data-tip="' + esc(tipText) + '"><div class="agy-k-l">' + label + '</div>' +
      '<div class="agy-k-v' + (acc ? ' acc' : '') + '">' + val + '</div><div class="agy-k-d">' + sub + '</div></div>';
    return '<div class="s6 agy-kgrid">' +
      k('全部会话', t.sessions, '主会话 ' + t.main + ' · 子 Agent ' + t.sub, '会话\n主会话 ' + t.main + '\n子 Agent ' + t.sub) +
      k('Token 消耗', fn(t.tokens), '轮次 ' + fn(t.requests), 'Token 消耗\n输入 ' + fn(t.input) + '\n输出 ' + fn(t.output) + '\n缓存读取 ' + fn(t.cache), true) +
      k('预估费用', usd(t.cost), '按公开单价估算', '预估费用\n按公开单价估算，仅供参考\n平均每轮 ' + usd(t.requests ? t.cost / t.requests : 0)) +
      k('缓存命中', cacheRate.toFixed(2) + '%', '缓存读取 ' + fn(t.cache), '缓存命中率\n缓存读取 / (输入 + 缓存读取)\n= ' + fn(t.cache) + ' / ' + fn(t.input + t.cache)) +
      k('工具调用', fn(t.toolCalls), '步数 ' + fn(t.steps), '工具调用\n共 ' + t.toolCalls + ' 次 · ' + f.tools.length + ' 种工具\n步数 ' + t.steps) +
      k('活跃时长', dur(t.activeSeconds), '输出 ' + speed.toFixed(1) + ' tok/s', '活跃时长\n' + dur(t.activeSeconds) + '\n平均输出速度 ' + speed.toFixed(1) + ' tok/s') +
    '</div>';
  }

  function cardDaily(f) {
    const daily = f.all.daily || {};
    const n = RANGE === '7d' ? 7 : RANGE === '30d' ? 30 : 14;
    const today = parseDay(dkey(Date.now()));
    const days = [];
    for (let i = n - 1; i >= 0; i--) days.push(dkey(today - i * DAY));
    const vals = days.map((k) => daily[k] || { tokens: 0, cost: 0, requests: 0 });
    const maxT = Math.max.apply(null, vals.map((v) => v.tokens || 0)) || 1;
    const maxC = Math.max.apply(null, vals.map((v) => v.cost || 0)) || 1;
    const sumT = vals.reduce((a, v) => a + (v.tokens || 0), 0);
    const sumC = vals.reduce((a, v) => a + (v.cost || 0), 0);
    const ticks = [1, 0.75, 0.5, 0.25, 0];
    const every = n > 16 ? Math.ceil(n / 10) : 1;
    const cols = days.map((k, i) => {
      const v = vals[i];
      const ht = (v.tokens || 0) / maxT * 100, hc = (v.cost || 0) / maxC * 100;
      const wd = WD[wdIdx(parseDay(k))];
      const lab = (n <= 14 && v.tokens > 0) ? '<em>' + fn(v.tokens) + '</em>' : '';
      return '<div class="agy-dc' + (i === n - 1 ? ' today' : '') + '" data-tip="' +
        esc(k + ' 周' + wd + '\nToken ' + fn(v.tokens) + '\n费用 ' + usd(v.cost) + '\n轮次 ' + (v.requests || 0)) + '">' +
        '<div class="agy-dbars"><i class="t" style="height:' + (v.tokens ? Math.max(1.5, ht) : 0) + '%">' + lab + '</i>' +
        '<i class="c" style="height:' + (v.cost ? Math.max(1.5, hc) : 0) + '%"></i></div>' +
        '<span class="agy-dx">' + ((i % every === 0 || i === n - 1) ? k.slice(5) : '') + '</span></div>';
    }).join('');
    return '<div class="agy-card s6">' +
      cardHead('chart', '近 ' + n + ' 天用量', '合计 <b>' + fn(sumT) + '</b> · <b>' + usd(sumC) + '</b>') +
      '<div class="agy-dch">' +
        '<div class="agy-dax l">' + ticks.map((t) => '<span>' + fn(maxT * t) + '</span>').join('') + '</div>' +
        '<div class="agy-dplot"><div class="agy-dgrid">' + ticks.map(() => '<i></i>').join('') + '</div>' + cols + '</div>' +
        '<div class="agy-dax r">' + ticks.map((t) => '<span>' + usd(maxC * t) + '</span>').join('') + '</div>' +
      '</div>' +
      '<div class="agy-lg"><span><i style="background:#3b82f6"></i>Token</span><span><i style="background:#10b981"></i>费用（按公开单价估算）</span></div>' +
    '</div>';
  }

  function cardToken(f) {
    const t = f.tot;
    const cacheRate = (t.input + t.cache) > 0 ? t.cache / (t.input + t.cache) * 100 : 0;
    const segs = [
      { name: '缓存读取', value: t.cache, color: '#06b6d4' },
      { name: '输入（未缓存）', value: t.input, color: '#3b82f6' },
      { name: '输出', value: t.output, color: '#8b5cf6' },
    ];
    return '<div class="agy-card s6">' +
      cardHead('pie', 'Token 统计', '缓存命中 <b>' + cacheRate.toFixed(1) + '%</b>') +
      donutBlock(segs, { size: 132, sw: 13, cv: fn(t.input + t.output + t.cache), cl: '总吞吐' }) +
      '<div class="agy-ft">悬停环形图或图例查看各项；Token 消耗 = 输入 + 输出（不含缓存读取）。</div>' +
    '</div>';
  }

  function cardTime(f) {
    const cats = f.timeCats || {};
    const total = sumVals(cats);
    const speed = f.tot.activeSeconds > 0 ? f.tot.output / f.tot.activeSeconds : 0;
    const segs = TIME_SEGS.map((s) => ({ name: s.name, value: cats[s.key] || 0, color: s.color }));
    return '<div class="agy-card s6">' +
      cardHead('clock', '耗时统计', '会话累计 · 输出速度 <b>' + speed.toFixed(1) + ' tok/s</b>') +
      donutBlock(segs, { size: 132, sw: 13, cv: dur(total), cl: '活跃时长', fmt: dur }) +
      '<div class="agy-ft">按 transcript 时间戳分类：工具执行 / 模型生成 / 等待用户输入 / 系统开销。</div>' +
    '</div>';
  }

  function cardHeat(f) {
    const d = f.all;
    const daily = d.daily || {};
    const sessPerDay = {};
    for (const s of d.sessions || []) {
      const ks = s.days && Object.keys(s.days).length ? Object.keys(s.days)
        : (Number.isFinite(sessTime(s)) ? [dkey(sessTime(s))] : []);
      for (const k of ks) sessPerDay[k] = (sessPerDay[k] || 0) + 1;
    }
    const valOf = (k) => HEAT_METRIC === 'tokens' ? ((daily[k] && daily[k].tokens) || (d.heatmap && d.heatmap[k]) || 0)
      : HEAT_METRIC === 'req' ? ((daily[k] && daily[k].requests) || 0) : (sessPerDay[k] || 0);
    const fmtV = (v) => HEAT_METRIC === 'tokens' ? fn(v) + ' tok' : HEAT_METRIC === 'req' ? v + ' 轮' : v + ' 个会话';

    const allKeys = Object.keys(Object.assign({}, daily, sessPerDay, d.heatmap || {})).sort();
    const todayT = parseDay(dkey(Date.now()));
    const monThis = todayT - wdIdx(todayT) * DAY;
    let W = 16;
    if (allKeys.length) {
      const f0 = parseDay(allKeys[0]);
      const monFirst = f0 - wdIdx(f0) * DAY;
      W = Math.round((monThis - monFirst) / (7 * DAY)) + 1;
    }
    W = Math.max(12, Math.min(22, W));
    const start = monThis - (W - 1) * 7 * DAY;

    let max = 0;
    for (let i = 0; i < W * 7; i++) max = Math.max(max, valOf(dkey(start + i * DAY)));
    const COLORS = ['var(--c-heat0)', '#c7dbfd', '#93bbfb', '#5b97f6', '#2563eb'];

    let cells = '';
    let prevMonth = -1;
    for (let c = 0; c < W; c++) {
      const t0 = start + c * 7 * DAY;
      const mo = new Date(t0).getUTCMonth();
      // 该周包含当月 1 号，或第一列
      let label = '';
      for (let r = 0; r < 7; r++) {
        const dt = new Date(t0 + r * DAY);
        if (dt.getUTCDate() === 1) { label = (dt.getUTCMonth() + 1) + '月'; break; }
      }
      if (!label && c === 0) label = (new Date(t0).getUTCMonth() + 1) + '月';
      if (label && mo !== prevMonth) prevMonth = mo;
      cells += '<div class="agy-hm" style="grid-row:1;grid-column:' + (c + 2) + '">' + label + '</div>';
      for (let r = 0; r < 7; r++) {
        const t = t0 + r * DAY;
        const k = dkey(t);
        const pos = 'grid-row:' + (r + 2) + ';grid-column:' + (c + 2);
        if (t > todayT) { cells += '<div class="agy-hc fut" style="' + pos + '"></div>'; continue; }
        const v = valOf(k);
        const lvl = v <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(v / (max || 1)) * 4)));
        const dd = daily[k] || {};
        cells += '<div class="agy-hc' + (t === todayT ? ' today' : '') + '" style="' + pos + ';background:' + COLORS[lvl] + '" data-tip="' +
          esc(k + ' 周' + WD[r] + '\nToken ' + fn(dd.tokens || 0) + ' · 轮次 ' + (dd.requests || 0) + '\n会话 ' + (sessPerDay[k] || 0) + ' 个 · 费用 ' + usd(dd.cost || 0)) + '"></div>';
      }
    }
    const rows = WD.map((w, r) => '<div class="agy-hw" style="grid-row:' + (r + 2) + ';grid-column:1">' + w + '</div>').join('');

    // 活跃天数 / 最长连续
    let active = 0, streak = 0, best = 0;
    const span = allKeys.length ? Math.round((todayT - parseDay(allKeys[0])) / DAY) + 1 : 0;
    for (let i = 0; i < span; i++) {
      const k = dkey(parseDay(allKeys[0]) + i * DAY);
      if (valOf(k) > 0) { active++; streak++; best = Math.max(best, streak); } else streak = 0;
    }

    return '<div class="agy-card s3">' +
      cardHead('grid', '活跃度',
        '<div class="agy-seg sm" data-heatseg>' +
          [['tokens', 'Token'], ['req', '轮次'], ['sess', '会话']].map((x) =>
            '<button data-hm="' + x[0] + '" class="' + (HEAT_METRIC === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') +
        '</div>') +
      '<div class="agy-heat" style="grid-template-columns:16px repeat(' + W + ',minmax(0,1fr));grid-template-rows:13px repeat(7,auto)">' +
        rows + cells + '</div>' +
      '<div class="agy-hlg"><span>活跃 ' + active + ' 天 · 最长连续 ' + best + ' 天</span>' +
        '<span class="agy-hlg-s">少' + COLORS.map((c) => '<i style="background:' + c + '"></i>').join('') + '多</span></div>' +
      '<div class="agy-hlg" style="margin-top:4px"><span>峰值 ' + fmtV(max) + '</span></div>' +
    '</div>';
  }

  function cardSkills(f) {
    const total = f.skills.reduce((a, b) => a + b[1], 0);
    return '<div class="agy-card s3">' +
      cardHead('spark', '技能加载', f.skills.length + ' 个技能 · ' + total + ' 次加载') +
      rankList(f.skills) + '</div>';
  }
  function cardTools(f) {
    const total = f.tools.reduce((a, b) => a + b[1], 0);
    return '<div class="agy-card s3">' +
      cardHead('code', '工具调用', f.tools.length + ' 个工具 · ' + fn(total) + ' 次调用') +
      rankList(f.tools) + '</div>';
  }
  function cardProgs(f) {
    const total = f.progs.reduce((a, b) => a + b[1], 0);
    return '<div class="agy-card s3">' +
      cardHead('term', '命令执行', f.progs.length + ' 个程序 · ' + fn(total) + ' 次执行') +
      rankList(f.progs) + '</div>';
  }

  function cardModels(f) {
    const segs = f.models.slice(0, 7).map((e, i) => ({ name: e[0], value: e[1], color: col(i), label: e[1] + ' 次' }));
    const rest = f.models.slice(7).reduce((a, b) => a + b[1], 0);
    if (rest) segs.push({ name: '其他', value: rest, color: '#94a3b8', label: rest + ' 次' });
    const total = f.models.reduce((a, b) => a + b[1], 0);
    return '<div class="agy-card s4">' +
      cardHead('cpu', '模型分布', f.models.length + ' 个模型') +
      donutBlock(segs, { size: 112, sw: 12, cv: String(total), cl: '次调用' }) + '</div>';
  }
  function cardFileTypes(f) {
    const es = sortEntries(f.all.fileTypes);
    const segs = es.slice(0, 7).map((e, i) => ({ name: e[0], value: e[1], color: col(i + 2), label: e[1] + ' 个' }));
    const rest = es.slice(7).reduce((a, b) => a + b[1], 0);
    if (rest) segs.push({ name: '其他', value: rest, color: '#94a3b8', label: rest + ' 个' });
    const n = (f.all.totals && f.all.totals.filesTouched) || es.reduce((a, b) => a + b[1], 0);
    return '<div class="agy-card s4">' +
      cardHead('file', '文件类型', '共 ' + n + ' 个文件') +
      donutBlock(segs, { size: 112, sw: 12, cv: String(n), cl: '个文件' }) + '</div>';
  }
  function cardHourly(f) {
    const h = f.all.hourly || {};
    const vals = [];
    for (let i = 0; i < 24; i++) vals.push(h[String(i).padStart(2, '0')] || 0);
    const max = Math.max.apply(null, vals) || 1;
    const peak = vals.indexOf(Math.max.apply(null, vals));
    const tot = vals.reduce((a, b) => a + b, 0);
    if (!tot) return '<div class="agy-card s4">' + cardHead('sun', '活跃时段') + '<div class="agy-empty">暂无数据</div></div>';
    return '<div class="agy-card s4">' +
      cardHead('sun', '活跃时段', '高峰 <b>' + String(peak).padStart(2, '0') + ':00</b>') +
      '<div class="agy-hr">' + vals.map((v, i) =>
        '<div class="agy-hr-c' + (i === peak ? ' pk' : '') + '" data-tip="' +
        esc(String(i).padStart(2, '0') + ':00 – ' + String(i).padStart(2, '0') + ':59\nToken ' + fn(v) + ' · ' + pctStr(v, tot) + '%') + '">' +
        '<i style="height:' + (v ? Math.max(2, v / max * 100) : 0) + '%"></i></div>').join('') + '</div>' +
      '<div class="agy-hr-x"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>' +
    '</div>';
  }

  /* ---- 当前会话：上下文 ---- */
  function ctxParts(sess) {
    const ctx = sess && sess.context;
    if (!ctx || !ctx.used) return null;
    const keys = CTX_ORDER.filter((k) => ctx.parts[k]).concat(Object.keys(ctx.parts).filter((k) => !CTX_ORDER.includes(k)));
    return keys.map((k) => ({ name: k, value: ctx.parts[k].tokens || 0, color: CTX_COLORS[k] || '#94a3b8' }));
  }
  function cardContext(sess) {
    const parts = ctxParts(sess);
    if (!parts) return '<div class="agy-card s6">' + cardHead('layers', '当前上下文') + '<div class="agy-empty">暂无数据</div></div>';
    const used = sess.context.used, win = PREFS.winSize;
    const pct = Math.min(100, used / win * 100);
    const sb = stackBlock(parts, used, pct);
    return '<div class="agy-card s6 agy-dng" data-dng>' +
      cardHead('layers', '当前上下文', (sess.context.requests || 0) + ' 次请求') +
      '<div class="agy-big"><div><span class="agy-big-v">' + fn(used) + '</span><span class="agy-big-u">/ ' + fn(win) + ' tokens</span></div>' +
        '<div class="agy-big-p" style="color:' + (pct > 80 ? 'var(--c-bad)' : pct > 60 ? 'var(--c-warn)' : 'var(--c-accent)') + '">' + pct.toFixed(1) + '%</div></div>' +
      sb.stack +
      '<div class="agy-leggrid" style="margin-top:10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">' + sb.legend + '</div>' +
      '<div class="agy-ft">上下文 = 最后一次请求的输入（含缓存）；分项按字符占比估算。</div>' +
    '</div>';
  }

  function cardContextEvents(sess) {
    const list = (sess && sess.truncations) || [];
    const TN = { SYSTEM_MESSAGE: '系统消息', GENERIC: '工具输出', PLANNER_RESPONSE: '模型响应', USER_INPUT: '用户输入' };
    const TC = { SYSTEM_MESSAGE: '#8b5cf6', GENERIC: '#06b6d4', PLANNER_RESPONSE: '#3b82f6', USER_INPUT: '#10b981' };
    if (!list.length) return '<div class="agy-card s6">' + cardHead('cut', '上下文事件') + '<div class="agy-empty">本次会话没有压缩或剪枝记录</div></div>';
    const by = {};
    for (const e of list) by[e.type] = (by[e.type] || 0) + 1;
    return '<div class="agy-card s6">' +
      cardHead('cut', '上下文事件', list.length + ' 条') +
      '<div class="agy-ev-tags">' + Object.entries(by).map(([k, v]) => {
        const c = TC[k] || '#94a3b8';
        return '<span class="agy-ev-tag" style="background:' + c + '1c;color:' + c + '">' + esc(TN[k] || k) + ' ' + v + '</span>';
      }).join('') + '</div>' +
      '<div class="agy-list agy-scroll">' + list.slice(0, 40).map((e) => {
        const c = TC[e.type] || '#94a3b8';
        return '<div class="agy-ev-row"><span style="color:' + c + '">✂</span>' +
          '<span class="agy-ev-nm" style="color:' + c + '">' + esc(TN[e.type] || e.type) + '</span>' +
          '<span class="agy-ev-d agy-mono">' + esc((e.fields || []).join(',')) + '</span>' +
          '<span class="agy-ev-w">step ' + (e.step == null ? '-' : e.step) + '</span>' +
          '<span class="agy-ev-w">' + esc(e.at ? String(e.at).slice(11, 16) : '') + '</span></div>';
      }).join('') + '</div></div>';
  }

  function langOf(p) {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(p);
    const ext = m ? m[1].toLowerCase() : '';
    const MAP = {
      ts: ['TS', '#3178c6'], tsx: ['TSX', '#3178c6'], js: ['JS', '#d4b106'], jsx: ['JSX', '#d4b106'], mjs: ['JS', '#d4b106'],
      py: ['PY', '#3776ab'], go: ['GO', '#00add8'], rs: ['RS', '#c4703c'], java: ['JV', '#b07219'], kt: ['KT', '#A97BFF'],
      c: ['C', '#555'], h: ['H', '#555'], cpp: ['C++', '#f34b7d'], hpp: ['C++', '#f34b7d'], cc: ['C++', '#f34b7d'],
      cs: ['C#', '#178600'], php: ['PHP', '#4F5D95'], rb: ['RB', '#701516'], html: ['HT', '#e34c26'], css: ['CSS', '#563d7c'],
      scss: ['SC', '#c6538c'], vue: ['VUE', '#41b883'], json: ['{}', '#a08a00'], yaml: ['YML', '#cb171e'], yml: ['YML', '#cb171e'],
      toml: ['TML', '#9c4221'], md: ['MD', '#083fa1'], sql: ['SQL', '#e38c00'], sh: ['SH', '#4c9a2a'], ps1: ['PS', '#2b6cb0'],
    };
    return MAP[ext] || ['?', '#94a3b8'];
  }

  function cardFileActivity(sess) {
    const ops = (sess && sess.fileOps) || [];
    if (!ops.length) return '<div class="agy-card s12">' + cardHead('file', '文件活动') + '<div class="agy-empty">暂无文件操作</div></div>';
    const agg = {};
    for (const o of ops) {
      const a = agg[o.path] || (agg[o.path] = { write: 0, edit: 0, read: 0, chars: 0 });
      a[o.op] = (a[o.op] || 0) + 1;
      a.chars += o.chars || 0;
    }
    const es = Object.entries(agg).sort((a, b) =>
      (b[1].write * 3 + b[1].edit * 2 + b[1].read) - (a[1].write * 3 + a[1].edit * 2 + a[1].read));
    const n = (op) => ops.filter((o) => o.op === op).length;
    const rows = es.slice(0, 30).map(([p, v]) => {
      const segs = String(p).split(/[\\/]/);
      const lang = langOf(p);
      return '<div class="agy-fa-row" data-tip="' + esc(p + '\n写 ' + v.write + ' · 改 ' + v.edit + ' · 读 ' + v.read + (v.chars ? '\n' + v.chars + ' 字符' : '')) + '">' +
        '<span class="agy-fa-lang" style="background:' + lang[1] + '1f;color:' + lang[1] + '">' + esc(lang[0]) + '</span>' +
        '<span class="agy-fa-path"><span class="agy-fa-dir">' + esc(segs.slice(-2, -1)[0] || '') + '</span>' +
        '<span class="agy-fa-nm">' + esc(segs.pop() || p) + '</span></span>' +
        '<span class="agy-fa-bs">' + (v.write ? '<span class="agy-fa-b w">写 ' + v.write + '</span>' : '') +
          (v.edit ? '<span class="agy-fa-b e">改 ' + v.edit + '</span>' : '') +
          (v.read ? '<span class="agy-fa-b r">读 ' + v.read + '</span>' : '') + '</span>' +
        '<span class="agy-fa-ch">' + (v.chars ? (v.chars >= 1000 ? (v.chars / 1000).toFixed(1) + 'k' : v.chars) : '') + '</span></div>';
    }).join('');
    return '<div class="agy-card s12">' +
      cardHead('file', '文件活动', es.length + ' 个文件 <span class="agy-fa-b w">写 ' + n('write') + '</span><span class="agy-fa-b e">改 ' +
        n('edit') + '</span><span class="agy-fa-b r">读 ' + n('read') + '</span>') +
      '<div class="agy-list agy-scroll" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:1px 16px;max-height:300px">' + rows + '</div></div>';
  }

  /* ---- 会话卡片网格 ---- */
  function cardSessionsShell(f) {
    return '<div class="agy-card s12" data-sesscard>' +
      cardHead('msg', '会话', '<span data-scount></span>') +
      '<div class="agy-stool">' +
        '<label class="agy-search">' + icon('search') +
          '<input data-sq placeholder="搜索标题 / 工作区 / 会话 ID / 模型…" value="' + esc(SQ) + '"></label>' +
        '<select class="agy-sel" data-sscope>' +
          [['main', '主会话（子 Agent 折叠）'], ['all', '全部会话（含子 Agent）'], ['sub', '仅子 Agent']].map((x) =>
            '<option value="' + x[0] + '"' + (SSCOPE === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') +
        '</select>' +
        '<div class="agy-seg" data-ssortseg>' +
          [['recent', '最近更新'], ['tokens', 'Token 总用量'], ['cost', '预估费用'], ['ctx', '当前上下文']].map((x) =>
            '<button data-ssort="' + x[0] + '" class="' + (SSORT === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') +
        '</div>' +
      '</div>' +
      '<div class="agy-chips" data-schips></div>' +
      '<div class="agy-sgrid" data-sgrid></div>' +
    '</div>';
  }

  let SLIMIT = 24;
  function renderSessions() {
    const host = bodyEl.querySelector('[data-sesscard]');
    if (!host) return;
    const f = filtered();
    const all = f.sessions;
    const kids = {};
    for (const s of all) if (s.isSubagent && s.parent) (kids[s.parent] = kids[s.parent] || []).push(s);
    const ids = new Set(all.map((s) => s.id));

    let list = all.filter((s) => {
      if (SSCOPE === 'sub') return s.isSubagent;
      if (SSCOPE === 'main') return !s.isSubagent || !ids.has(s.parent);
      return true;
    });

    // 工作区 chips（按当前 scope 统计）
    const wsCount = {};
    let ungrouped = 0;
    for (const s of list) {
      const w = (s.workspace || []).map(wsName).filter(Boolean);
      if (!w.length) ungrouped++;
      for (const x of new Set(w)) wsCount[x] = (wsCount[x] || 0) + 1;
    }
    const chips = [['', '全部', list.length]].concat(sortEntries(wsCount).map(([k, v]) => [k, k, v]));
    if (ungrouped) chips.push(['__none__', '未分组', ungrouped]);
    host.querySelector('[data-schips]').innerHTML = chips.map((c) =>
      '<button class="agy-chip' + (SWS === c[0] ? ' on' : '') + '" data-sws="' + esc(c[0]) + '">' + (c[0] && c[0] !== '__none__' ? '<span data-notr>' + esc(c[1]) + '</span>' : esc(c[1])) + ' <em>' + c[2] + '</em></button>').join('');

    if (SWS) {
      list = list.filter((s) => {
        const w = (s.workspace || []).map(wsName).filter(Boolean);
        return SWS === '__none__' ? !w.length : w.includes(SWS);
      });
    }
    const q = SQ.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => [s.title, s.id, (s.workspace || []).join(' '), Object.keys(s.models || {}).join(' ')]
        .join(' ').toLowerCase().includes(q));
    }
    const tok = (s) => (s.tokens && s.tokens.total) || 0;
    const sorter = {
      recent: (a, b) => (sessTime(b) || 0) - (sessTime(a) || 0),
      tokens: (a, b) => tok(b) - tok(a),
      cost: (a, b) => ((b.tokens && b.tokens.costUSD) || 0) - ((a.tokens && a.tokens.costUSD) || 0),
      ctx: (a, b) => ((b.context && b.context.used) || 0) - ((a.context && a.context.used) || 0),
    }[SSORT];
    list.sort(sorter);

    host.querySelector('[data-scount]').innerHTML = '<b>' + list.length + '</b> / ' + all.length;
    const cur = currentConvId();
    const shown = list.slice(0, SLIMIT);
    const grid = host.querySelector('[data-sgrid]');
    if (!shown.length) {
      grid.innerHTML = '<div class="agy-empty" style="grid-column:1/-1">没有匹配的会话</div>';
      return;
    }
    grid.innerHTML = shown.map((s) => sessCard(s, cur, SSCOPE === 'main' ? (kids[s.id] || []) : [])).join('') +
      (list.length > SLIMIT ? '<button class="agy-more" data-smore style="grid-column:1/-1">显示更多（还有 ' + (list.length - SLIMIT) + ' 个）</button>' : '');
  }

  function sessCard(s, cur, kids) {
    const tk = s.tokens || {};
    const isCur = cur && String(s.id).toLowerCase() === cur.toLowerCase();
    const cacheRate = (tk.input + tk.cache) > 0 ? tk.cache / (tk.input + tk.cache) * 100 : 0;
    const t = sessTime(s);
    const ws = (s.workspace || []).map(wsName).filter(Boolean);
    const topModel = sortEntries(s.models)[0];
    const segs = [
      { name: '缓存读取', value: tk.cache || 0, color: '#06b6d4' },
      { name: '输入', value: tk.input || 0, color: '#3b82f6' },
      { name: '输出', value: tk.output || 0, color: '#8b5cf6' },
    ].filter((x) => x.value > 0);
    const kidTok = kids.reduce((a, k) => a + ((k.tokens && k.tokens.total) || 0), 0);
    const dn = segs.length
      ? '<div class="agy-dng" data-dng>' + donutSvg(segs, { size: 76, sw: 8, cv: fn(tk.total), cl: cacheRate.toFixed(1) + '%' }) + '</div>'
      : '<div class="agy-dn" style="width:76px;height:76px;display:flex;align-items:center;justify-content:center;color:var(--c-dim);font-size:10px">无 token</div>';
    return '<div class="agy-sc' + (isCur ? ' cur' : '') + '" data-open="' + esc(s.id) + '">' +
      '<div class="agy-sc-h"><div class="agy-sc-t" title="' + esc(sessName(s)) + '">' + (isCur ? '<span class="live"></span>' : '') + esc(sessName(s)) + '</div>' +
        '<div class="agy-sc-w"><b>' + esc(relTime(t)) + '</b>' + (Number.isFinite(t) ? dkey(t) : '') + '</div></div>' +
      '<div class="agy-tags">' +
        (isCur ? '<span class="agy-tag blue">当前</span>' : '') +
        ws.slice(0, 2).map((w) => '<span class="agy-tag agy-mono">' + esc(w) + '</span>').join('') +
        (s.isSubagent ? '<span class="agy-tag vio">子 Agent</span>' : '') +
        (kids.length ? '<span class="agy-tag vio" data-tip="' + esc('子 Agent ×' + kids.length + '\n合计 Token ' + fn(kidTok)) + '">子 Agent ×' + kids.length + '</span>' : '') +
        (!ws.length && !isCur && !s.isSubagent && !kids.length ? '<span class="agy-tag">未分组</span>' : '') +
      '</div>' +
      '<div class="agy-sc-m">' + dn +
        '<div class="agy-sc-kv">' +
          '<span>轮次</span><b>' + (tk.requests || 0) + ' 轮 · ' + (s.steps || 0) + ' 步</b>' +
          '<span>Token 总用量</span><b>' + fn(tk.total) + '</b>' +
          '<span>预估费用</span><b>' + (tk.costUSD ? usd(tk.costUSD) : '—') + '</b>' +
          '<span>上下文</span><b>' + (s.context && s.context.used ? fn(s.context.used) : '—') + '</b>' +
        '</div></div>' +
      '<div class="agy-sc-f"><span class="k">' + esc(s.shortId) + '</span>·<span>工具 ' + (s.toolTotal || 0) + '</span>·<span>' +
        dur(s.activeSeconds || 0) + '</span>' + (topModel ? '·<span style="overflow:hidden;text-overflow:ellipsis">' + esc(topModel[0]) + '</span>' : '') + '</div>' +
    '</div>';
  }

  /* ---- 命令执行明细 ---- */
  function cardExec(f) {
    const base = f.execRecords;
    let list = base.slice();
    const failed = list.filter((r) => r.failed).length;
    const slow = list.filter((r) => (r.durSec || 0) >= 10).length;
    const bg = list.filter((r) => r.bg).length;
    const totalSec = list.reduce((a, r) => a + (r.durSec || 0), 0);
    const all = list.length;
    const s = f.all.execSummary || {};
    if (EXEC_FILTER === 'failed') list = list.filter((r) => r.failed);
    else if (EXEC_FILTER === 'bg') list = list.filter((r) => r.bg);
    else if (EXEC_FILTER === 'slow') list = list.filter((r) => (r.durSec || 0) >= 10).sort((a, b) => (b.durSec || 0) - (a.durSec || 0));

    const slowest = base.slice().sort((a, b) => (b.durSec || 0) - (a.durSec || 0))[0];
    const fm = {};
    for (const r of base) if (r.failed) fm[r.prog || '工具'] = (fm[r.prog || '工具'] || 0) + 1;
    const failProg = sortEntries(fm)[0];
    const ddur = (v) => typeof v === 'number' && v > 0 ? (v >= 60 ? Math.floor(v / 60) + 'm' + Math.round(v % 60) + 's' : v + 's') : '—';

    const rows = list.slice(0, 100).map((r, idx) => {
      const icon2 = r.failed ? '✕' : (r.exitCode === 0 ? '✓' : (r.tool ? '▸' : '?'));
      const cls = r.failed ? 'fail' : (r.exitCode === 0 ? 'ok' : 'run');
      const txt = String(r.text || '').trim();
      const key = 'c' + (r.step || 0) + '_' + (r.at || '') + '_' + idx;
      const open = !!EXEC_EXPANDED[key];
      let h = '<div class="agy-cmd-row ' + cls + (open ? ' open' : '') + '" data-cmd="' + esc(key) + '">' +
        '<span class="agy-cmd-ico">' + icon2 + '</span>' +
        '<span class="agy-cmd-prog">' + esc(r.prog || '工具') + '</span>' +
        '<span class="agy-cmd-txt agy-mono" title="' + esc(txt.slice(0, 400)) + '">' + esc(txt.slice(0, 160)) + '</span>' +
        (r.bg ? '<span class="agy-cmd-tag">后台</span>' : '') +
        (r.lineCount ? '<span class="agy-cmd-meta">' + r.lineCount + ' 行</span>' : '') +
        '<span class="agy-cmd-meta" style="min-width:40px;text-align:right">' + ddur(r.durSec) + '</span>' +
        '<span class="agy-cmd-meta" style="min-width:70px;text-align:right">' + esc(r.at ? String(r.at).slice(5, 16).replace('T', ' ') : '') + '</span>' +
      '</div>';
      if (open) {
        h += '<div class="agy-cmd-detail"><div class="agy-cmd-dh"><span>命令 · ' + esc(r.session || '') + '</span><span>' + (r.lineCount || 0) + ' 行</span></div>' +
          '<pre class="agy-cmd-pre agy-mono">' + esc(txt) + '</pre>' +
          (r.output ? '<div class="agy-cmd-dh"><span>结果</span><span>' + ddur(r.durSec) + (r.exitCode != null ? ' · 退出码 ' + r.exitCode : '') + '</span></div>' +
          '<pre class="agy-cmd-pre agy-mono">' + esc(String(r.output).slice(0, 1500)) + '</pre>' : '') + '</div>';
      }
      return h;
    }).join('');

    return '<div class="agy-card s12" data-execcard>' +
      cardHead('term', '命令执行明细',
        '<div class="agy-seg sm">' + [['all', '全部 ' + all], ['failed', '失败 ' + failed], ['slow', '慢 ' + slow], ['bg', '后台 ' + bg]].map((x) =>
          '<button data-ef="' + x[0] + '" class="' + (EXEC_FILTER === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>') +
      '<div class="agy-csum">' +
        '<div><b>' + all + '</b><span>运行记录</span></div>' +
        '<div><b>' + dur(totalSec || s.totalSeconds || 0) + '</b><span>合计耗时</span></div>' +
        '<div><b class="bad">' + failed + '</b><span>失败' + (all ? ' · 成功率 ' + ((all - failed) / all * 100).toFixed(1) + '%' : '') + '</span></div>' +
        '<div><b class="ok">' + bg + '</b><span>后台运行</span></div>' +
      '</div>' +
      ((slowest && slowest.durSec) || failProg ? '<div class="agy-cn">' +
        (slowest && slowest.durSec ? '<div class="agy-cn-r"><span class="agy-cn-k">最慢</span><span class="agy-cn-v agy-mono">' +
          esc(String(slowest.text || '').slice(0, 120)) + '</span><span class="agy-cn-n">' + ddur(slowest.durSec) + '</span></div>' : '') +
        (failProg ? '<div class="agy-cn-r"><span class="agy-cn-k bad">失败最多</span><span class="agy-cn-v">' + esc(failProg[0]) +
          '</span><span class="agy-cn-n bad">×' + failProg[1] + '</span></div>' : '') + '</div>' : '') +
      '<div class="agy-cmd-list agy-scroll">' + (rows || '<div class="agy-empty">没有匹配的命令</div>') + '</div>' +
      '<div class="agy-ft">' + list.length + ' 条' + (list.length > 100 ? '（显示前 100）' : '') + ' · 点击行展开命令与输出 · 路径已脱敏</div>' +
    '</div>';
  }

  /* ==========================================================================
     总览浮层
     ========================================================================== */
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'agy-scope';
  root.innerHTML =
    '<div class="agy-mask" data-mask><div class="agy-box" role="dialog" aria-modal="true">' +
      '<div class="agy-hd"><div class="agy-hd-l"><div class="agy-hd-logo">' + logoHdHtml() + '</div>' +
        '<div style="min-width:0"><div class="agy-hd-t">上下文总览<span class="agy-hd-ver">v' + VER + '</span></div></div></div>' +
        '<div class="agy-hd-r">' +
            '<button class="agy-gear" data-settings title="设置">' + icon('gear') + '</button>' +
            '<div class="agy-seg" data-range>' +
          '<button data-r="7d">近 7 天</button><button data-r="30d">近 30 天</button><button data-r="all" class="on">全部</button>' +
        '</div><button class="agy-x" data-close title="关闭 (Esc)">×</button></div>' +
      '</div>' +
      '<div class="agy-body" data-body></div>' +
    '</div></div>';
  document.body.appendChild(root);

  const mask = root.querySelector('[data-mask]');
  const bodyEl = root.querySelector('[data-body]');
  const rangeEl = root.querySelector('[data-range]');

  function render() {
    const d = DATA;
    if (!d || d.error) {
      bodyEl.innerHTML = '<div class="agy-err">' + esc((d && d.error) || '无数据') + (d && d.detail ? '<br><small>' + esc(d.detail) + '</small>' : '') + '</div>';
      return;
    }
    const st = bodyEl.scrollTop;
    const f = filtered();

    bodyEl.innerHTML =
      cardKpis(f) + cardDaily(f) +
      cardToken(f) + cardTime(f) +
      cardHeat(f) + cardSkills(f) + cardTools(f) + cardProgs(f) +
      cardSessionsShell(f);
    renderSessions();
    bodyEl.scrollTop = st;
  }

  function rerenderExec() {
    const old = bodyEl.querySelector('[data-execcard]');
    if (!old) return render();
    const tmp = document.createElement('div');
    tmp.innerHTML = cardExec(filtered());
    old.replaceWith(tmp.firstElementChild);
  }

  function openSession(id, el) {
    const a = document.querySelector('a[href*="/c/' + id + '"]');
    if (a) { close(); a.click(); return; }
    try { navigator.clipboard.writeText(id); } catch (e) { /* ignore */ }
    if (el) {
      el.classList.add('flash');
      const f = el.querySelector('.agy-sc-f .k');
      const old = f ? f.textContent : '';
      if (f) f.textContent = '已复制会话 ID';
      setTimeout(() => { el.classList.remove('flash'); if (f) f.textContent = old; }, 1100);
    }
  }

  bodyEl.addEventListener('click', (e) => {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-hm]'))) { HEAT_METRIC = el.getAttribute('data-hm'); return render(); }
    if ((el = t.closest('[data-ssort]'))) {
      SSORT = el.getAttribute('data-ssort');
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      return renderSessions();
    }
    if ((el = t.closest('[data-sws]'))) { SWS = el.getAttribute('data-sws'); SLIMIT = 24; return renderSessions(); }
    if ((el = t.closest('[data-smore]'))) { SLIMIT += 24; return renderSessions(); }
    if ((el = t.closest('[data-open]'))) return openSession(el.getAttribute('data-open'), el);
    if ((el = t.closest('[data-ef]'))) { EXEC_FILTER = el.getAttribute('data-ef'); return rerenderExec(); }
    if ((el = t.closest('[data-cmd]'))) {
      const k = el.getAttribute('data-cmd');
      EXEC_EXPANDED[k] = !EXEC_EXPANDED[k];
      return rerenderExec();
    }
  });
  bodyEl.addEventListener('input', (e) => {
    if (e.target.matches('[data-sq]')) { SQ = e.target.value; SLIMIT = 24; renderSessions(); }
  });
  bodyEl.addEventListener('change', (e) => {
    if (e.target.matches('[data-sscope]')) { SSCOPE = e.target.value; SWS = ''; SLIMIT = 24; renderSessions(); }
  });

  function open() {
    render();
    mask.classList.add('on');
    requestAnimationFrame(() => { bodyEl.scrollTop = 0; });
  }
  function close() {
    mask.classList.remove('on');
    tip.classList.remove('on');
  }
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  root.querySelector('[data-close]').addEventListener('click', close);
  function onKey(e) { if (e.key === 'Escape' && mask.classList.contains('on')) close(); }
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  rangeEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    RANGE = b.getAttribute('data-r');
    rangeEl.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });

  /* ==========================================================================
     设置面板
     ========================================================================== */

  const settingsEl = root.querySelector('[data-settings]');
  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'agy-settings';
  settingsPanel.innerHTML =
    '<div class="agy-set-hd"><div class="agy-set-t">设置</div>' +
      '<button class="agy-set-x" data-set-close>×</button></div>' +
    '<div class="agy-set-r"><div class="agy-set-l">上下文窗口</div>' +
      '<select class="agy-set-sel" data-set-win>' +
        '<option value="200000">200K</option>' +
        '<option value="1000000">1.0M</option>' +
        '<option value="2000000">2.0M</option>' +
      '</select></div>' +
    '<div class="agy-set-r"><div class="agy-set-l">自动刷新</div>' +
      '<label class="agy-set-sw"><input type="checkbox" data-set-auto><span></span></label></div>' +
    '<div class="agy-set-r"><div class="agy-set-l">紧凑模式</div>' +
      '<label class="agy-set-sw"><input type="checkbox" data-set-compact><span></span></label></div>' +
    '<div class="agy-set-ft">' +
      '<div>版本 <b>v' + VER + '</b></div>' +
      '<div>agy-context · 本地统计，不联网</div>' +
      '<div style="margin-top:4px;color:var(--c-dim);font-size:10px">' +
        '路径已脱敏 · 费用为估算值</div></div>';
  root.querySelector('.agy-hd-r').appendChild(settingsPanel);

  function applyPrefs() {
    const w = root.querySelector('[data-set-win]');
    const a = root.querySelector('[data-set-auto]');
    const c = root.querySelector('[data-set-compact]');
    if (w) w.value = String(PREFS.winSize);
    if (a) a.checked = !!PREFS.autoRefresh;
    if (c) c.checked = !!PREFS.compact;
    document.documentElement.style.setProperty('--agy-win-size', String(PREFS.winSize));
    mask.classList.toggle('agy-compact', !!PREFS.compact);
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(PREFS)); } catch (e) { /* ignore */ }
  }

  settingsEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = settingsPanel.classList.toggle('on');
    settingsEl.classList.toggle('on', on);
  });
  settingsPanel.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-set-close]')) {
      settingsPanel.classList.remove('on');
      settingsEl.classList.remove('on');
    }
  });
  document.addEventListener('click', (e) => {
    if (!settingsPanel.classList.contains('on')) return;
    if (settingsPanel.contains(e.target) || settingsEl.contains(e.target)) return;
    settingsPanel.classList.remove('on');
    settingsEl.classList.remove('on');
  });
  root.querySelector('[data-set-win]').addEventListener('change', (e) => {
    PREFS.winSize = Number(e.target.value) || 1000000;
    savePrefs(); applyPrefs(); render();
  });
  root.querySelector('[data-set-auto]').addEventListener('change', (e) => {
    PREFS.autoRefresh = e.target.checked;
    savePrefs(); applyPrefs();
  });
  root.querySelector('[data-set-compact]').addEventListener('change', (e) => {
    PREFS.compact = e.target.checked;
    savePrefs(); applyPrefs();
  });
  applyPrefs();

  /* ==========================================================================
     侧边面板（当前会话）
     ========================================================================== */
  function sideBodyHtml(sess) {
    if (!sess) {
      return '<div class="agy-sd-card"><div class="agy-sd-ct">' + icon('chart') + '会话统计</div>' +
        '<div class="agy-sd-empty">暂未找到该会话的统计数据（新会话需等待几秒刷新）。</div>' +
        '<button class="agy-sd-btn" data-sd-open>' + icon('chart') + '打开总览</button></div>';
    }

    const d = DATA || {};
    const f = filtered();
    const tk = sess.tokens || {};
    const cacheRate = (tk.input + tk.cache) > 0 ? tk.cache / (tk.input + tk.cache) * 100 : 0;
    const speed = (sess.activeSeconds || 0) > 0 ? (tk.output || 0) / sess.activeSeconds : 0;

    /* ---- 会话头 ---- */
    const head = '<div class="agy-sd-head"><div class="agy-sd-head-m">' +
      '<div class="agy-sd-ht">' + esc(sessName(sess)) + '</div>' +
      '<div class="agy-sd-hm">' + esc(sess.shortId) + ' · ' + (sess.steps || 0) + ' 步' +
      (sess.isSubagent ? ' · 子 Agent' : '') + ' · ' + esc(relTime(sessTime(sess))) + '</div></div>' +
      '<button class="agy-sd-btn" data-sd-open title="打开上下文总览">' + icon('chart') + '总览</button></div>';

    /* ---- KPI 2x2 ---- */
    const k = (v, l, d2, tipText, acc) => '<div class="agy-sd-k" data-tip="' + esc(tipText) + '">' +
      '<div class="agy-sd-kv' + (acc ? ' acc' : '') + '">' + v + '</div>' +
      '<div class="agy-sd-kl">' + l + '</div><div class="agy-sd-kd">' + d2 + '</div></div>';
    const kpis = '<div class="agy-sd-kpis">' +
      k(fn(tk.total), 'Token 消耗', (tk.requests || 0) + ' 轮次',
        'Token 消耗\n输入 ' + fn(tk.input) + '\n输出 ' + fn(tk.output), true) +
      k(usd(tk.costUSD), '预估费用', '公开单价估算',
        '预估费用\n平均每轮 ' + usd(tk.requests ? tk.costUSD / tk.requests : 0)) +
      k(cacheRate.toFixed(1) + '%', '缓存命中', fn(tk.cache) + ' 读取',
        '缓存命中率\n缓存读取 ' + fn(tk.cache) + '\n未缓存输入 ' + fn(tk.input)) +
      k(dur(sess.activeSeconds || 0), '活跃时长', speed.toFixed(1) + ' tok/s',
        '活跃时长\n输出速度 ' + speed.toFixed(1) + ' tok/s') +
    '</div>';

    /* ---- 以下全部复刻主界面卡片，栅格自动塌成单列 ---- */
    const sec = (t) => '<div class="agy-sd-sec">' + esc(t) + '</div>';

    const body =
      '<div class="agy-sd-sec">当前会话 · <span data-notr>' + esc(sessName(sess)) + '</span></div>' +
      cardContext(sess) +
      cardContextEvents(sess) +
      cardFileActivity(sess) +
      sec('更多维度') +
      cardModels(f) +
      cardFileTypes(f) +
      cardHourly(f) +
      cardExec(f);

    return head + kpis + body;
  }

  /* 会话数据缓存：防止运行中因写入间隙返回 null 导致侧边栏闪烁切换到空卡片 */
  const sessionDataCache = new Map();

  /* 折叠标题栏：骨架固定，纯数据差量渲染 */
  function sideSkeletonHtml(sess) {
    const name = sess ? sessName(sess) : '会话统计';
    return '<div class="agy-sd">' +
      '<button type="button" class="agy-sd-bar' + (sideCollapsed ? '' : ' open') + '" data-sd-toggle>' +
        '<span class="agy-sd-caret">▸</span>' +
        '<span class="agy-sd-bar-t"><span class="agy-sd-bar-name" data-notr>' + esc(name) + '</span> · 上下文</span>' +
      '</button>' +
      '<div class="agy-sd-body' + (sideCollapsed ? ' collapsed' : '') + '">' +
        '<div class="agy-sd-content" data-sd-content>' + sideBodyHtml(sess) + '</div>' +
      '</div>' +
    '</div>';
  }

  function applySideCollapsed(host) {
    const bar = host.querySelector('.agy-sd-bar');
    const body = host.querySelector('.agy-sd-body');
    if (bar) bar.classList.toggle('open', !sideCollapsed);
    if (body) body.classList.toggle('collapsed', sideCollapsed);
  }

  function mountSideCard() {
    const panelBody = document.querySelector('[data-side-panel-body]');
    if (!panelBody) return false;
    const newTab = panelBody.querySelector('[data-testid="side-panel-new-tab-view"]');
    if (!newTab) return false;
    const sid = currentConvId();
    if (!sid) return false;

    let sess = sessionById(sid);
    if (sess) {
      sessionDataCache.set(sid, sess);
    } else {
      // 运行中若偶发读空，使用上一份有效数据，坚决不闪烁
      sess = sessionDataCache.get(sid) || null;
    }

    // 只用该会话自身的数字做版本号：其它会话变化 / 生成时间变化不会触发侧边卡片重绘
    const rev = VER + '|' + sid + '|' + (sess ? [
      (sess.tokens && sess.tokens.total) || 0, (sess.tokens && sess.tokens.requests) || 0, sess.steps || 0,
      sess.toolTotal || 0, Math.round(sess.activeSeconds || 0), (sess.context && sess.context.used) || 0, sess.title || '',
    ].join(',') : 'none');

    const host = document.getElementById(SIDE_ID);
    if (host && host.isConnected && newTab.contains(host)) {
      const innerTarget = newTab.querySelector('.w-full.max-w-xl');
      if (innerTarget && host.parentElement !== innerTarget) {
        innerTarget.insertAdjacentElement('afterbegin', host);
      }
      if (host.dataset.rev === rev) return true;
      if (host.querySelector('.hot')) return true; // 正在悬停交互，不打断

      // 仅差量更新内部数据与标题，外层折叠按钮与容器骨架绝不推倒重建
      const nameEl = host.querySelector('.agy-sd-bar-name');
      if (nameEl) nameEl.textContent = sess ? sessName(sess) : '会话统计';

      const contentEl = host.querySelector('[data-sd-content]');
      if (contentEl) {
        contentEl.innerHTML = sideBodyHtml(sess);
      }
      host.dataset.rev = rev;
      return true;
    }
    if (host) host.remove();

    const el = document.createElement('div');
    el.id = SIDE_ID;
    el.className = 'agy-scope';
    el.dataset.rev = rev;
    el.innerHTML = sideSkeletonHtml(sess);
    if (window.__agyI18n && window.__agyI18n.watch) window.__agyI18n.watch(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-sd-toggle]')) {
        e.preventDefault();
        sideCollapsed = !sideCollapsed;
        writeSetting(SIDE_COLLAPSE_KEY, sideCollapsed ? '1' : '0');
        applySideCollapsed(el);
        return;
      }
      if (e.target.closest('[data-sd-open]')) { e.preventDefault(); open(); }
    });

    const inner = newTab.querySelector('.w-full.max-w-xl');
    if (inner) {
      inner.insertAdjacentElement('afterbegin', el);
    } else {
      newTab.insertAdjacentElement('afterbegin', el);
    }
    return true;
  }

  function mountMenuItem() {
    if (document.getElementById(ITEM_ID)) return true;
    const nav = document.querySelector('[data-testid="sidebar-navigation-items"]');
    if (!nav) return false;
    let anchor = nav.querySelector('a[href="/customizations"]');
    if (!anchor) {
      anchor = Array.prototype.find.call(nav.querySelectorAll('a,button'), (el) => /customizations/i.test(el.textContent || ''));
    }
    const item = document.createElement('button');
    item.id = ITEM_ID;
    item.className = anchor ? anchor.className :
      'agy-button agy-button-custom inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer ' +
      'flex-grow w-full justify-start font-normal min-w-0 gap-1.5 px-2 rounded-lg py-1.5 bg-transparent text-secondary-foreground hover:bg-sidebar-muted';
    item.type = 'button';
    item.title = '上下文总览';
    item.innerHTML = '<span class="agy-mi">' + logoMiHtml() + '</span><span>上下文总览</span>';
    item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); });
    if (anchor && anchor.parentElement === nav) anchor.insertAdjacentElement('afterend', item);
    else nav.appendChild(item);
    return true;
  }

  /* ==========================================================================
     数据更新 / 生命周期
     ========================================================================== */
  window.__agyCtxVer = VER;
  window.__agyCtxDataHash = (DATA && DATA.dataHash) || '';
  window.__agyCtxUpdate = function (d) {
    if (!d) return;
    const same = d.dataHash && DATA && d.dataHash === DATA.dataHash;
    DATA = d;
    window.__agyCtxDataHash = d.dataHash || '';
    if (same) return;
    // 浮层打开、开启了自动刷新、且用户没在悬停/输入时才重绘，避免打断交互
    if (mask.classList.contains('on') && PREFS.autoRefresh !== false) {
      const busy = bodyEl.querySelector('.hot') || (document.activeElement && bodyEl.contains(document.activeElement) && document.activeElement.matches('input,select'));
      if (!busy) render();
    }
    mountSideCard();
  };
  window.__agyCtxOpen = open;
  const timers = [];
  let tries = 0;
  timers.push(setInterval(() => { tries++; if (mountMenuItem() || tries > 40) clearInterval(timers[0]); }, 400));
  mountMenuItem();

  let sideTimer = null;
  const mo = new MutationObserver(() => {
    if (!document.getElementById(ITEM_ID)) mountMenuItem();
    if (sideTimer) return;
    sideTimer = setTimeout(() => { sideTimer = null; mountSideCard(); }, 500);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  let lastPath = location.pathname;
  timers.push(setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      mountSideCard();
    }
  }, 700));
  timers.push(setTimeout(mountSideCard, 600));

  window.__agyCtxDispose = function () {
    mo.disconnect();
    timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
    cleanups.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    [ROOT_ID, ITEM_ID, SIDE_ID, TIP_ID, STYLE_ID].forEach((id) => { const n = document.getElementById(id); if (n) n.remove(); });
    delete window.__agyCtxUpdate;
    delete window.__agyCtxOpen;
    delete window.__agyCtxVer;
    delete window.__agyCtxDispose;
  };

  return 'injected v' + VER;
})()
