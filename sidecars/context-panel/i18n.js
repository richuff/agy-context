/**
 * i18n.js — agy-context 国际化（零侵入 DOM 后处理方案）
 *
 * 由 main.mjs 追加到注入脚本末尾，独立执行。
 * 不修改 panel.js 任何源码，只遍历插件自己容器内的文本节点做 中→英 替换。
 *
 * 默认英文；语言选择存 localStorage(agy-context:lang)。
 * 切换语言时：英文=翻译，中文=恢复原文（WeakMap 保存）。
 * 只在插件自身的 root / side / item 三个容器内翻译，绝不动 Antigravity 宿主界面。
 */
(() => {
  if (window.__agyI18nReady) {
    window.__agyI18n.apply();
    window.__agyI18n.injectControls();
    return;
  }

  /* ---------------- 中→英 词典（长词优先，运行时按长度降序） ---------------- */
  var M = {
    // 品牌 / 标题
    "近 7 天": "Last 7 days",
    "近 30 天": "Last 30 days",
    "近 14 天用量": "Last 14 days",
    "14 天用量": "14 days usage",
    "上下文总览": "Context Overview",
    "会话统计": "Session Stats",
    "会话": "Conversations",
    "当前会话 ·": "Current session ·",
    "更多维度": "More dimensions",
    "当前上下文": "Current Context",
    "上下文事件": "Context Events",
    "文件活动": "File Activity",
    "文件类型": "File Types",
    "活跃时段": "Hourly Activity",
    "活跃度": "Activity",
    "每日用量": "Daily Usage",
    "模型分布": "Models",
    "命令执行明细": "Command details",
    "命令执行": "Command Execution",
    "技能加载": "Skills Loaded",
    "工具调用": "Tool Calls",
    "耗时统计": "Time Breakdown",
    "Token 统计": "Token Breakdown",
    "Token 消耗": "Token usage",
    "Token 总用量": "Total tokens",
    "预估费用": "Est. cost",
    "缓存命中": "Cache hit",
    "缓存读取": "Cache read",
    "活跃时长": "Active time",
    "全部会话": "Conversations",
    "会话累计 · 输出速度": "Session total · Output speed",
    "当前会话": "Current session",

    // KPI / 副标题
    "按公开单价估算，仅供参考": "Estimated from public pricing, for reference only",
    "按公开单价估算": "From public pricing",
    "公开单价估算": "Public pricing",
    "平均每轮": "Avg per round",
    "平均输出速度": "Avg output speed",
    "输出速度": "Output speed",
    "缓存命中率": "Cache hit rate",
    "缓存读取 / (输入 + 缓存读取)": "Cache read / (input + cache read)",
    "输入（未缓存）": "Input (uncached)",
    "未缓存输入": "Uncached input",
    "总吞吐": "Throughput",
    "轮次": "rounds",
    "步数": "steps",
    "次请求": "requests",
    "次调用": "calls",
    "次加载": "loads",
    "次执行": "runs",
    "次 · ": "× ",
    "个会话": "conversations",
    "个工具": "tools",
    "个技能": "skills",
    "个程序": "programs",
    "个模型": "models",
    "个文件": "files",
    "种工具": "tool types",
    "读取": "cached",

    // 上下文构成
    "系统提示词": "System prompt",
    "工具定义": "Tool definitions",
    "用户消息": "User messages",
    "注入内容": "Injected",
    "技能注入": "Skill injection",
    "助手消息": "Assistant msgs",
    "模型思考": "Model thinking",
    "工具结果": "Tool results",

    // 耗时构成
    "工具执行": "Tool execution",
    "模型回复": "Model reply",
    "等待输入": "Awaiting input",
    "等待用户输入": "Awaiting user input",
    "系统开销": "System overhead",

    // 事件类型
    "系统消息": "System msg",
    "工具输出": "Tool output",
    "模型响应": "Model resp.",
    "用户输入": "User input",

    // 命令执行
    "运行记录": "Runs",
    "合计耗时": "Total time",
    "成功率": "success rate",
    "退出码": "exit code",
    "后台运行": "Background",
    "后台": "Background",
    "失败最多": "Most failures",
    "值得注意": "Worth noting",
    "最慢": "Slowest",
    "失败": "Failed",
    "慢": "Slow",
    "全部": "All",
    "最新": "Newest",
    "命令": "Command",
    "结果": "Result",
    "合计": "Total",
    "占比": "share",
    "峰值": "Peak",
    "高峰": "Peak",
    "其他": "Other",
    "字符": "chars",
    "退出码 ": "exit ",
    "成功率 ": "success ",

    // 会话
    "主会话（子 Agent 折叠）": "Main (sub-agents folded)",
    "全部会话（含子 Agent）": "All (incl. sub-agents)",
    "仅子 Agent": "Sub-agents only",
    "主会话": "Main",
    "子 Agent": "Sub-agent",
    "最近更新": "Recently updated",
    "未分组": "Ungrouped",
    "(未命名)": "(Untitled)",
    "当前": "current",
    "会话 ID": "Session ID",
    "已复制会话 ID": "Session ID copied",
    "点击跳转": "Click to jump",
    "找不到则复制 ID": "Copy ID if not found",
    "没有匹配的会话": "No matching conversations",
    "没有匹配的命令": "No matching commands",
    "暂无文件操作": "No file operations",
    "暂无数据": "No data",
    "无数据": "No data",
    "（显示前 100）": "(top 100)",

    // 文件 badge
    "写": "W",
    "改": "E",
    "读": "R",

    // 设置面板（已有）
    "设置": "Settings",
    "上下文窗口": "Context window",
    "自动刷新": "Auto refresh",
    "紧凑模式": "Compact mode",
    "版本": "Version",
    "路径已脱敏 · 费用为估算值": "Paths redacted · Cost estimated",
    "agy-context · 本地统计，不联网": "agy-context · Local only, no network",

    // 侧边
    "打开上下文总览": "Open context overview",
    "打开总览": "Open overview",
    "总览": "Overview",
    "暂未找到该会话的统计数据（新会话需等待几秒刷新）。": "No stats yet for this session (new sessions take a few seconds).",
    "本次会话没有压缩或剪枝记录": "No compaction or pruning in this session",

    // 说明性长句（tooltip / footer）
    "上下文 = 最后一次请求的输入（含缓存）。分项按字符占比估算。": "Context = input of last request (cache incl.). Segments estimated by char share.",
    "上下文 = 最后一次请求的输入（含缓存）；分项按字符占比估算。": "Context = input of last request (cache incl.); Segments estimated by char share.",
    "最后一次请求的输入（含缓存）": "Input of last request (cache incl.)",
    "记录内容被截断（truncated_fields）的事件，代表上下文被压缩。": "Records where content was truncated (truncated_fields), indicating context compaction.",
    "悬停环形图或图例查看各项；Token 吞吐 = 输入 + 输出（不含缓存读取）。": "Hover donut or legend to inspect segments. Throughput = input + output (cache excluded).",
    "按 transcript 时间戳分类：工具执行 / 模型生成 / 等待用户输入 / 系统开销。": "Classified from transcript timestamps: tool exec / model gen / awaiting input / system overhead.",
    "排行中点击程序可筛选 · 路径已脱敏": "Click a program to filter · paths redacted",
    "数据来自 transcript 的 tool_calls 与 GENERIC 记录。路径已脱敏。": "From transcript tool_calls and GENERIC records. Paths redacted.",
    "最后一次请求的输入": "Input of last request",
    "分项按字符占比估算": "Segments estimated by char share",
    "按公开单价估算，仅供参考": "Estimated from public pricing, for reference only",

    // 我追加的设置控件
    "外观与行为": "Appearance & behavior",
    "语言": "Language",
    "界面缩放": "UI scale",
    "显示侧边卡片": "Side panel card",
    "显示侧边栏入口": "Sidebar menu",
    "恢复默认": "Reset",
    "已恢复默认设置": "Settings reset",

    // 时间
    // 量词 / 短词（长词已优先匹配，这些放最后靠长度排序兜底）
    "条": " events",
    "次": "×",
    "个": "",
    "行": " lines",
    "共 ": "Total ",
    "共": "Total",
    "文档": "Docs",
    "其他": "Other",
    "字符": "chars",
    "种": "types",
    "轮": " rounds",
    "步": " steps",
    "读取": "cached",
    "（含缓存）": " (cache incl.)",
    "；": "; ",

    "刚刚": "just now",
    "天用量": "d usage",
    "天 · 最长连续": "d · Longest streak",
    "天": "d",
    "分钟前": "m ago",
    "小时前": "h ago",
    "天前": "d ago",
    "天用量": "d usage",
    "最长连续": "Longest streak",
    "少": "Less",
    "多": "More",
    "近 ": "Last ",
    "工具": "tool",
    "输入": "Input",
    "输出": "Output",
    "轮": " rounds",
    "步": " steps",
  };

  var PAIRS = Object.keys(M)
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (k) { return [k, M[k]]; });

  function trText(s) {
    for (var i = 0; i < PAIRS.length; i++) {
      var a = PAIRS[i][0];
      if (s.indexOf(a) >= 0) s = s.split(a).join(PAIRS[i][1]);
    }
    return s;
  }

  /* ---------------- 状态 ---------------- */
  var LANG_KEY = 'agy-context:lang';
  var ZOOM_KEY = 'agy-context:zoom';
  var SIDE_KEY = 'agy-context:side';
  var MENU_KEY = 'agy-context:menu';

  function readLS(k, def) { try { var v = localStorage.getItem(k); return v === null ? def : v; } catch (e) { return def; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var lang = readLS(LANG_KEY, 'en');                 // 默认英文
  if (lang !== 'zh' && lang !== 'en') lang = 'en';
  var zoom = readLS(ZOOM_KEY, '100');
  var showSide = readLS(SIDE_KEY, '1') !== '0';
  var showMenu = readLS(MENU_KEY, '1') !== '0';

  var ROOTS = ['__agy_ctx_root_v3__', '__agy_ctx_side_v3__', '__agy_ctx_item_v3__'];
  var savedText = new WeakMap();   // textNode -> original string
  var savedAttr = new WeakMap();   // element -> {attr: original}
  var ATTRS = ['data-tip', 'title', 'placeholder'];
  var CN = /[\u4e00-\u9fa5]/;

  function eachRoot(fn) {
    for (var i = 0; i < ROOTS.length; i++) {
      var r = document.getElementById(ROOTS[i]);
      if (r) fn(r);
    }
  }

  function walkText(root, fn) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while ((n = w.nextNode())) fn(n);
  }
  function walkEl(root, fn) {
    fn(root);
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) fn(all[i]);
  }

  /* ---------------- 翻译 / 还原 ---------------- */
  function translateNode(n) {
    var v = n.nodeValue;
    if (!v || !CN.test(v)) return;
    if (!savedText.has(n)) savedText.set(n, v);
    var t = trText(v);
    if (t !== v) n.nodeValue = t;
  }
  function translateElAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute(a);
      if (!v || !CN.test(v)) continue;
      var rec = savedAttr.get(el);
      if (!rec) { rec = {}; savedAttr.set(el, rec); }
      if (!(a in rec)) rec[a] = v;
      var t = trText(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
  function translateAll() {
    eachRoot(function (r) {
      walkText(r, translateNode);
      walkEl(r, translateElAttrs);
    });
  }
  function restoreAll() {
    eachRoot(function (r) {
      walkText(r, function (n) {
        var o = savedText.get(n);
        if (o !== undefined && n.nodeValue !== o) n.nodeValue = o;
      });
      walkEl(r, function (el) {
        var rec = savedAttr.get(el);
        if (!rec) return;
        for (var a in rec) if (el.getAttribute(a) !== rec[a]) el.setAttribute(a, rec[a]);
      });
    });
  }

  /* ---------------- 视觉设置 ---------------- */
  function applyZoom() {
    document.body.classList.remove('agy-i18n-z90', 'agy-i18n-z110');
    if (zoom === '90') document.body.classList.add('agy-i18n-z90');
    else if (zoom === '110') document.body.classList.add('agy-i18n-z110');
  }
  function applyVisibility() {
    var side = document.getElementById('__agy_ctx_side_v3__');
    if (side) side.style.display = showSide ? '' : 'none';
    var item = document.getElementById('__agy_ctx_item_v3__');
    if (item) item.style.display = showMenu ? '' : 'none';
  }

  /* ---------------- 样式 ---------------- */
  function injectStyle() {
    if (document.getElementById('__agy_i18n_style__')) return;
    var st = document.createElement('style');
    st.id = '__agy_i18n_style__';
    st.textContent = [
      'body.agy-i18n-z90 .agy-box,body.agy-i18n-z90 #__agy_ctx_side_v3__{zoom:.9}',
      'body.agy-i18n-z110 .agy-box,body.agy-i18n-z110 #__agy_ctx_side_v3__{zoom:1.1}',
      '.agy-set-i18n{border-top:1px solid var(--c-line);margin-top:8px;padding-top:8px}',
      '.agy-set-grp{font-size:9.5px;font-weight:660;color:var(--c-dim);letter-spacing:.5px;',
      'text-transform:uppercase;margin:8px 0 3px}',
      '.agy-set-grp:first-child{margin-top:0}',
      '.agy-set-r{display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:11.5px}',
      '.agy-set-l{color:var(--c-fg2)}',
      '.agy-i18n-seg{display:flex;gap:2px;background:var(--c-soft);padding:2px;border-radius:7px;border:1px solid var(--c-line)}',
      '.agy-i18n-seg button{border:none;background:transparent;font:inherit;font-size:10.5px;padding:2px 8px;',
      'border-radius:5px;cursor:pointer;color:var(--c-mut)}',
      '.agy-i18n-seg button.on{background:var(--c-fg);color:var(--c-card);font-weight:600}',
      '.agy-set-sw{position:relative;display:inline-flex;cursor:pointer}',
      '.agy-set-sw input{position:absolute;opacity:0;width:0;height:0}',
      '.agy-set-sw span{width:30px;height:17px;border-radius:9px;background:#d7dce6;transition:background .16s;position:relative;display:block}',
      '.agy-set-sw span::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;',
      'background:#fff;transition:transform .16s;box-shadow:0 1px 3px rgba(16,18,24,.2)}',
      '.agy-set-sw input:checked + span{background:var(--c-accent)}',
      '.agy-set-sw input:checked + span::after{transform:translateX(13px)}',
      '.agy-set-reset{border:1px solid var(--c-line);background:var(--c-card);border-radius:6px;',
      'padding:3px 9px;font:inherit;font-size:10.5px;cursor:pointer;color:var(--c-mut);margin-top:8px;width:100%}',
      '.agy-set-reset:hover{color:var(--c-fg);border-color:#c8d2e4}',
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------- 设置面板注入控件 ---------------- */
  function injectControls() {
    var box = document.querySelector('.agy-settings');
    if (!box || box.querySelector('.agy-set-i18n')) return;

    var d = document.createElement('div');
    d.className = 'agy-set-i18n';
    d.innerHTML =
      '<div class="agy-set-grp">外观与行为</div>' +
      '<div class="agy-set-r"><span class="agy-set-l">语言</span>' +
        '<span class="agy-i18n-seg" data-i="lang">' +
          '<button data-v="en"' + (lang === 'en' ? ' class="on"' : '') + '>EN</button>' +
          '<button data-v="zh"' + (lang === 'zh' ? ' class="on"' : '') + '>中文</button>' +
        '</span></div>' +
      '<div class="agy-set-r"><span class="agy-set-l">界面缩放</span>' +
        '<span class="agy-i18n-seg" data-i="zoom">' +
          '<button data-v="90"' + (zoom === '90' ? ' class="on"' : '') + '>90%</button>' +
          '<button data-v="100"' + (zoom === '100' ? ' class="on"' : '') + '>100%</button>' +
          '<button data-v="110"' + (zoom === '110' ? ' class="on"' : '') + '>110%</button>' +
        '</span></div>' +
      '<div class="agy-set-r"><span class="agy-set-l">显示侧边卡片</span>' +
        '<label class="agy-set-sw"><input type="checkbox" data-i="side"' + (showSide ? ' checked' : '') + '><span></span></label></div>' +
      '<div class="agy-set-r"><span class="agy-set-l">显示侧边栏入口</span>' +
        '<label class="agy-set-sw"><input type="checkbox" data-i="menu"' + (showMenu ? ' checked' : '') + '><span></span></label></div>' +
      '<button class="agy-set-reset" data-i="reset">恢复默认</button>';
    box.appendChild(d);

    d.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('.agy-i18n-seg button');
      if (b) {
        var group = b.parentElement.getAttribute('data-i');
        var v = b.getAttribute('data-v');
        if (group === 'lang') {
          lang = v; writeLS(LANG_KEY, lang);
          window.__agyI18n.apply();
          window.__agyI18n.injectControls();
          return;
        }
        if (group === 'zoom') {
          zoom = v; writeLS(ZOOM_KEY, zoom); applyZoom();
          d.querySelectorAll('[data-i="zoom"] button').forEach(function (x) { x.classList.toggle('on', x === b); });
          return;
        }
      }
      var r = e.target.closest('[data-i="reset"]');
      if (r) {
        lang = 'en'; zoom = '100'; showSide = true; showMenu = true;
        writeLS(LANG_KEY, lang); writeLS(ZOOM_KEY, zoom);
        writeLS(SIDE_KEY, '1'); writeLS(MENU_KEY, '1');
        applyZoom(); applyVisibility(); apply(); injectControls();
      }
    });
    d.addEventListener('change', function (e) {
      var el = e.target;
      if (!el.hasAttribute || !el.hasAttribute('data-i')) return;
      var k = el.getAttribute('data-i');
      if (k === 'side') { showSide = el.checked; writeLS(SIDE_KEY, showSide ? '1' : '0'); applyVisibility(); }
      else if (k === 'menu') { showMenu = el.checked; writeLS(MENU_KEY, showMenu ? '1' : '0'); applyVisibility(); }
    });
  }

  /* ---------------- 应用 ---------------- */
  function apply() {
    if (lang === 'en') translateAll();
    else restoreAll();
    applyZoom();
    applyVisibility();
    // 同步语言按钮高亮
    var seg = document.querySelector('.agy-set-i18n [data-i="lang"]');
    if (seg) seg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === lang);
    });
  }

  /* ---------------- 同步翻译：消除 5 秒刷新时的中→英闪烁 ----------------
   * 根因：panel.js 每 5 秒用中文重建 DOM；MutationObserver 原本把翻译包在
   * 80ms 的 setTimeout（宏任务，在浏览器"绘制之后"才执行）里，于是每轮都
   * 「先把中文画出来，80ms 后再切成英文」，肉眼可见地一闪。
   *
   * 修复：MutationObserver 的回调本身就是微任务，按 HTML 规范在浏览器绘制
   * 之前执行。直接在回调里"同步"翻译，译文会在同一帧绘制前落地，不经过
   * 任何"中文可见"的中间态，因此不闪。
   *
   * 守卫：translating 防止翻译自身触发的 DOM 变动造成重入；翻译完成后页面
   * 已无中文，后续回调里的 translateAll 是空操作，循环自然终止。
   * injectControls 自带存在性判断，不会重复追加，同样会收敛。
   * ------------------------------------------------------------------ */
  var translating = false;
  function applyNow() {
    if (translating) return;
    translating = true;
    try {
      if (lang === 'en') translateAll();
      injectControls();
    } finally {
      translating = false;
    }
  }

  var mo = new MutationObserver(function () { applyNow(); });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });

  /* ---------------- 初始化 ---------------- */
  injectStyle();
  window.__agyI18n = {
    apply: function () { applyNow(); },
    injectControls: injectControls,
    translateAll: translateAll
  };
  window.__agyI18nReady = true;
  // 延迟一点，等 panel.js 把 DOM mount 完（此后由 MutationObserver 同步接管）
  setTimeout(applyNow, 80);
})();
