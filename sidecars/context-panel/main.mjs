#!/usr/bin/env node
/**
 * main.mjs — agy-context 面板 sidecar（v3：侧边栏菜单项）
 *
 * 机制：
 *   1. 读 %APPDATA%\Antigravity\DevToolsActivePort 拿 CDP 端口
 *   2. WebSocket 连 browser 端点
 *   3. Target.attachToTarget 附加主页面
 *   4. 执行 panel.js（读文件注入，避免模板字符串嵌套）
 *   5. 长连接保活，页面重载后自动重注入
 *
 * 客户端脚本在 ./panel.js（+ i18n.js），通过占位符注入统计数据；只在代码或数据变化时推送。
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const STATS_SCRIPT = path.join(PLUGIN_ROOT, "scripts", "stats.mjs");
const PANEL_SCRIPT = path.join(__dirname, "panel.js");
const I18N_SCRIPT = path.join(__dirname, "i18n.js");

const LOG = (...a) => console.log("[agy-context]", ...a);

/* ---------------- 端口发现 ---------------- */

function devToolsPortFile() {
  const home = homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Antigravity", "DevToolsActivePort");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appdata, "Antigravity", "DevToolsActivePort");
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, "Antigravity", "DevToolsActivePort");
}

function readPort() {
  const f = devToolsPortFile();
  if (!existsSync(f)) return null;
  try {
    const port = Number(readFileSync(f, "utf8").trim().split(/\r?\n/)[0]);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/* ---------------- HTTP JSON ---------------- */

function fetchJson(url, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(b));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/* ---------------- 最小 CDP 客户端 ---------------- */

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const t = setTimeout(() => reject(new Error("connect timeout")), 8000);
      ws.addEventListener("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.addEventListener("error", (e) => {
        clearTimeout(t);
        reject(new Error("ws error: " + (e?.message || "unknown")));
      });
      ws.addEventListener("message", (ev) => {
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          return;
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: rs, reject: rj } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rj(new Error(msg.error.message || JSON.stringify(msg.error)));
          else rs(msg.result);
        }
      });
    });
  }

  send(method, params = {}, sessionId) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error("ws not open"));
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("cdp timeout: " + method));
        }
      }, 20000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/* ---------------- 统计数据 ---------------- */
/*
 * 性能要点（避免 5 秒一次的卡顿 / Windows 鼠标转圈）：
 *   1. stats.mjs 以模块方式在本进程内调用，不再每轮 spawn 子进程
 *      （Windows 上频繁 CreateProcess 会让鼠标出现“后台忙”转圈）。
 *   2. 先算一个数据文件指纹（mtime + size），没变化就不重算、不推送。
 *   3. 推送前比较内容哈希，相同则跳过；页面侧也只在数据真的变化时重绘。
 */

let statsMod = null;
async function getStatsMod() {
  if (!statsMod) statsMod = await import(pathToFileURL(STATS_SCRIPT).href);
  return statsMod;
}

let appDirCache = null;
function dataFingerprint(appDir) {
  const h = createHash("sha1");
  const add = (f) => {
    try { const st = statSync(f); h.update(f + ":" + st.mtimeMs + ":" + st.size + "\n"); } catch { /* ignore */ }
  };
  add(path.join(appDir, "conversation_summaries.db"));
  add(path.join(appDir, "conversation_summaries.db-wal"));
  const conv = path.join(appDir, "conversations");
  try { for (const f of readdirSync(conv)) add(path.join(conv, f)); } catch { /* ignore */ }
  const brain = path.join(appDir, "brain");
  try {
    for (const id of readdirSync(brain)) {
      add(path.join(brain, id, ".system_generated", "logs", "transcript.jsonl"));
    }
  } catch { /* ignore */ }
  return h.digest("hex");
}

const STATS_MIN_INTERVAL = 8000;   // 数据持续变化时，最快 8 秒重算一次
let stats = { data: null, json: "", hash: "", fp: "", at: 0 };

async function refreshStats() {
  try {
    const mod = await getStatsMod();
    if (!appDirCache || !existsSync(appDirCache)) appDirCache = mod.findAppDir();
    if (!appDirCache) {
      const err = { error: "找不到 Antigravity 数据目录" };
      return setStats(err, "none");
    }
    const fp = dataFingerprint(appDirCache);
    if (stats.data && fp === stats.fp) return false;
    if (stats.data && Date.now() - stats.at < STATS_MIN_INTERVAL) return false;
    const d = await mod.collectAll(appDirCache, {});
    return setStats(d, fp);
  } catch (e) {
    if (stats.data && !stats.data.error) return false; // 偶发读取失败（数据库正被写入）时保留上一份
    return setStats({ error: "统计失败: " + (e?.message || e) }, "err");
  }
}

function setStats(d, fp) {
  const json = JSON.stringify(d, (k, v) => (k === "generatedAt" ? undefined : v));
  const hash = createHash("sha1").update(json).digest("hex").slice(0, 16);
  stats.fp = fp;
  stats.at = Date.now();
  if (hash === stats.hash) return false;
  d.dataHash = hash;
  stats = { data: d, json: JSON.stringify(d).replace(/</g, "\\u003c"), hash, fp, at: stats.at };
  return true;
}

/* ---------------- 持久化设置 ---------------- */

const SETTINGS_FILE = path.join(PLUGIN_ROOT, "settings.json");

function readSettingsFile() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) || {};
    }
  } catch { /* ignore */ }
  const isZh = (Intl.DateTimeFormat().resolvedOptions().locale || "").toLowerCase().startsWith("zh");
  return { "agy-context:lang": isZh ? "zh" : "en" };
}

function writeSettingsFile(patch) {
  if (!patch || typeof patch !== "object") return;
  try {
    const cur = readSettingsFile();
    const updated = Object.assign(cur, patch);
    writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  } catch (e) {
    LOG("failed to write settings:", e?.message || e);
  }
}

/* ---------------- 注入脚本构建 ---------------- */

function readLogoDataUrl() {
  const exts = [
    { ext: "jpg", mime: "image/jpeg" },
    { ext: "jpeg", mime: "image/jpeg" },
    { ext: "png", mime: "image/png" },
    { ext: "svg", mime: "image/svg+xml" },
    { ext: "webp", mime: "image/webp" },
  ];
  for (const item of exts) {
    const p = path.join(PLUGIN_ROOT, "assets", "logo." + item.ext);
    try {
      if (existsSync(p)) {
        return "data:" + item.mime + ";base64," + readFileSync(p).toString("base64");
      }
    } catch { /* ignore */ }
  }
  return "";
}

let buildCache = { key: "", hash: "", panel: "", i18n: "", logo: "", settings: {} };
function readBuild() {
  const panel = readFileSync(PANEL_SCRIPT, "utf8");
  let i18n = "";
  try { i18n = readFileSync(I18N_SCRIPT, "utf8").replace(/<\/script/gi, "<\\/script"); } catch { /* ignore */ }
  const logo = readLogoDataUrl();
  const settings = readSettingsFile();
  const settingsStr = JSON.stringify(settings);
  const key = panel.length + ":" + i18n.length + ":" + logo.length + ":" + settingsStr.length + ":" + panel.slice(0, 64);
  const hash = createHash("sha1").update(panel).update("\0").update(i18n).update("\0").update(logo).update("\0").update(settingsStr).digest("hex").slice(0, 12);
  if (hash !== buildCache.hash) buildCache = { key, hash, panel, i18n, logo, settings };
  return buildCache;
}

function buildInjectionScript(b, payloadJson) {
  // 用函数替换，避免 payload / logo 里的 $& 等被当成替换模式
  const panel = b.panel
    .replace(/__PAYLOAD__/g, () => payloadJson)
    .replace(/__LOGO__/g, () => b.logo || "");
  const settingsJson = JSON.stringify(b.settings || {});
  return (
    "(function(){try{window.__agyI18nDispose&&window.__agyI18nDispose();}catch(e){}" +
    "try{window.__agyCtxDispose&&window.__agyCtxDispose();}catch(e){}})();\n" +
    "window.__agySettings=Object.assign({}," + settingsJson + ",window.__agySettings||{});\n" +
    "var __agyR=" + panel + ";\n;\n" + b.i18n + "\n;window.__agyCtxBuild=" + JSON.stringify(b.hash) + ";__agyR;"
  );
}

/* ---------------- 主循环 ---------------- */

let pageSession = null;
let currentCdp = null;
let timer = null;
let consecutiveFailures = 0;
let shuttingDown = false;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

async function findPage(cdp, port) {
  const targets = await fetchJson("http://127.0.0.1:" + port + "/json/list");
  return (
    targets.find(
      (t) =>
        t.type === "page" &&
        typeof t.url === "string" &&
        /^https?:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.url)
    ) || null
  );
}

async function evalIn(cdp, sessionId, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }, sessionId);
  if (r?.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r?.result?.value;
}

let pushedHash = "";
let activeContextEvents = { id: "", fingerprint: "", events: [], fileChanges: [] };

async function pagePayload(cdp, sessionId) {
  const payload = JSON.parse(stats.json);
  let conversationId = "";
  try {
    const pathname = await evalIn(cdp, sessionId, "location.pathname");
    const match = /^\/c\/([A-Za-z0-9-]+)/.exec(String(pathname || ""));
    if (match) conversationId = match[1];
  } catch { /* 页面路由读取失败时只推送聚合统计 */ }

  let eventFingerprint = "";
  const session = (payload.sessions || []).find((s) => String(s.id) === conversationId);
  if (conversationId && session && appDirCache) {
    const transcript = path.join(appDirCache, "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
    try {
      const st = statSync(transcript);
      eventFingerprint = st.mtimeMs + ":" + st.size;
      if (activeContextEvents.id !== conversationId || activeContextEvents.fingerprint !== eventFingerprint) {
        const mod = await getStatsMod();
        const parsed = mod.parseTranscript(transcript, { captureContextEvents: true, captureFileChanges: true });
        activeContextEvents = {
          id: conversationId,
          fingerprint: eventFingerprint,
          events: parsed.contextEvents || [],
          fileChanges: (parsed.fileOps || []).filter((op) => op.op === "write" || op.op === "edit"),
        };
      }
      session.contextEvents = activeContextEvents.events;
      session.contextEventCount = activeContextEvents.events.length;
      session.contextEventsHash = eventFingerprint;
      session.fileChanges = activeContextEvents.fileChanges;
    } catch { /* transcript may be temporarily unavailable while Antigravity writes it */ }
  }

  const hash = createHash("sha1")
    .update(stats.hash).update("\0").update(conversationId).update("\0").update(eventFingerprint)
    .digest("hex").slice(0, 16);
  payload.dataHash = hash;
  return { json: JSON.stringify(payload).replace(/</g, "\\u003c"), hash };
}

async function sync(cdp, sessionId) {
  const changed = await refreshStats();
  if (!stats.data) return;
  const payload = await pagePayload(cdp, sessionId);
  const b = readBuild();
  // 页面里当前的构建版本 + 数据版本 + 前端待持久化设置
  const probe = await evalIn(cdp, sessionId,
    "JSON.stringify([window.__agyCtxBuild||'', window.__agyCtxDataHash||'', window.__agyPendingSettings||null])");
  const [pageBuild, pageHash, pendingSettings] = JSON.parse(probe || '["","",null]');

  if (pendingSettings && typeof pendingSettings === "object") {
    writeSettingsFile(pendingSettings);
    await evalIn(cdp, sessionId, "window.__agyPendingSettings = null;");
  }

  if (pageBuild !== b.hash) {
    const v = await evalIn(cdp, sessionId, buildInjectionScript(b, payload.json));
    LOG("inject:", v, "build", b.hash);
    pushedHash = payload.hash;
    return;
  }
  if (pageHash !== payload.hash || (changed && pushedHash !== payload.hash)) {
    await evalIn(cdp, sessionId, "window.__agyCtxUpdate && window.__agyCtxUpdate(" + payload.json + ")");
    pushedHash = payload.hash;
  }
}

async function tick() {
  if (shuttingDown) return;
  try {
    const port = readPort();
    if (!port) {
      consecutiveFailures++;
      return schedule(Math.min(5000 + consecutiveFailures * 2000, 20000));
    }

    if (!currentCdp || currentCdp.ws?.readyState !== 1) {
      const v = await fetchJson("http://127.0.0.1:" + port + "/json/version");
      currentCdp = new Cdp(v.webSocketDebuggerUrl);
      await currentCdp.connect();
      LOG("CDP connected, port", port);
      consecutiveFailures = 0;
    }

    const page = await findPage(currentCdp, port);
    if (!page) {
      consecutiveFailures++;
      return schedule(Math.min(5000 + consecutiveFailures * 2000, 20000));
    }

    if (!pageSession || pageSession.targetId !== page.id) {
      const att = await currentCdp.send("Target.attachToTarget", { targetId: page.id, flatten: true });
      pageSession = { id: att.sessionId, targetId: page.id };
      LOG("attached:", page.title || page.url);
    }

    await sync(currentCdp, pageSession.id);
  } catch (e) {
    LOG("cycle error:", e?.message || e);
    consecutiveFailures++;
    currentCdp?.close();
    currentCdp = null;
    pageSession = null;
  }
  // 成功一轮后清零失败计数，恢复正常节奏（每轮只发一个极小探针，数据/代码变了才推送）
  const delay = consecutiveFailures > 0
    ? Math.min(5000 + consecutiveFailures * 2000, 20000)
    : 5000;
  schedule(delay);
}

LOG("start, plugin root:", PLUGIN_ROOT);
LOG("DevToolsActivePort:", devToolsPortFile());

/* ------------------------------------------------------------------ *
 * 关键：优雅退出。
 * 宿主关闭 language server 时会向 sidecar 发 SIGTERM/SIGINT。
 * 若不处理，setInterval 保活会让进程赖着不走；配合 restart_policy:"always"
 * 宿主会反复重拉，导致启动/关闭流程卡死（实测现象：main.log 反复出现
 * "Shutting down language server..." 而窗口起不来）。
 * ------------------------------------------------------------------ */
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(timer);
  try { currentCdp?.close(); } catch { /* ignore */ }
  LOG("received " + sig + ", exiting");
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
// 父进程（宿主）退出时 stdin 会关闭/断开，主动退出避免孤儿进程
process.on("disconnect", () => shutdown("disconnect"));

tick();
setInterval(() => {}, 1 << 30);
