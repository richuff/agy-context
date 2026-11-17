---
name: agy-stats
description: 统计 Antigravity 的历史会话数据：token 用量、估算成本、缓存命中率、每日趋势、工具调用、涉及文件、模型分布、子 Agent。当用户问"我用了多少 token""花了多少钱""最近改了什么""哪个工具用得最多"时使用。
---

# Antigravity 会话统计

从 Antigravity 本地数据读取真实用量统计。

## 何时使用

- 「我用了多少 token / 花了多少钱？」
- 「最近几天的用量趋势？」
- 「改了哪些文件？什么工具用得最多？」
- 「哪个会话最费 token？」
- 「缓存命中率怎么样？」

## 执行方式

```bash
node "<plugin_root>/scripts/stats.mjs"
```

### 参数

| 命令 | 作用 |
|---|---|
| `node scripts/stats.mjs` | 全局概览 |
| `node scripts/stats.mjs --days 7` | 最近 7 天 |
| `node scripts/stats.mjs --session 521b7d3e` | 单会话详情 |
| `node scripts/stats.mjs --json` | 机器可读 |

## 数据能回答什么

| 指标 | 说明 |
|---|---|
| **请求数** | 模型调用次数 |
| **输入 / 输出 Token** | 实际计费用量 |
| **缓存读取 Token** | 命中缓存的读取量（不重复计费） |
| **缓存命中率** | 缓存读取 / (输入 + 缓存读取) |
| **估算成本** | 按公开单价折算，**非官方账单** |
| **每日 / 每小时用量** | 时间分布 |
| **步成功率** | 正常完成步数 / 总步数 |
| **工具调用** | 各工具次数 |
| **文件涉及** | 改过的文件 + 类型分布 |
| **模型分布** | 各模型调用次数 |
| **子 Agent** | 父子会话树 |

## 怎么回答用户

### 问 token / 成本

直接给数字，并说明口径：

> 你总共用了 **976k token**（902k 输入 + 74k 输出），缓存读取 12.78M，命中率 93.4%。
> 按公开单价估算约 **$5.83**。这是估算值，实际以 Google 账单为准。

### 问趋势

> 11-14 用了 638k token（$4.50），11-15 用了 338k（$1.32）。

### 问「花在哪了」

> 最费的是会话 `521b7d3e`（MiniSTL 数据结实现），809k token，占总量 83%。
> 主力模型 gemini-3.8-flash（134 次），claude-opus-4-6 thinking 用了 75 次。

### 必须说明的边界

1. **成本是估算** —— 按公开参考价折算，不是 Google 实际账单
2. **缓存读取不计入总 token** —— 它按折扣价计费，单独列示
3. **时间戳按系统本地时区分组** —— 每日用量和活跃时段均先转换为当前电脑的本地时间
4. **上下文事件来自 transcript 实际记录** —— 包含可用的工具调用参数与工具输出，可按类型筛选、按文本搜索；路径展示前脱敏，长内容最多显示 6000 字符，未被 transcript 保存的内容无法还原

## 数据来源

| 文件 | 提供什么 |
|---|---|
| `conversation_summaries.db` | 标题、步数、父子关系、工作区 |
| `conversations/<id>.db` | `steps`（工具/命令/文件）、`gen_metadata`（模型名） |
| `brain/<id>/.system_generated/logs/transcript.jsonl` | **token 用量**、时间戳、tool_calls |

CLI 版在 `~/.gemini/antigravity-cli/`，IDE 版在 `~/.gemini/antigravity-ide/`。

## 计价口径调整

可用环境变量覆盖估算单价（USD / 1M tokens）：

```bash
AGY_PRICE_IN=1.25 AGY_PRICE_OUT=10.0 AGY_PRICE_CACHE=0.31 node scripts/stats.mjs
```

## 已知限制

1. **成本是估算** —— 单价固定，不区分模型档位
2. **工具名可能有漏** —— 从 protobuf 字节扫描，极少数会漏
3. **文件路径含噪音** —— 包含「对话里提到过」但没真正编辑的路径
4. **子 Agent 会话常无标题** —— 系统创建，显示「(未命名)」
