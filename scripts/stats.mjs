#!/usr/bin/env node
/**
 * stats.mjs — Antigravity 会话统计引擎 v3
 *
 * 数据来源（全部本地，不联网）：
 *   conversation_summaries.db                            会话摘要（标题/步数/父子/工作区）
 *   conversations/<id>.db                                steps（工具调用）
 *   brain/<id>/.system_generated/logs/transcript.jsonl    ★ token 用量 + 时间戳 + 工具参数
 *
 * token 字段（来自 transcript.jsonl 的 MODEL 记录）：
 *   input_tokens        本次请求的输入 token
 *   cache_read_tokens   命中缓存读取的 token（不重复计费）
 *   output_tokens       输出 token
 *
 * 计费口径（与主流定价一致）：
 *   实际计费输入 = input_tokens（已不含缓存部分）
 *   缓存读取按折扣价，这里单独展示不折算
 *
 * 用法：
 *   node stats.mjs                    # 全局概览
 *   node stats.mjs --json             # 机器可读
 *   node stats.mjs --days 7           # 最近 N 天
 *   node stats.mjs --session <前缀>    # 单会话
 *   node stats.mjs --app-dir <dir>    # 自定义目录
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const APP_DIRS = [
  join(homedir(), ".gemini", "antigravity"),
  join(homedir(), ".gemini", "antigravity-cli"),
  join(homedir(), ".gemini", "antigravity-ide"),
];

export function findAppDir(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  for (const d of APP_DIRS) {
    if (existsSync(join(d, "conversation_summaries.db"))) return d;
  }
  for (const d of APP_DIRS) if (existsSync(d)) return d;
  return null;
}

/* ---------------- SQLite ---------------- */

let sqliteImpl = null;
async function getSqlite() {
  if (sqliteImpl) return sqliteImpl;
  try {
    const mod = await import("node:sqlite");
    if (mod?.DatabaseSync) {
      sqliteImpl = { kind: "node", mod };
      return sqliteImpl;
    }
  } catch {
    /* 降级 */
  }
  sqliteImpl = { kind: "cli" };
  return sqliteImpl;
}

async function query(dbPath, sql) {
  const impl = await getSqlite();
  if (impl.kind === "node") {
    const db = new impl.mod.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  }
  try {
    const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.trim() ? JSON.parse(out) : [];
  } catch {
    return [];
  }
}

/* ---------------- transcript.jsonl 解析（token 来源）---------------- */

/**
 * 读取一个会话的 transcript.jsonl，返回 { tokens, steps, tools, times }
 * 每行是一个 JSON 对象；只有 source=MODEL 的记录带 token。
 */
export function parseTranscript(filePath, options = {}) {
  const out = {
    requests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    models: {},
    toolCalls: {},
    commands: {},
    skills: {},
    events: [], // {at, in, cache, out}
    firstAt: null,
    lastAt: null,
    activeSeconds: 0,   // 去掉空闲间隔后的活跃时长
    wallSeconds: 0,     // 首尾跨度
    times: [],
    timeCats: {         // 耗时分类（秒）
      toolExec: 0,      // 工具执行
      modelThink: 0,    // 模型思考
      modelReply: 0,    // 模型回复
      systemOverhead: 0,// 系统开销
      userWait: 0,      // 等待用户输入
    },
    timeSeq: [],        // [{at, type}] 用于后续分析
    ctxParts: {},       // 上下文构成（按字符数）
    ctxItems: {},       // 各部分的条目数
    lastInputTokens: 0,
    lastCacheTokens: 0,
    fileOps: [],        // [{step, op, path, chars, at}]
    truncations: [],    // [{step, fields, at}]
    contextEvents: [],   // 当前会话查询用的 transcript 文本事件
    contextEventCount: 0,
    types: {},          // PLANNER_RESPONSE / GENERIC / ...
    statuses: {},
    execRecords: [],    // 命令执行明细
    pendingCmds: [],    // 待关联的 run_command
    programCounts: {},  // 程序调用次数
    failedCount: 0,
    bgCount: 0,
  };
  if (!existsSync(filePath)) return out;

  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return out;
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }

    const at = d.created_at || d.createdAt || null;
    if (at) {
      if (!out.firstAt || at < out.firstAt) out.firstAt = at;
      if (!out.lastAt || at > out.lastAt) out.lastAt = at;
    }

    // 工具调用（也在 transcript 里，比从 protobuf 扫更准）
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const nm = tc?.name;
        if (typeof nm === "string" && nm) {
          out.toolCalls[nm] = (out.toolCalls[nm] || 0) + 1;
        }
      }
    }

    // 类型 / 状态 / 时间线
    if (d.type) out.types[d.type] = (out.types[d.type] || 0) + 1;
    if (at && d.type) {
      const ms = Date.parse(at);
      if (Number.isFinite(ms)) {
        out.timeSeq.push({
          at: ms,
          type: d.type,
          thinking: Boolean(d.thinking),
        });
      }
    }

    // 默认只统计事件数量；sidecar 仅为当前会话捕获正文，供本地搜索。
    const hasEventContent = (typeof d.content === "string" && d.content.trim())
      || (typeof d.thinking === "string" && d.thinking.trim());
    const eventFields = Array.isArray(d.truncated_fields) ? d.truncated_fields.slice(0, 5) : [];
    if (d.type && (hasEventContent || eventFields.length)) {
      out.contextEventCount++;
      if (options.captureContextEvents) {
        const eventText = [d.content, d.thinking]
          .filter((v) => typeof v === "string" && v.trim())
          .join("\n\n");
        out.contextEvents.push({
          step: d.step_index ?? null,
          at: at || null,
          type: d.type,
          status: typeof d.status === "string" ? d.status : "",
          text: redactContextText(eventText).slice(0, 6000),
          truncated: eventText.length > 6000,
          fields: eventFields,
        });
      }
    }
    if (options.captureContextEvents && Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const tool = String(tc?.name || "tool");
        let input = "";
        try { input = JSON.stringify(tc?.args || {}); } catch { input = ""; }
        if (!input) continue;
        const safeInput = redactContextText(input);
        out.contextEvents.push({
          step: d.step_index ?? null,
          at: at || null,
          type: "TOOL_CALL_INPUT",
          status: "",
          tool,
          text: safeInput.slice(0, 6000),
          truncated: safeInput.length > 6000,
          fields: [],
        });
      }
    }
    if (d.status) out.statuses[d.status] = (out.statuses[d.status] || 0) + 1;
    if (at) {
      const t = Date.parse(at);
      if (Number.isFinite(t)) out.times.push(t);
    }

    // 内容截断（上下文事件的一种）
    if (Array.isArray(d.truncated_fields) && d.truncated_fields.length) {
      out.truncations.push({
        step: d.step_index ?? null,
        fields: d.truncated_fields.slice(0, 5),
        at: at || null,
        type: d.type || "",
      });
    }

    // ---- 上下文构成统计（按字符数，最后按比例映射 token）----
    {
      const c = String(d.content || "");
      const th = String(d.thinking || "");
      let bucket = "";
      if (d.type === "USER_INPUT") bucket = "userMsg";
      else if (d.type === "SYSTEM_MESSAGE") bucket = "sysPrompt";
      else if (d.type === "GENERIC") bucket = "toolResult";
      else if (d.type === "PLANNER_RESPONSE") {
        if (th) { out.ctxParts.modelThink = (out.ctxParts.modelThink || 0) + th.length; out.ctxItems.modelThink = (out.ctxItems.modelThink || 0) + 1; }
        if (c) { out.ctxParts.assistantMsg = (out.ctxParts.assistantMsg || 0) + c.length; out.ctxItems.assistantMsg = (out.ctxItems.assistantMsg || 0) + 1; }
      }
      if (bucket && c) {
        out.ctxParts[bucket] = (out.ctxParts[bucket] || 0) + c.length;
        out.ctxItems[bucket] = (out.ctxItems[bucket] || 0) + 1;
      }
      // 工具调用参数也算「工具定义」成本
      if (Array.isArray(d.tool_calls) && d.tool_calls.length) {
        const len = JSON.stringify(d.tool_calls).length;
        out.ctxParts.toolDef = (out.ctxParts.toolDef || 0) + len;
        out.ctxItems.toolDef = (out.ctxItems.toolDef || 0) + d.tool_calls.length;
      }
    }

    // ---- 命令执行明细 ----
    // 命令文本来自 tool_calls（run_command），耗时/状态来自 GENERIC 行。
    // 两者按 step_index 关联。
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const opName = String(tc?.name || "");
        if (opName === "write_file" || opName === "edit_file" || opName === "read_file") {
          const args = tc?.args || {};
          let p = String(args.Path || args.path || args.TargetFile || args.file_path || "");
          p = p.replace(/^"|"$/g, "").replace(/\\/g, "\\");
          if (p) {
            const argText = (...keys) => {
              for (const key of keys) if (typeof args[key] === "string") return args[key];
              return "";
            };
            const beforeText = argText("TargetContent", "targetContent", "Target", "target", "old_string", "oldString", "OldString");
            const afterText = opName === "write_file"
              ? argText("Content", "content", "FileContent", "file_content")
              : argText("ReplacementContent", "replacementContent", "Replacement", "replacement", "new_string", "newString", "NewString", "Content", "content");
            const content = afterText || beforeText || argText("Content", "content", "Replacement", "Target");
            const fileOp = {
              step: d.step_index ?? null,
              op: opName.replace("_file", ""),
              path: p,
              chars: content.length,
              at: at || null,
            };
            if (options.captureFileChanges && opName !== "read_file") {
              const removed = opName === "write_file" ? { lines: [], truncated: false } : captureChangedLines(beforeText);
              const added = captureChangedLines(afterText);
              const lineStart = Number(args.StartLine ?? args.startLine ?? args.StartLineNumber ?? args.start_line);
              fileOp.path = redactPath(p);
              fileOp.changes = {
                removed: removed.lines,
                added: added.lines,
                removedTruncated: removed.truncated,
                addedTruncated: added.truncated,
              };
              if (Number.isInteger(lineStart) && lineStart > 0) fileOp.lineStart = lineStart;
            }
            out.fileOps.push(fileOp);
          }
          continue;
        }
        if (tc?.name !== "run_command") continue;
        const raw = String(tc?.args?.CommandLine || "").replace(/^["']|["']$/g, "");
        if (!raw) continue;
        let prog = (raw.split(/[\s;&|]+/).filter(Boolean)[0] || "").replace(/^["']/g, "");
        // 若首词本身是绝对路径，只保留文件名，避免泄露目录结构
        if (/^[A-Za-z]:[\\/]/.test(prog) || /^[~\/]/.test(prog)) {
          prog = (prog.split(/[\\/]+/).filter(Boolean).pop() || "程序");
        }
        prog = redactPath(prog);
        const summary = String(tc?.args?.toolSummary || "").replace(/^"|"$/g, "");
        out.pendingCmds.push({
          step: d.step_index ?? null,
          at: at || null,
          prog,
          text: raw.slice(0, 600),
          summary: summary.slice(0, 120),
          bg: Boolean(tc?.args?.RunPersistent) || raw.toLowerCase().includes("background"),
        });
        if (prog && prog.length < 40 && !/^created$/i.test(prog)) {
          out.programCounts[prog] = (out.programCounts[prog] || 0) + 1;
        }
      }
    }

    if (d.type === "GENERIC") {
      const c = String(d.content || "");
      const m1 = /Created At:\s*(\S+)/.exec(c);
      const m2 = /Completed At:\s*(\S+)/.exec(c);
      const descM = /Task Description:\s*([\s\S]{1,400}?)(?:\n|$)/.exec(c);
      const isBg = /background task/i.test(c);
      const exitM = /Command exited with code\s+(\d+)/i.exec(c);
      const exitCode = exitM ? Number(exitM[1]) : null;
      const failed =
        d.status === "ERROR" ||
        (exitCode !== null && exitCode !== 0) ||
        /Encountered error/i.test(c);
      out.exitCodes = out.exitCodes || {};
      if (exitCode !== null) {
        out.exitCodes[exitCode] = (out.exitCodes[exitCode] || 0) + 1;
      }

      let durSec = null;
      // 有嵌套的 Created/Completed 对（工具结果），取最外层那对
      if (m1 && m2) {
        const t1 = Date.parse(m1[1]);
        const t2 = Date.parse(m2[1]);
        if (Number.isFinite(t1) && Number.isFinite(t2) && t2 >= t1) {
          durSec = Math.round((t2 - t1) / 100) / 10;
        }
      }

      // 提取命令输出（Task Description 之后的内容 / 或纯输出）
      let output = "";
      if (descM) {
        const after = c.slice(c.indexOf(descM[1]) + descM[1].length);
        output = after.replace(/Task logs are available at:[^\n]*/i, "").trim();
      } else {
        // 去掉时间戳行
        output = c.split("\n")
          .filter(function (l) {
            return !/^Created At:/i.test(l.trim()) && !/^Completed At:/i.test(l.trim());
          })
          .join("\n").trim();
      }
      const lineCount = output ? output.split("\n").length : 0;
      const outLen = output.length;

      // 若带 Task Description，则这条 GENERIC 本身就是命令记录
      if (descM) {
        const raw = descM[1].trim().replace(/^["']|["']$/g, "");
        let prog = (raw.split(/[\s;&|]+/).filter(Boolean)[0] || "").replace(/^["']/g, "");
        if (/^[A-Za-z]:[\\/]/.test(prog) || /^[~\/]/.test(prog)) {
          prog = (prog.split(/[\\/]+/).filter(Boolean).pop() || "程序");
        }
        prog = redactPath(prog);
        out.execRecords.push({
          step: d.step_index ?? null,
          at: at || m1?.[1] || null,
          prog,
          text: redactPath(raw).slice(0, 600),
          summary: "",
          durSec,
          bg: isBg,
          failed,
          exitCode,
          status: d.status || "",
          output: redactPath(output).slice(0, 1200),
          lineCount,
          outLen,
        });
        if (failed) out.failedCount++;
        if (isBg) out.bgCount++;
      } else {
        // 否则作为「工具执行」条目，用于耗时统计
        out.execRecords.push({
          step: d.step_index ?? null,
          at: at || m1?.[1] || null,
          prog: "",
          text: (() => {
            const lines = c.split("\n").map((x) => x.trim()).filter(Boolean);
            const meaningful = lines.find(
              (l) => !/^Created At:/i.test(l) && !/^Completed At:/i.test(l) && l.length > 3
            );
            return redactPath(meaningful || lines[0] || "").slice(0, 240);
          })(),
          summary: "",
          durSec,
          bg: isBg,
          failed,
          status: d.status || "",
          tool: true,
          output: redactPath(output).slice(0, 1200),
          lineCount,
          outLen,
        });
        if (failed) out.failedCount++;
      }
    }

    // 技能加载（tool_calls 里 name 形如 skill 或含 skill 关键字）
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const nm = tc?.name || "";
        if (typeof nm === "string" && /skill/i.test(nm)) {
          out.skills[nm] = (out.skills[nm] || 0) + 1;
        }
        const cl = tc?.args?.CommandLine;
        if (typeof cl === "string") {
          const first = cl.trim().split(/[\s;&|]+/).filter(Boolean)[0] || "";
          if (first && first.length < 40) out.commands[first] = (out.commands[first] || 0) + 1;
        }
      }
    }

    if (d.input_tokens == null && d.output_tokens == null) continue;

    const inT = Number(d.input_tokens) || 0;
    const cacheT = Number(d.cache_read_tokens) || 0;
    const outT = Number(d.output_tokens) || 0;

    out.requests++;
    out.lastInputTokens = inT;
    out.lastCacheTokens = cacheT;
    out.inputTokens += inT;
    out.cacheReadTokens += cacheT;
    out.outputTokens += outT;
    out.events.push({ at, in: inT, cache: cacheT, out: outT });

    const m = d.model || d.model_name || d.modelName;
    if (typeof m === "string" && m) out.models[m] = (out.models[m] || 0) + 1;
  }

  // 计算活跃时长 + 分类耗时（丢弃 > 5 分钟的间隔，视为空闲）
  const IDLE_GAP = 300;
  if (out.times.length > 1) {
    const ts = [...out.times].sort((a, b) => a - b);
    let active = 0;
    for (let i = 0; i < ts.length - 1; i++) {
      const gap = (ts[i + 1] - ts[i]) / 1000;
      if (gap > 0 && gap <= IDLE_GAP) active += gap;
    }
    out.activeSeconds = Math.round(active);
    out.wallSeconds = Math.round((ts[ts.length - 1] - ts[0]) / 1000);
  }

  // 按「下一个事件的类型」归类时间间隔
  if (out.timeSeq.length > 1) {
    const seq = [...out.timeSeq].sort((a, b) => a.at - b.at);
    for (let i = 0; i < seq.length - 1; i++) {
      const gap = (seq[i + 1].at - seq[i].at) / 1000;
      if (gap <= 0 || gap > IDLE_GAP) continue;
      const next = seq[i + 1];
      if (next.type === "GENERIC") out.timeCats.toolExec += gap;
      else if (next.type === "PLANNER_RESPONSE") {
        if (next.thinking) out.timeCats.modelThink += gap;
        else out.timeCats.modelReply += gap;
      } else if (next.type === "SYSTEM_MESSAGE") out.timeCats.systemOverhead += gap;
      else if (next.type === "USER_INPUT") out.timeCats.userWait += gap;
    }
    for (const k of Object.keys(out.timeCats)) {
      out.timeCats[k] = Math.round(out.timeCats[k]);
    }
  }

  return out;
}

export function localDateHour(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    hour: pad(date.getHours()),
  };
}

/* ---------------- 定价（可调）---------------- */
/**
 * 估算成本用的单价（USD / 1M tokens）。
 * 这些是公开参考价，非官方账单口径 —— 仅作量级参考。
 * 可通过环境变量覆盖：AGY_PRICE_IN / AGY_PRICE_OUT / AGY_PRICE_CACHE
 */
const PRICE = {
  input: Number(process.env.AGY_PRICE_IN) || 1.25,
  output: Number(process.env.AGY_PRICE_OUT) || 10.0,
  cache: Number(process.env.AGY_PRICE_CACHE) || 0.31,
};

function estimateCost(t) {
  return (
    (t.inputTokens / 1e6) * PRICE.input +
    (t.outputTokens / 1e6) * PRICE.output +
    (t.cacheReadTokens / 1e6) * PRICE.cache
  );
}

/* ---------------- protobuf 补充分（工具/文件路径）---------------- */

const KNOWN_TOOLS = [
  "view_file", "write_to_file", "replace_file_content", "multi_replace_file_content",
  "list_dir", "find_by_name", "grep_search", "search_web", "read_url_content",
  "run_command", "manage_task", "schedule", "list_permissions", "ask_permission",
  "invoke_subagent", "define_subagent", "send_message", "manage_subagents",
  "ask_question", "generate_image", "edit_file", "read_file", "swarm", "read_board",
];

/**
 * 对命令文本做隐私脱敏：
 *   C:\Users\<me>\...  -> ~\...
 *   /home/<me>/...       -> ~/...
 *   d:\Mygit\x\y.hpp    -> …\x\y.hpp （保留末两段，去掉盘符根）
 * 目标：不暴露主目录全路径，同时保留命令可读性。
 */
const HOME_DIR = homedir();
function redactPath(text) {
  if (typeof text !== "string" || !text) return "";
  let s = text;
  const homeVariants = [HOME_DIR, HOME_DIR.replace(/\\/g, "/")];
  for (const h of homeVariants) {
    if (!h) continue;
    const re = new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    s = s.replace(re, "~");
  }
  // 二次压缩：~\<深路径> 只保留末两段
  s = s.replace(/~(?:[\\/][^\s"';&|]+){2,}/g, (m) => {
    const parts = m.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 3) return m;
    return "~\\…\\" + parts.slice(-2).join("\\");
  });
  // 三次压缩：其它盘符绝对路径（D:\proj\a\b.hpp）保留末两段
  s = s.replace(/\b[A-Za-z]:[\\/](?:[^\s"';&|]+[\\/])+([^\s"';&|]+)/gi, (m, last) => {
    const parts = m.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 3) return m;
    return "…\\" + parts.slice(-2).join("\\");
  });
  // 单独的两段盘符路径（d:\Mygit）保留目录名但去掉盘符
  s = s.replace(/\b[A-Za-z]:[\\/]([^\\/\s"';&|]+)/gi, (m, name) => "…\\" + name);
  return s;
}

function redactContextText(text) {
  return redactPath(text).replace(/(^|[^A-Za-z0-9])([A-Za-z]):[\\/](?!\/)([^\s"'<>|]+)/g, (_match, prefix, _drive, tail) => {
    const clean = tail.replace(/[),.;!?]+$/, "");
    const suffix = clean.split(/[\\/]+/).filter(Boolean).slice(-2).join("\\");
    return prefix + "…\\" + suffix + tail.slice(clean.length);
  });
}

function captureChangedLines(text) {
  const clean = redactContextText(String(text || ""));
  if (!clean) return { lines: [], truncated: false };
  const truncatedByChars = clean.length > 12000;
  const limited = truncatedByChars ? clean.slice(0, 12000) : clean;
  const allLines = limited.split(/\r?\n/);
  return {
    lines: allLines.slice(0, 120),
    truncated: truncatedByChars || allLines.length > 120,
  };
}

function bytesToLatin1(val) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (Buffer.isBuffer(val)) return val.toString("latin1");
  if (val instanceof Uint8Array) return Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString("latin1");
  if (val instanceof ArrayBuffer) return Buffer.from(val).toString("latin1");
  return String(val);
}

export function extractToolCalls(payloadBuf) {
  const s = bytesToLatin1(payloadBuf);
  const out = [];
  const re = /call_\d+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const w = s.slice(m.index, m.index + 80);
    for (const t of KNOWN_TOOLS) if (w.includes(t)) { out.push(t); break; }
  }
  return out;
}

export function extractPaths(payloadBuf) {
  const s = bytesToLatin1(payloadBuf);
  const found = new Set();
  const re = /[A-Za-z]:\\(?:[^"\\\x00-\x1f<>|*?\r\n]{1,60}\\)*[^"\\\x00-\x1f<>|*?\r\n]{1,60}\.[A-Za-z0-9]{1,8}/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let p = m[0];
    if (p.length < 8 || p.length > 200) continue;
    p = p.replace(/:[{].*$/, "");
    if (!/\.[A-Za-z0-9]{1,8}$/.test(p)) continue;
    if (p.includes("node_modules") || p.includes(".system_generated") || p.includes(":}")) continue;
    found.add(p);
  }
  return [...found];
}

export function extractModels(buf) {
  const s = bytesToLatin1(buf);
  const re = /\b(claude|gemini|gpt)-[a-z0-9.\-]{3,40}/g;
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[0]);
  return out;
}

export function extractCommands(payloadBuf) {
  const s = bytesToLatin1(payloadBuf);
  const out = [];
  const re = /"CommandLine"\s*:\s*"((?:[^"\\]|\\.){2,300})"/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    let c = m[1].replace(/\\u0026/g, "&").replace(/\\\\/g, "\\").trim();
    if (!c) continue;
    const first = c.split(/[\s;&|]+/).filter(Boolean)[0] || "";
    if (first && first.length < 40) out.push(first);
  }
  return out;
}

/* ---------------- 文件类型 ---------------- */

const EXT_GROUP = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JS/TS",
  py: "Python", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin",
  c: "C/C++", h: "C/C++", cpp: "C/C++", hpp: "C/C++", cc: "C/C++", hh: "C/C++",
  cs: "C#", php: "PHP", rb: "Ruby", swift: "Swift", dart: "Dart",
  html: "Web", css: "Web", scss: "Web", vue: "Web", svelte: "Web",
  json: "配置", yaml: "配置", yml: "配置", toml: "配置", ini: "配置", env: "配置",
  md: "文档", txt: "文档", rst: "文档",
  sql: "SQL", sh: "Shell", ps1: "Shell", bat: "Shell", cmd: "Shell",
};

function extOf(p) {
  if (typeof p !== "string") return "other";
  // 注意必须有捕获组，否则 m[1] 是 undefined
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(p);
  return m && m[1] ? m[1].toLowerCase() : "other";
}

/* ---------------- 聚合 ---------------- */

function normalizeModel(m) {
  if (typeof m !== "string" || !m) return null;
  return m.replace(/-n$/, "").replace(/-tiered$/, "").replace(/-thinking$/, " (thinking)");
}

function parseWorkspace(raw) {
  if (!raw) return [];
  try {
    return JSON.parse(raw).map((u) =>
      decodeURIComponent(String(u).replace(/^file:\/\/\//, "")).replace(/^\/([a-z]):/i, "$1:")
    );
  } catch {
    return [];
  }
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

/**
 * 隐私脱敏：把绝对主目录路径折叠成 ~
 * 例如 C:\Users\<user>\.gemini\antigravity  ->  ~\.gemini\antigravity
 *      /home/alice/projects                 ->  ~/projects
 * 其余绝对路径（如 D:\projects\...）只有在开启 --full-path 时才显示完整形式，
 * 默认只显示项目名之前的层级被裁掉的部分。
 */
const HOME = homedir();
const HOME_SLASH = HOME.replace(/\\/g, "/");

function redact(p, opts = {}) {
  if (typeof p !== "string" || !p) return "";
  let s = p;

  // 1) 主目录 → ~
  const variants = [HOME, HOME.replace(/\\/g, "/"), HOME_SLASH, HOME_SLASH.toLowerCase()];
  for (const v of variants) {
    if (!v) continue;
    if (s.toLowerCase().startsWith(v.toLowerCase())) {
      s = "~" + s.slice(v.length);
      break;
    }
  }

  // 2) 其余绝对路径：默认只保留末尾两段（去掉盘符/根/用户目录层级）
  if (!opts.fullPath && /^[A-Za-z]:[\\/]/.test(s) === false && s.startsWith("/") === false) {
    // 已在 ~ 下，直接返回
    return s;
  }
  if (!opts.fullPath && (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith("/"))) {
    const parts = s.split(/[\\/]+/).filter(Boolean);
    if (parts.length > 2) return "…\\" + parts.slice(-2).join("\\");
  }
  return s;
}

/** 脱敏一个路径统计对象：保留文件名，丢弃上层目录 */
function redactFiles(filesObj, opts = {}) {
  const out = {};
  for (const [p, n] of Object.entries(filesObj || {})) {
    const name = String(p).split(/[\\/]/).pop() || String(p);
    const key = opts.fullPath ? redact(p, opts) : name;
    out[key] = (out[key] || 0) + n;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export async function collectAll(appDir, opts = {}) {
  const summariesDb = join(appDir, "conversation_summaries.db");
  const convDir = join(appDir, "conversations");
  const brainDir = join(appDir, "brain");

  let sessions = [];
  if (existsSync(summariesDb)) {
    sessions = await query(
      summariesDb,
      `SELECT conversation_id, title, step_count, last_modified_time, workspace_uris,
              status, parent_conversation_id, nesting_depth, preview
       FROM conversation_summaries`
    );
  }

  const known = new Set(sessions.map((s) => s.conversation_id));
  if (existsSync(convDir)) {
    for (const f of readdirSync(convDir).filter((f) => f.endsWith(".db"))) {
      const id = f.replace(/\.db$/, "");
      if (!known.has(id)) {
        sessions.push({
          conversation_id: id, title: "", step_count: 0, last_modified_time: null,
          workspace_uris: "", status: "", parent_conversation_id: "", nesting_depth: 0, preview: "",
        });
      }
    }
  }

  let filtered = sessions;
  if (opts.days && opts.days > 0) {
    const cutoff = Date.now() - opts.days * 86400000;
    filtered = sessions.filter((s) => {
      if (!s.last_modified_time) return false;
      const t = Date.parse(String(s.last_modified_time).replace(" ", "T"));
      return Number.isFinite(t) ? t >= cutoff : false;
    });
  }

  const result = {
    appDir: redact(appDir),
    appDirFull: opts.fullPath ? appDir : undefined,
    generatedAt: new Date().toISOString(),
    range: opts.days ? `最近 ${opts.days} 天` : "全部",
    totals: {
      sessions: filtered.length, allSessions: sessions.length,
      steps: 0, toolCalls: 0, filesTouched: 0, subagents: 0,
      okSteps: 0, failedSteps: 0,
      requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0,
      totalTokens: 0, estCostUSD: 0,
      activeDays: 0, firstAt: null, lastAt: null,
      activeSeconds: 0, wallSeconds: 0,
      context: null,   // 当前上下文（{ used, parts, items }）
      fileOps: [],
      truncations: [], outputSpeed: 0,
    },
    skills: {},
    types: {},
    statuses: {},
    heatmap: {},   // 'YYYY-MM-DD': tokens（日历热力图）
    execRecords: [],   // 全部命令执行记录（按时间倒序，最多保留 400 条）
    programCounts: {},
    execSummary: { total: 0, failed: 0, bg: 0, totalSeconds: 0, avgSeconds: 0, successRate: null },
    exitCodes: {},
    timeCats: { toolExec: 0, modelThink: 0, modelReply: 0, systemOverhead: 0, userWait: 0 },
    timeCatsTotal: 0,
    successRate: null,
    cacheHitRate: null,
    sessions: [],
    toolUsage: {},
    models: {},
    files: {},
    fileTypes: {},
    commands: {},
    workspaces: {},
    daily: {},     // { 'YYYY-MM-DD': { tokens, cost, requests, steps } }
    hourly: {},    // { 'HH': tokens } 按系统本地小时归类
    pricing: PRICE,
  };

  for (const s of filtered) {
    const dbPath = join(convDir, `${s.conversation_id}.db`);
    const trPath = join(
      brainDir,
      s.conversation_id,
      ".system_generated",
      "logs",
      "transcript.jsonl"
    );

    const sess = {
      id: s.conversation_id,
      shortId: String(s.conversation_id).slice(0, 8),
      title: s.title || s.preview || "(未命名)",
      steps: Number(s.step_count) || 0,
      lastModified: s.last_modified_time || null,
      workspace: parseWorkspace(s.workspace_uris),
      isSubagent: Boolean(s.parent_conversation_id),
      parent: s.parent_conversation_id || null,
      depth: Number(s.nesting_depth) || 0,
      status: s.status || "",
      toolCalls: {}, toolTotal: 0,
      models: {}, files: [], commands: {},
      contextEventCount: 0,
      okSteps: 0, failedSteps: 0,
      tokens: { requests: 0, input: 0, cache: 0, output: 0, total: 0, costUSD: 0 },
      activeSeconds: 0, wallSeconds: 0,
      startAt: null, endAt: null,
      hasDb: existsSync(dbPath),
      hasTranscript: existsSync(trPath),
    };

    if (sess.isSubagent) result.totals.subagents++;

    for (const ws of sess.workspace) {
      const key = redact(ws, opts);
      result.workspaces[key] = (result.workspaces[key] || 0) + 1;
    }

    // ---- transcript（token 权威来源）----
    if (sess.hasTranscript) {
      const t = parseTranscript(trPath);
      sess.contextEventCount = t.contextEventCount || 0;
      sess.tokens = {
        requests: t.requests,
        input: t.inputTokens,
        cache: t.cacheReadTokens,
        output: t.outputTokens,
        total: t.inputTokens + t.outputTokens,
        costUSD: estimateCost(t),
      };
      sess.startAt = t.firstAt;
      sess.endAt = t.lastAt;

      for (const [m, c] of Object.entries(t.models)) {
        const nm = normalizeModel(m);
        if (!nm) continue;
        sess.models[nm] = (sess.models[nm] || 0) + c;
        result.models[nm] = (result.models[nm] || 0) + c;
      }

      for (const [nm, c] of Object.entries(t.toolCalls)) {
        sess.toolCalls[nm] = (sess.toolCalls[nm] || 0) + c;
        sess.toolTotal += c;
        result.toolUsage[nm] = (result.toolUsage[nm] || 0) + c;
      }

      // 单会话细分（供侧边面板 / 会话卡片使用）
      sess.timeCats = { ...(t.timeCats || {}) };
      sess.skills = { ...(t.skills || {}) };
      sess.programCounts = { ...(t.programCounts || {}) };
      sess.days = {};

      // 按天 / 按小时
      for (const ev of t.events) {
        if (!ev.at) continue;
        const localTime = localDateHour(ev.at);
        if (!localTime) continue;
        const day = localTime.day;
        sess.days[day] = (sess.days[day] || 0) + ev.in + ev.out;
        const hour = localTime.hour;
        result.daily[day] = result.daily[day] || { tokens: 0, cost: 0, requests: 0, steps: 0 };
        const tok = ev.in + ev.out;
        result.daily[day].tokens += tok;
        result.daily[day].requests++;
        result.daily[day].cost +=
          (ev.in / 1e6) * PRICE.input + (ev.out / 1e6) * PRICE.output + (ev.cache / 1e6) * PRICE.cache;
        if (hour) result.hourly[hour] = (result.hourly[hour] || 0) + tok;
      }

      sess.activeSeconds = t.activeSeconds || 0;
      sess.wallSeconds = t.wallSeconds || 0;

      // 当前上下文 = 最后一次请求的 input + cache
      const ctxUsed = (t.lastInputTokens || 0) + (t.lastCacheTokens || 0);
      const chars = t.ctxParts || {};
      const totalChars = Object.values(chars).reduce((a, b) => a + b, 0);
      const NAMES = {
        sysPrompt: '系统提示词', toolDef: '工具定义', userMsg: '用户消息',
        assistantMsg: '助手消息', toolResult: '工具结果', modelThink: '模型思考',
      };
      const parts = {};
      if (ctxUsed > 0 && totalChars > 0) {
        for (const [k, v] of Object.entries(chars)) {
          if (!v) continue;
          const name = NAMES[k] || k;
          parts[name] = {
            tokens: Math.round(ctxUsed * (v / totalChars)),
            chars: v,
            items: (t.ctxItems && t.ctxItems[k]) || 0,
          };
        }
      }
      sess.context = {
        used: ctxUsed,
        parts,
        requests: t.requests || 0,
      };
      sess.fileOps = (t.fileOps || []).map(function (f) {
        return { ...f, path: redactPath(f.path) };
      });
      sess.truncations = t.truncations || [];
      result.totals.activeSeconds += sess.activeSeconds;
      result.totals.wallSeconds += sess.wallSeconds;

      // 耗时分类累加
      for (const [k, v] of Object.entries(t.timeCats || {})) {
        result.timeCats[k] = (result.timeCats[k] || 0) + (v || 0);
      }

      // 命令执行明细合并
      for (const rec of t.execRecords || []) {
        result.execRecords.push({ ...rec, session: sess.shortId, title: sess.title });
      }
      for (const [k, v] of Object.entries(t.programCounts || {})) {
        result.programCounts[k] = (result.programCounts[k] || 0) + v;
      }
      result.execSummary.failed += t.failedCount || 0;
      result.execSummary.bg += t.bgCount || 0;
      for (const [k, v] of Object.entries(t.exitCodes || {})) {
        result.exitCodes[k] = (result.exitCodes[k] || 0) + v;
      }

      for (const [k, v] of Object.entries(t.skills || {})) {
        result.skills[k] = (result.skills[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(t.types || {})) {
        result.types[k] = (result.types[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(t.statuses || {})) {
        result.statuses[k] = (result.statuses[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(t.commands || {})) {
        sess.commands[k] = (sess.commands[k] || 0) + v;
        result.commands[k] = (result.commands[k] || 0) + v;
      }

      result.totals.requests += sess.tokens.requests;
      result.totals.inputTokens += sess.tokens.input;
      result.totals.cacheReadTokens += sess.tokens.cache;
      result.totals.outputTokens += sess.tokens.output;
      result.totals.totalTokens += sess.tokens.total;
      result.totals.estCostUSD += sess.tokens.costUSD;

      if (t.firstAt && (!result.totals.firstAt || t.firstAt < result.totals.firstAt)) {
        result.totals.firstAt = t.firstAt;
      }
      if (t.lastAt && (!result.totals.lastAt || t.lastAt > result.totals.lastAt)) {
        result.totals.lastAt = t.lastAt;
      }
    }

    // ---- steps DB（文件路径 + 命令 + 状态 + 模型名兜底）----
    if (sess.hasDb) {
      const steps = await query(dbPath, "SELECT idx, status, step_payload FROM steps ORDER BY idx");
      for (const st of steps) {
        const stt = Number(st.status);
        if (stt === 3) sess.okSteps++;
        else if (stt && stt !== 3) sess.failedSteps++;

        if (!st.step_payload) continue;
        for (const c of extractCommands(st.step_payload)) {
          sess.commands[c] = (sess.commands[c] || 0) + 1;
          result.commands[c] = (result.commands[c] || 0) + 1;
        }
        for (const p of extractPaths(st.step_payload)) {
          if (!sess.files.includes(p)) sess.files.push(p);
        }
      }
      // 若 transcript 缺失，退化用 protobuf 抽工具名
      if (!sess.hasTranscript) {
        for (const st of steps) {
          if (!st.step_payload) continue;
          for (const t of extractToolCalls(st.step_payload)) {
            sess.toolCalls[t] = (sess.toolCalls[t] || 0) + 1;
            sess.toolTotal++;
            result.toolUsage[t] = (result.toolUsage[t] || 0) + 1;
          }
        }
      }

      // 模型名权威来源：gen_metadata（transcript 里没有 model 字段）
      const gens = await query(dbPath, "SELECT data FROM gen_metadata");
      const modelCounts = {};
      for (const g of gens) {
        if (!g.data) continue;
        for (const m of extractModels(g.data)) {
          const nm = normalizeModel(m);
          if (nm) modelCounts[nm] = (modelCounts[nm] || 0) + 1;
        }
      }
      for (const [nm, c] of Object.entries(modelCounts)) {
        // transcript 已有则累加，否则赋值
        sess.models[nm] = (sess.models[nm] || 0) + c;
        result.models[nm] = (result.models[nm] || 0) + c;
      }
    }

    for (const p of sess.files) {
      // Windows 路径大小写不敏感：统一小写去重，避免同一个文件出现两条
      const key = String(p).toLowerCase();
      if (!result.__fileSeen) result.__fileSeen = new Map();
      const display = result.__fileSeen.get(key) || p;
      if (!result.__fileSeen.has(key)) result.__fileSeen.set(key, p);
      result.files[display] = (result.files[display] || 0) + 1;
    }

    result.totals.steps += sess.steps;
    result.totals.toolCalls += sess.toolTotal;
    result.totals.okSteps += sess.okSteps;
    result.totals.failedSteps += sess.failedSteps;
    result.sessions.push(sess);
  }

  // fileTypes 基于去重后的文件计算
  for (const p of Object.keys(result.files)) {
    const g = EXT_GROUP[extOf(p)] || "其他";
    result.fileTypes[g] = (result.fileTypes[g] || 0) + 1;
  }
  delete result.__fileSeen;

  result.timeCatsTotal = Object.values(result.timeCats).reduce((a, b) => a + b, 0);

  result.totals.filesTouched = Object.keys(result.files).length;
  result.totals.activeDays = Object.keys(result.daily).length;
  result.totals.outputSpeed =
    result.totals.activeSeconds > 0
      ? Math.round((result.totals.outputTokens / result.totals.activeSeconds) * 10) / 10
      : 0;

  // 日历热力图：按天汇总 token
  for (const [day, v] of Object.entries(result.daily)) {
    result.heatmap[day] = v.tokens || 0;
  }

  const totSteps = result.totals.okSteps + result.totals.failedSteps;
  result.successRate = totSteps > 0 ? Math.round((result.totals.okSteps / totSteps) * 1000) / 10 : null;

  const totalIn = result.totals.inputTokens + result.totals.cacheReadTokens;
  result.cacheHitRate =
    totalIn > 0 ? Math.round((result.totals.cacheReadTokens / totalIn) * 1000) / 10 : null;

  result.sessions.sort((a, b) => String(b.lastModified || "").localeCompare(String(a.lastModified || "")));
  result.toolUsage = sortObj(result.toolUsage);
  result.models = sortObj(result.models);
  result.files = sortObj(result.files);
  result.fileTypes = sortObj(result.fileTypes);
  result.commands = sortObj(result.commands);
  result.workspaces = sortObj(result.workspaces);
  result.skills = sortObj(result.skills);
  result.types = sortObj(result.types);
  result.statuses = sortObj(result.statuses);
  result.programCounts = sortObj(result.programCounts);

  // 命令执行汇总
  const execs = result.execRecords;
  result.execSummary.total = execs.length;
  const withDur = execs.filter((x) => typeof x.durSec === "number" && x.durSec > 0);
  result.execSummary.totalSeconds = Math.round(withDur.reduce((a, b) => a + b.durSec, 0));
  result.execSummary.avgSeconds =
    withDur.length > 0
      ? Math.round((result.execSummary.totalSeconds / withDur.length) * 10) / 10
      : 0;
  const cmdLike = execs.filter((x) => x.prog || x.exitCode !== null);
  result.execSummary.successRate =
    cmdLike.length > 0
      ? Math.round(((cmdLike.length - result.execSummary.failed) / cmdLike.length) * 1000) / 10
      : null;

  // 按时间倒序，保留最近 400 条
  result.execRecords = execs
    .slice()
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, 400);

  return result;
}

/* ---------------- 文本输出 ---------------- */

const fn = (n) => {
  n = Number(n) || 0;
  return n >= 1e9 ? (n / 1e9).toFixed(2) + "G"
       : n >= 1e6 ? (n / 1e6).toFixed(2) + "M"
       : n >= 1e3 ? (n / 1e3).toFixed(1) + "k"
       : String(n);
};
const bar = (n, max, w = 20) => (max <= 0 ? "" : "█".repeat(Math.max(1, Math.round((n / max) * w))));
const usd = (v) => "$" + (v < 0.01 ? v.toFixed(4) : v.toFixed(2));

function renderOverview(d) {
  const L = [];
  const t = d.totals;
  L.push("");
  L.push("═".repeat(64));
  L.push("  Antigravity 会话统计  ·  " + d.range);
  L.push("═".repeat(64));
  L.push("  数据目录: " + d.appDir);   // 已在 collectAll 中脱敏  L.push("");

  L.push("【用量总览】");
  L.push("  请求数      " + fn(t.requests));
  L.push("  输入 Token  " + fn(t.inputTokens));
  L.push("  缓存读取    " + fn(t.cacheReadTokens) + (d.cacheHitRate != null ? "  (缓存命中率 " + d.cacheHitRate + "%)" : ""));
  L.push("  输出 Token  " + fn(t.outputTokens));
  L.push("  总 Token    " + fn(t.totalTokens) + "  (输入+输出)");
  L.push("  估算成本    " + usd(t.estCostUSD));
  L.push("");

  L.push("【活动】");
  L.push("  会话数      " + t.sessions + (t.allSessions !== t.sessions ? " / 全部 " + t.allSessions : ""));
  L.push("  活跃天数    " + t.activeDays);
  L.push("  总步数      " + fn(t.steps));
  L.push("  工具调用    " + fn(t.toolCalls));
  L.push("  子 Agent    " + t.subagents);
  if (d.successRate != null) L.push("  步成功率    " + d.successRate + "%  (" + t.okSteps + " 成功 / " + t.failedSteps + " 异常)");
  if (t.firstAt) L.push("  时间跨度    " + String(t.firstAt).slice(0, 10) + " → " + String(t.lastAt).slice(0, 10));
  L.push("");

  const daily = Object.entries(d.daily).sort((a, b) => a[0].localeCompare(b[0])).slice(-10);
  if (daily.length) {
    L.push("【每日用量】");
    const max = Math.max(...daily.map((x) => x[1].tokens));
    for (const [day, v] of daily) {
      L.push("  " + day + "  " + fn(v.tokens).padStart(7) + "  " + usd(v.cost).padStart(8) + "  " + bar(v.tokens, max, 16));
    }
    L.push("");
  }

  const hourly = Object.entries(d.hourly).sort((a, b) => a[0].localeCompare(b[0]));
  if (hourly.length) {
    L.push("【活跃时段（系统本地小时）】");
    const max = Math.max(...hourly.map((x) => x[1]));
    for (const [h, v] of hourly) {
      L.push("  " + h + ":00  " + fn(v).padStart(7) + "  " + bar(v, max, 16));
    }
    L.push("");
  }

  const tools = Object.entries(d.toolUsage).slice(0, 8);
  if (tools.length) {
    L.push("【工具使用】");
    const max = tools[0][1];
    for (const [n, c] of tools) L.push("  " + n.padEnd(24) + String(c).padStart(4) + "  " + bar(c, max));
    L.push("");
  }

  const models = Object.entries(d.models).slice(0, 6);
  if (models.length) {
    L.push("【模型使用】");
    const max = models[0][1];
    for (const [n, c] of models) L.push("  " + n.padEnd(24) + String(c).padStart(4) + "  " + bar(c, max));
    L.push("");
  }

  const cmds = Object.entries(d.commands).slice(0, 8);
  if (cmds.length) {
    L.push("【常用命令】");
    const max = cmds[0][1];
    for (const [n, c] of cmds) L.push("  " + n.padEnd(24) + String(c).padStart(4) + "  " + bar(c, max));
    L.push("");
  }

  const types = Object.entries(d.fileTypes).slice(0, 8);
  if (types.length) {
    L.push("【文件类型】");
    const max = types[0][1];
    for (const [n, c] of types) L.push("  " + n.padEnd(24) + String(c).padStart(4) + "  " + bar(c, max));
    L.push("");
  }

  const wsEntries = Object.entries(d.workspaces).slice(0, 6);
  if (wsEntries.length) {
    L.push("【工作区】");
    for (const [w, c] of wsEntries) L.push("  " + String(c).padStart(3) + " 个会话  " + w);
    L.push("");
  }

  const fileEntries = Object.entries(redactFiles(d.files)).slice(0, 10);
  if (fileEntries.length) {
    L.push("【高频文件】（仅文件名，路径已省略）");
    for (const [name, c] of fileEntries) L.push("  " + String(c).padStart(3) + "x  " + name);
    L.push("");
  }

  L.push("【会话 Top12（按 Token）】");
  const byTok = [...d.sessions].sort((a, b) => b.tokens.total - a.tokens.total).slice(0, 12);
  for (const s of byTok) {
    L.push("  " + (s.isSubagent ? "↳" : "●") + " " + s.shortId +
      "  " + fn(s.tokens.total).padStart(8) + " tok" +
      "  " + usd(s.tokens.costUSD).padStart(8) +
      "  " + String(s.tokens.requests).padStart(4) + " req");
    L.push("     " + s.title.slice(0, 54));
  }

  L.push("");
  L.push("─".repeat(64));
  L.push("  成本为估算（输入 $" + d.pricing.input + "/M、输出 $" +
    d.pricing.output + "/M、缓存 $" + d.pricing.cache + "/M），非官方账单。");
  L.push("");
  return L.join("\n");
}

function renderSession(d, s) {
  const L = [];
  L.push("");
  L.push("═".repeat(64));
  L.push("  会话 " + s.shortId);
  L.push("═".repeat(64));
  L.push("  标题    " + s.title);
  L.push("  步数    " + s.steps + (s.okSteps + s.failedSteps > 0 ? "  (" + s.okSteps + " 成功 / " + s.failedSteps + " 异常)" : ""));
  L.push("  状态    " + (s.status || "-"));
  if (s.workspace.length) L.push("  工作区  " + s.workspace.map(redact).join(", "));
  if (s.startAt) L.push("  时间    " + s.startAt + " → " + s.endAt);
  if (s.isSubagent) L.push("  子 Agent（父: " + String(s.parent).slice(0, 8) + "）");
  L.push("");
  L.push("【Token 用量】");
  L.push("  请求数    " + s.tokens.requests);
  L.push("  输入      " + fn(s.tokens.input));
  L.push("  缓存读取  " + fn(s.tokens.cache));
  L.push("  输出      " + fn(s.tokens.output));
  L.push("  合计      " + fn(s.tokens.total));
  L.push("  估算成本  " + usd(s.tokens.costUSD));
  L.push("");

  const tools = Object.entries(s.toolCalls).sort((a, b) => b[1] - a[1]);
  if (tools.length) {
    L.push("【工具调用】");
    const max = tools[0][1];
    for (const [n, c] of tools) L.push("  " + n.padEnd(24) + String(c).padStart(4) + "  " + bar(c, max));
    L.push("");
  }
  const models = Object.entries(s.models).sort((a, b) => b[1] - a[1]);
  if (models.length) {
    L.push("【模型】");
    for (const [n, c] of models) L.push("  " + n.padEnd(24) + String(c).padStart(4));
    L.push("");
  }
  if (s.files.length) {
    L.push("【涉及文件 " + s.files.length + " 个】（仅文件名）");
    const names = s.files.map((p) => String(p).split(/[\\/]/).pop()).filter(Boolean);
    for (const n of names.slice(0, 20)) L.push("  " + n);
    if (names.length > 20) L.push("  … 还有 " + (names.length - 20) + " 个");
    L.push("");
  }
  return L.join("\n");
}

/* ---------------- CLI ---------------- */

function parseArgs(argv) {
  const o = { days: 0, session: null, json: false, appDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--days") o.days = Number(argv[++i]) || 0;
    else if (a === "--session") o.session = argv[++i] || null;
    else if (a === "--app-dir") o.appDir = argv[++i] || null;
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("用法: node stats.mjs [选项]\n\n  --json / --days N / --session <前缀> / --app-dir <dir> / -h");
    return;
  }
  const appDir = findAppDir(opts.appDir);
  if (!appDir) {
    const msg = "找不到 Antigravity 数据目录。已尝试:\n  " + APP_DIRS.map((x) => redact(x)).join("\n  ");
    if (opts.json) console.log(JSON.stringify({ error: msg }, null, 2));
    else console.error(msg);
    process.exitCode = 1;
    return;
  }
  const data = await collectAll(appDir, opts);
  if (opts.session) {
    const key = opts.session.toLowerCase();
    const s = data.sessions.find((x) => x.id.toLowerCase().startsWith(key) || x.shortId.toLowerCase() === key);
    if (!s) {
      const msg = "未找到会话: " + opts.session;
      if (opts.json) console.log(JSON.stringify({ error: msg }, null, 2));
      else console.error(msg);
      process.exitCode = 1;
      return;
    }
    if (opts.json) console.log(JSON.stringify(s, null, 2));
    else console.log(renderSession(data, s));
    return;
  }
  if (opts.json) console.log(JSON.stringify(data, null, 2));
  else console.log(renderOverview(data));
}

// 仅在作为命令行入口时执行 main()；被 sidecar import 时只导出函数（避免每次刷新都 spawn 子进程）
const IS_MAIN = (() => {
  try { return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (IS_MAIN) {
  main().catch((e) => {
    console.error("统计失败:", e?.message || e); console.error(e?.stack || "");
    process.exitCode = 1;
  });
}
