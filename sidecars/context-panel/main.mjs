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
 * 客户端脚本在 ./panel.js，通过 __PAYLOAD__ 占位符注入统计数据。
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

let cache = { at: 0, data: null };

function loadStats(force = false) {
  if (!force && cache.data && Date.now() - cache.at < 30000) {
    return Promise.resolve(cache.data);
  }
  return new Promise((resolve) => {
    if (!existsSync(STATS_SCRIPT)) return resolve({ error: "stats.mjs 不存在" });
    const p = spawn(process.execPath, [STATS_SCRIPT, "--json"], { timeout: 60000, windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", () => {
      try {
        const d = JSON.parse(out);
        cache = { at: Date.now(), data: d };
        resolve(d);
      } catch {
        resolve({ error: "解析统计失败", detail: (err || out).slice(0, 400) });
      }
    });
    p.on("error", (e) => resolve({ error: "启动 stats.mjs 失败: " + e.message }));
  });
}

/* ---------------- 注入脚本构建 ---------------- */

function buildInjectionScript(statsJson) {
  const payload = JSON.stringify(statsJson).replace(/</g, "\\u003c");
  const raw = readFileSync(PANEL_SCRIPT, "utf8");
  // 用函数替换，避免 payload 里的 $& 等被当成替换模式
  let script = raw.replace(/__PAYLOAD__/g, () => payload);
  // 追加独立的 i18n 层（DOM 后处理翻译，不改动 panel.js 源码）
  try {
    const i18n = readFileSync(I18N_SCRIPT, "utf8").replace(/<\/script/gi, "<\\/script");
    script += "\n;\n" + i18n;
  } catch (e) {
    console.warn("[agy-context] i18n.js 读取失败:", e.message);
  }
  return script;
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

async function injectTo(cdp, sessionId) {
  const stats = await loadStats();
  const expr = buildInjectionScript(stats);
  const r = await cdp.send(
    "Runtime.evaluate",
    { expression: expr, returnByValue: true, awaitPromise: false },
    sessionId
  );
  if (r?.exceptionDetails) {
    LOG("injection error:", JSON.stringify(r.exceptionDetails).slice(0, 500));
    return false;
  }
  LOG("inject:", r?.result?.value);
  return true;
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

    await injectTo(currentCdp, pageSession.id);

    // 面板已开时推送最新数据
    const fresh = await loadStats(true);
    const pushExpr =
      "window.__agyCtxUpdate && window.__agyCtxUpdate(" +
      JSON.stringify(fresh).replace(/</g, "\\u003c") +
      ")";
    await currentCdp.send(
      "Runtime.evaluate",
      { expression: pushExpr, returnByValue: true },
      pageSession.id
    );
  } catch (e) {
    LOG("cycle error:", e?.message || e);
    consecutiveFailures++;
    currentCdp?.close();
    currentCdp = null;
    pageSession = null;
  }
  // 成功一轮后清零失败计数，恢复正常 5 秒节奏
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
