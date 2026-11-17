#!/usr/bin/env node
/**
 * test-stats.mjs — agy-context 统计引擎测试
 *
 * 用法：
 *   node test/test-stats.mjs            # 全量测试
 *   node test/test-stats.mjs --verbose  # 显示每条
 *
 * 覆盖：纯函数单元测试 + 真实数据集成测试
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const SCRIPT = join(ROOT, "scripts", "stats.mjs");

const verbose = process.argv.includes("--verbose");
let pass = 0;
let fail = 0;
const failures = [];

function ok(n, d) {
  pass++;
  if (verbose) console.log(`  ✔ ${n}${d ? "  — " + d : ""}`);
}
function bad(n, d) {
  fail++;
  failures.push({ n, d });
  console.log(`  ✘ ${n}${d ? "\n      " + d : ""}`);
}

function run(args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 180000,
  });
  return { out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), code: r.status };
}

// ============================================================
console.log("\n" + "═".repeat(62));
console.log("agy-context 测试");
console.log("═".repeat(62));

// ---------- 1. 导入导出函数 ----------
console.log("\n【1】解析函数单元测试");

let mod;
try {
  mod = await import(`file://${SCRIPT.replace(/\\/g, "/")}`);
} catch (e) {
  bad("模块可导入", String(e));
}

if (mod) {
  const { extractToolCalls, extractPaths, extractModels, parseTranscript, localDateHour } = mod;

  // extractToolCalls
  {
    // 构造一个含工具调用的伪 protobuf payload
    const payload = Buffer.concat([
      Buffer.from([0x0a, 0x1f]),
      Buffer.from("call_1234567890123456789"),
      Buffer.from([0x12, 0x09]),
      Buffer.from("run_command"),
      Buffer.from([0x1a, 0x01, 0x7b]),
      Buffer.from('{"CommandLine":"ls"}'),
    ]);
    const tools = extractToolCalls(payload);
    if (tools.length === 1 && tools[0] === "run_command") ok("extractToolCalls 识别 run_command", tools.join(","));
    else bad("extractToolCalls 识别 run_command", JSON.stringify(tools));
  }

  {
    const payload = Buffer.from("call_999\x12\x09read_file\x1a\x01{", "latin1");
    const tools = extractToolCalls(payload);
    if (tools.includes("read_file")) ok("extractToolCalls 识别 read_file", tools.join(","));
    else bad("extractToolCalls 识别 read_file", JSON.stringify(tools));
  }

  {
    const payload = Buffer.from("no calls here at all", "latin1");
    const tools = extractToolCalls(payload);
    if (tools.length === 0) ok("extractToolCalls 无调用时返回空");
    else bad("extractToolCalls 无调用时返回空", JSON.stringify(tools));
  }

  // Uint8Array 支持（这是踩过的坑）
  {
    const src = Buffer.from("call_555\x12\x09edit_file\x1a\x01{", "latin1");
    const u8 = new Uint8Array(src);
    const tools = extractToolCalls(u8);
    if (tools.includes("edit_file")) ok("extractToolCalls 支持 Uint8Array", "关键修复点");
    else bad("extractToolCalls 支持 Uint8Array", `返回: ${JSON.stringify(tools)}（Uint8Array 未正确处理）`);
  }

  // extractPaths
  {
    // protobuf 里存的是单反斜杠路径（不是 JSON 转义形态）
    const payload = Buffer.from("D:\\Mygit\\MiniSTL\\General\\LinkList.hpp", "latin1");
    const paths = extractPaths(payload);
    if (paths.some((p) => p.includes("LinkList.hpp"))) ok("extractPaths 识别 Windows 路径", paths[0]);
    else bad("extractPaths 识别 Windows 路径", JSON.stringify(paths));
  }

  {
    const payload = Buffer.from("D:\\proj\\node_modules\\x\\a.js", "latin1");
    const paths = extractPaths(payload);
    if (!paths.some((p) => p.includes("node_modules"))) ok("extractPaths 过滤 node_modules");
    else bad("extractPaths 过滤 node_modules", JSON.stringify(paths));
  }

  {
    const payload = Buffer.from("d:\\Mygit:}file:///C:/Users/x/a.hpp", "latin1");
    const paths = extractPaths(payload);
    if (!paths.some((p) => p.includes(":}file:///"))) ok("extractPaths 清理脏前缀", JSON.stringify(paths));
    else bad("extractPaths 清理脏前缀", JSON.stringify(paths));
  }

  // extractModels：返回原始模型名（含 -thinking 等后缀，归并交给 normalizeModel）
  {
    const payload = Buffer.from("abc claude-opus-4-6-thinking def gemini-3.8-flash xyz", "latin1");
    const models = extractModels(payload);
    if (models.includes("claude-opus-4-6-thinking") && models.includes("gemini-3.8-flash"))
      ok("extractModels 返回原始模型名", models.join(","));
    else bad("extractModels 返回原始模型名", JSON.stringify(models));
  }

  {
    const models = extractModels(Buffer.from("nothing here", "latin1"));
    if (models.length === 0) ok("extractModels 无模型时返回空");
    else bad("extractModels 无模型时返回空", JSON.stringify(models));
  }

  {
    const stamp = "2026-11-17T23:30:00Z";
    const date = new Date(stamp);
    const pad = (n) => String(n).padStart(2, "0");
    const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}`;
    const actual = localDateHour(stamp);
    if (actual && `${actual.day} ${actual.hour}` === expected) ok("活跃日期与小时使用系统本地时区");
    else bad("活跃日期与小时使用系统本地时区", JSON.stringify(actual));
  }

  {
    const dir = mkdtempSync(join(tmpdir(), "agy-context-events-"));
    const transcript = join(dir, "transcript.jsonl");
    const rows = [
      { type: "GENERIC", step_index: 1, created_at: "2026-11-17T10:00:00Z", content: "Tool output at D:\\workspace\\private\\secret.txt: done" },
      { type: "PLANNER_RESPONSE", step_index: 2, created_at: "2026-11-17T10:00:01Z", thinking: "Model thinking", content: "Model response" },
      { type: "SYSTEM_MESSAGE", step_index: 3, created_at: "2026-11-17T10:00:02Z", content: "System notice" },
      { type: "USER_INPUT", step_index: 4, created_at: "2026-11-17T10:00:03Z", content: "User question" },
      { type: "ERROR_MESSAGE", step_index: 5, created_at: "2026-11-17T10:00:04Z", content: "An error occurred" },
      { type: "CHECKPOINT", step_index: 6, created_at: "2026-11-17T10:00:05Z", truncated_fields: ["content"] },
      {
        type: "PLANNER_RESPONSE", step_index: 7, created_at: "2026-11-17T10:00:06Z", content: "Applied a file edit",
        tool_calls: [{ name: "edit_file", args: {
          TargetFile: "D:\\workspace\\private\\src\\demo.js",
          TargetContent: "const answer = 40;",
          ReplacementContent: "const answer = 42;",
        } }],
      },
    ];
    try {
      writeFileSync(transcript, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
      const summary = parseTranscript(transcript);
      const captured = parseTranscript(transcript, { captureContextEvents: true, captureFileChanges: true });
      const types = new Set(captured.contextEvents.map((event) => event.type));
      const toolOutput = captured.contextEvents.find((event) => event.type === "GENERIC");
      const toolInput = captured.contextEvents.find((event) => event.type === "TOOL_CALL_INPUT");
      const fileEdit = captured.fileOps.find((op) => op.op === "edit");
      if (summary.contextEventCount === rows.length && summary.contextEvents.length === 0
          && captured.contextEvents.length === rows.length + 1
          && ["GENERIC", "TOOL_CALL_INPUT", "PLANNER_RESPONSE", "SYSTEM_MESSAGE", "USER_INPUT"].every((type) => types.has(type))
          && toolOutput && !/(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(toolOutput.text)
          && toolInput?.tool === "edit_file"
          && toolInput.text.includes("const answer = 42;")
          && !/(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(toolInput.text)
          && fileEdit?.changes?.removed?.[0] === "const answer = 40;"
          && fileEdit?.changes?.added?.[0] === "const answer = 42;"
          && !/(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(fileEdit?.path || "")
          && !summary.fileOps[0]?.changes)
        ok("上下文事件捕获工具输入输出与文件增删行，并脱敏路径");
      else bad("工具输入输出与文件修改行捕获", JSON.stringify({ count: summary.contextEventCount, captured: captured.contextEvents.length, types: [...types], toolInput, fileEdit }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---------- 2. CLI 行为 ----------
console.log("\n【2】CLI 行为");

{
  const r = run(["--help"]);
  if (r.code === 0 && r.out.includes("--json") && r.out.includes("--session"))
    ok("--help 显示用法");
  else bad("--help 显示用法", r.err || r.out.slice(0, 200));
}

{
  const r = run(["--json"]);
  let d = null;
  try {
    d = JSON.parse(r.out);
  } catch {
    /* 下面处理 */
  }
  if (!d) {
    bad("--json 输出合法 JSON", (r.err || r.out).slice(0, 300));
  } else {
    ok("--json 输出合法 JSON");
    const checks = [
      ["含 appDir", typeof d.appDir === "string"],
      ["含 totals", d.totals && typeof d.totals === "object"],
      ["含 sessions 数组", Array.isArray(d.sessions)],
      ["含 toolUsage", d.toolUsage && typeof d.toolUsage === "object"],
      ["含 models", d.models && typeof d.models === "object"],
      ["含 files", d.files && typeof d.files === "object"],
      ["含 token 总量（精确值）", d.totals && typeof d.totals.inputTokens === "number"
        && typeof d.totals.outputTokens === "number" && typeof d.totals.cacheReadTokens === "number"],
    ];
    for (const [label, cond] of checks) {
      if (cond) ok(label);
      else bad(label, JSON.stringify(d).slice(0, 250));
    }
  }
}

{
  const r = run(["--json", "--days", "1"]);
  let d = null;
  try {
    d = JSON.parse(r.out);
  } catch {
    /* */
  }
  if (d && Array.isArray(d.sessions)) ok("--days 参数可用", `${d.sessions.length} 个会话`);
  else bad("--days 参数可用", r.err || r.out.slice(0, 200));
}

{
  const r = run(["--session", "zzzznotexist"]);
  if (r.code !== 0 || /未找到/.test(r.err + r.out)) ok("不存在的会话返回错误");
  else bad("不存在的会话返回错误", `code=${r.code} ${r.out.slice(0, 200)}`);
}

{
  const r = run(["--app-dir", join(tmpdir(), "nonexistent-agy-dir-xyz")]);
  if (r.code !== 0 || /找不到/.test(r.err + r.out)) ok("无效 --app-dir 返回错误");
  else bad("无效 --app-dir 返回错误", `code=${r.code} ${r.out.slice(0, 200)}`);
}

// ---------- 3. 真实数据集成 ----------
console.log("\n【3】真实数据集成");

const realAppDir = join(homedir(), ".gemini", "antigravity");
const hasReal = existsSync(join(realAppDir, "conversation_summaries.db"));

if (!hasReal) {
  console.log("  (跳过：本机没有 Antigravity 数据)");
} else {
  const r = run(["--json"]);
  let d = null;
  try {
    d = JSON.parse(r.out);
  } catch {
    /* */
  }

  if (!d) {
    bad("读取真实数据", (r.err || r.out).slice(0, 300));
  } else {
    ok("读取真实数据成功", `${d.totals.sessions} 个会话`);

    const checks = [
      ["会话数 > 0", d.totals.sessions > 0],
      ["总步数 > 0", d.totals.steps > 0],
      ["能提取工具调用", d.totals.toolCalls > 0, `实际 ${d.totals.toolCalls}`],
      ["能提取文件路径", d.totals.filesTouched > 0, `实际 ${d.totals.filesTouched}`],
      ["能提取模型名", Object.keys(d.models).length > 0, JSON.stringify(Object.keys(d.models).slice(0, 4))],
      ["会话含 lastModified", d.sessions.some((s) => s.lastModified)],
      ["会话含 isSubagent 字段", d.sessions.every((s) => typeof s.isSubagent === "boolean")],
    ];
    for (const [label, cond, detail] of checks) {
      if (cond) ok(label, detail);
      else bad(label, detail || JSON.stringify(d.totals));
    }

    // 挑一个真实会话测 --session
    const target = d.sessions.find((s) => s.steps > 0);
    if (target) {
      const r2 = run(["--session", target.shortId, "--json"]);
      let s2 = null;
      try {
        s2 = JSON.parse(r2.out);
      } catch {
        /* */
      }
      if (s2 && s2.id === target.id) ok("--session 能定位会话", target.shortId);
      else bad("--session 能定位会话", r2.err || r2.out.slice(0, 200));
    }

    // 文本输出应可读
    const r3 = run([]);
    if (r3.code === 0 && r3.out.includes("总览") && r3.out.includes("工具使用")) {
      ok("默认文本输出可读");
    } else {
      bad("默认文本输出可读", r3.err || r3.out.slice(0, 200));
    }
  }
}

// ---------- 4. 清单结构 ----------
console.log("\n【4】插件清单");

{
  const { readFileSync } = await import("node:fs");
  const pj = join(ROOT, "plugin.json");
  if (!existsSync(pj)) {
    bad("plugin.json 存在");
  } else {
    let m;
    try {
      m = JSON.parse(readFileSync(pj, "utf8").replace(/^\uFEFF/, ""));
    } catch (e) {
      bad("plugin.json 合法", String(e));
    }
    if (m) {
      const checks = [
        ["name 正确", m.name === "agy-context"],
        ["有 version", typeof m.version === "string"],
        ["有 description", typeof m.description === "string" && m.description.length > 10],
        ["有 license", typeof m.license === "string"],
        ["logo 文件存在", m.logo && existsSync(join(ROOT, m.logo))],
      ];
      for (const [label, cond] of checks) {
        if (cond) ok(label);
        else bad(label, JSON.stringify(m).slice(0, 200));
      }
    }
  }

  const sk = join(ROOT, "skills", "agy-stats", "SKILL.md");
  if (!existsSync(sk)) {
    bad("SKILL.md 存在");
  } else {
    const t = readFileSync(sk, "utf8").replace(/^\uFEFF/, "");
    const checks = [
      ["有 frontmatter", t.startsWith("---")],
      ["有 name 字段", /^name:\s*agy-stats/m.test(t)],
      ["有 description", /^description:\s*\S/m.test(t)],
      ["说明了 token 限制", /token/i.test(t)],
    ];
    for (const [label, cond] of checks) {
      if (cond) ok(`SKILL: ${label}`);
      else bad(`SKILL: ${label}`, t.slice(0, 150));
    }
  }
}

// ============================================================
console.log("\n" + "═".repeat(62));
console.log(`结果: ${pass} 通过, ${fail} 失败, 共 ${pass + fail} 项`);
console.log("═".repeat(62));
if (fail > 0) {
  console.log("\n失败项:");
  for (const f of failures) console.log(`  ✘ ${f.n}${f.d ? "\n      " + f.d : ""}`);
  process.exit(1);
}
process.exit(0);
