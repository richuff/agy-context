/**
 * i18n.js — agy-context 国际化（零侵入 DOM 后处理方案）
 *
 * 由 main.mjs 追加到注入脚本末尾，独立执行。
 * 不修改 panel.js 任何源码，只遍历插件自己容器内的文本节点做 中→英 替换。
 *
 * 默认英文；语言选择存 localStorage(agy-context:lang)。
 * 切换语言时：英文=翻译，中文=恢复原文（WeakMap 保存）。
 * 只在插件自身的 root / side / item / tip 四个容器内翻译，绝不动 Antigravity 宿主界面。
 * tip（浮动提示）挂在 body 下、hover 时才写入内容，必须一并纳入观察范围。
 */
(() => {
  if (window.__agyI18nReady) {
    window.__agyI18n.apply();
    return 'i18n-ready';
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
    "工具输入": "Tool input",
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
    "错误消息": "Error msg",
    "检查点": "Checkpoint",
    "上下文截断": "Context truncation",
    "系统本地时区": "System local time",
    "全部事件": "All events",
    "其他类型": "Other types",
    "搜索工具输入输出、模型响应、系统消息…": "Search tool input/output, model responses, system messages…",
    "内容过长，已截取前 6000 字符": "Content is long; showing the first 6,000 characters",
    "没有匹配的上下文事件": "No matching context events",
    "本次会话没有可查询的 transcript 事件": "No searchable transcript events in this session",
    "点击事件可查看完整内容": "Click an event to view its full content",
    "（无文本内容）": "(No text content)",
    "匹配 ": "Matches ",
    "（显示最新 100 条）": "(showing latest 100)",

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
    "写入": "Write",
    "修改": "Edit",
    "步骤 ": "Step ",
    "第 ": "Line ",
    " 行起": " onward",
    "变更内容过长，仅显示前 120 行": "Change is long; showing the first 120 lines",
    "原始日志已截断，缺少 ": "Source log truncated; missing ",
    " 字节": " bytes",
    "仅显示最近 10 次修改": "Showing the 10 most recent edits",
    "工具记录中没有修改前后的文本片段": "The tool record did not include the before/after text",
    "本次会话只记录了文件读取，没有可展示的增删行": "This session only recorded reads; no changed lines are available",

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

    /* ---- 补漏：hover 提示 / 搜索栏 / 图表内残留 ----
     * 这些文本由 panel.js 拼接生成，或长句与字典旧条目不一致（如「吞吐」vs「消耗」），
     * 导致整条长句匹配失败、只留下孤立中文词。按「确切长句优先 + 独立词兜底」补齐。
     * ---------------------------------------------------------------- */
    // 悬停说明长句（实际源码用「Token 消耗」，旧条目误写为「Token 吞吐」）
    "悬停环形图或图例查看各项；Token 消耗 = 输入 + 输出（不含缓存读取）。": "Hover donut or legend to inspect segments. Throughput = input + output (cache excluded).",
    "悬停环形图或图例查看各项": "Hover donut or legend to inspect segments",
    "不含缓存读取": "cache excluded",
    "（不含缓存读取）": " (cache excluded)",
    // 费用（图表图例 / tooltip / footer 里单独出现）
    "费用（按公开单价估算）": "Cost (from public pricing)",
    "费用为估算值": "Cost estimated",
    "费用": "Cost",
    // 命令明细 footer
    "点击行展开命令与输出": "Click a row to expand command & output",
    // 星期（' 周' + WD[r] 拼出 周二/周三…，先于单字兜底匹配）
    "周一": "Mon", "周二": "Tue", "周三": "Wed", "周四": "Thu",
    "周五": "Fri", "周六": "Sat", "周日": "Sun",
    // 热力图 / 柱状图 tooltip 里的独立词
    "活跃 天": " active days",
    "最长连续": "Longest streak",
    "活跃天数": "Active days",
    "活跃": "Active",          // 落单兜底（长词「活跃时段/活跃度/活跃时长」已优先匹配）
    "个 · 费用": " · Cost",
    " 个 · 费用 ": " · Cost ",
    "记录": " records",
    // 搜索框 placeholder（整句精确匹配，避免误伤用户数据里的同名词）
    "搜索标题 / 工作区 / 会话 ID / 模型…": "Search title / workspace / session ID / model…",
    // 关闭按钮 title
    "关闭 (Esc)": "Close (Esc)",
    // 卡片 / 图例零散词
    "显示更多（还有": "Show more (",
    "显示前 100": "top 100",
    "模型生成": "model gen",
    "合计 Token": "Total tokens",
    "路径已脱敏": "Paths redacted",
    // 全角标点（无汉字、CN 不抓，但视觉仍是中文符号）
    "（显示前 100）": "(top 100)",
    "（还有": " (",
    "）": ")",
    "（": " (",
    "；": "; ",
    "，": ", ",
    "暂未找到该会话的统计数据": "No stats yet for this session",
    "新会话需等待几秒刷新": "new sessions take a few seconds",
    // 侧边卡片 / 页脚 / 长句拆解后的独立词
    "上下文": "Context",           // 落单兜底（长词「当前上下文/上下文总览」已优先匹配）
    "不含": "excl.",
    "无 token": "No token",
  };

  /* 单次正则替换：长词优先（按长度降序拼进交替分支），一次扫描完成，比逐词 split/join 快一个数量级 */
  var KEYS = Object.keys(M).sort(function (a, b) { return b.length - a.length; });
  var RE = new RegExp(KEYS.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
  var cache = new Map();
  function trText(s) {
    var hit = cache.get(s);
    if (hit !== undefined) return hit;
    var out = s.replace(RE, function (m) { return M[m]; });
    if (cache.size > 4000) cache.clear();
    cache.set(s, out);
    return out;
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

  // 浮动提示容器挂在 document.body 下、不属于上面三个根节点；
  // hover 时 panel.js 用 tip.innerHTML 写入中文（来自 data-tip），必须一并纳入
  // 观察与翻译范围，否则 tooltip 里会残留中文。
  var ROOTS = ['__agy_ctx_root_v3__', '__agy_ctx_side_v3__', '__agy_ctx_item_v3__', '__agy_ctx_tip_v3__'];
  var savedText = new WeakMap();   // textNode -> original string
  var savedAttr = new WeakMap();   // element -> {attr: original}
  var ATTRS = ['data-tip', 'title', 'placeholder', 'data-n', 'data-v', 'data-def'];
  // 用户内容（会话标题、命令、路径、工作区名等）不翻译，避免“编程会话”被改成“编程Conversations”
  var SKIP = '[data-notr],.agy-mono,.agy-sc-t,.agy-sd-ht,.agy-fa-nm,.agy-fa-dir,.agy-hd-s,code,pre,input,textarea';
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
  function skipped(el) { return !!(el && el.closest && el.closest(SKIP)); }
  // 热力图轴标签：左侧 7 行是 WD 的单字（一…日），顶部是「11月」。
  // 单字若进全局字典会误伤用户数据（如会话标题里的「日」），故按容器定向处理。
  var WD_MAP = { '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat', '日': 'Sun' };
  function axisText(n) {
    var p = n.parentElement;
    if (!p) return null;
    if (p.classList && p.classList.contains('agy-hw')) {
      var k = n.nodeValue.trim();
      return WD_MAP[k] || null;                 // 单字星期 → Mon…Sun
    }
    if (p.classList && p.classList.contains('agy-hm')) {
      return n.nodeValue.replace(/月/g, '');   // 「11月」→「11」
    }
    return null;
  }
  function translateNode(n) {
    var v = n.nodeValue;
    if (!v || !CN.test(v)) return;
    if (skipped(n.parentElement)) return;
    var ax = axisText(n);
    if (ax !== null) {
      if (!savedText.has(n)) savedText.set(n, v);
      if (ax !== v) n.nodeValue = ax;
      return;
    }
    if (!savedText.has(n)) savedText.set(n, v);
    var t = trText(v);
    if (t !== v) n.nodeValue = t;
  }
  function translateElAttrs(el) {
    if (!el.getAttribute) return;
    var sk = null;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute(a);
      if (!v || !CN.test(v)) continue;
      if (sk === null) sk = skipped(el);
      if (sk && a === 'title') continue;
      var rec = savedAttr.get(el);
      if (!rec) { rec = {}; savedAttr.set(el, rec); }
      if (!(a in rec)) rec[a] = v;
      var t = trText(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
  function translateTree(r) {
    if (r.nodeType === 3) { translateNode(r); return; }
    if (r.nodeType !== 1) return;
    walkText(r, translateNode);
    walkEl(r, translateElAttrs);
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
  function apply() { window.__agyI18n.apply(); }
  function syncSeg() {
    // 同步语言按钮高亮
    var seg = document.querySelector('.agy-set-i18n [data-i="lang"]');
    if (seg) seg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === lang);
    });
  }

  /* ---------------- 同步翻译（只观察插件自己的容器） ----------------
   * 旧实现在 document.body 上开 subtree 观察，Antigravity 聊天流每次 DOM 变化
   * 都会触发对插件全部节点的完整遍历，是卡顿主因之一。
   * 现在：只观察插件自己的 3 个根节点，且只翻译变动记录里新增/改动的节点。
   * MutationObserver 回调是微任务，在绘制前执行，所以不会闪出中文。
   * 自身改动产生的记录用 takeRecords() 丢弃，避免循环。
   * ------------------------------------------------------------------ */
  var watched = new WeakSet();
  var mo = new MutationObserver(function (records) {
    if (lang !== 'en') { injectControls(); return; }
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length; j++) translateTree(r.addedNodes[j]);
      } else if (r.type === 'characterData') {
        translateNode(r.target);
      } else if (r.type === 'attributes') {
        translateElAttrs(r.target);
      }
    }
    injectControls();
    mo.takeRecords();
  });
  function watch(el) {
    if (!el || watched.has(el)) return;
    watched.add(el);
    mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    if (lang === 'en') { translateTree(el); mo.takeRecords(); }
  }
  function watchRoots() { eachRoot(watch); }
  function applyNow() {
    watchRoots();
    if (lang === 'en') translateAll(); else restoreAll();
    injectControls();
    mo.takeRecords();
  }

  /* ---------------- 初始化 ---------------- */
  injectStyle();
  window.__agyI18n = {
    apply: function () { applyNow(); applyZoom(); applyVisibility(); syncSeg(); },
    injectControls: injectControls,
    translateAll: translateAll,
    watch: watch,
    t: function (s) { return lang === 'en' ? trText(String(s)) : String(s); },
    lang: function () { return lang; }
  };
  window.__agyI18nReady = true;
  window.__agyI18nDispose = function () {
    mo.disconnect();
    var st = document.getElementById('__agy_i18n_style__');
    if (st) st.remove();
    delete window.__agyI18n;
    delete window.__agyI18nReady;
    delete window.__agyI18nDispose;
  };
  window.__agyI18n.apply();
  return 'i18n ' + lang;
})()
