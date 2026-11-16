# agy-context

> **🌐 [English](./README.md)**

Antigravity 会话统计插件 — 在侧边面板实时显示当前会话的 Token 消耗、上下文占用、耗时构成、工具调用和文件活动，另有全局总览页。

所有数据**全部来自本地**，不联网、不上传。

---

## 功能

### 侧边面板（随会话实时更新）

打开右侧面板（`Ctrl+Shift+B`），顶部即当前会话的统计。侧边卡片**默认折叠**，标题为「<会话名> · 上下文」，点击展开完整卡片。

| 区块 | 内容 |
|---|---|
| **会话头** | 标题、会话 ID、步数、更新时间 |
| **KPI** | Token 消耗 · 预估费用 · 缓存命中 · 活跃时长 |
| **当前上下文** | 已用量 / 窗口大小、占用百分比、彩色堆叠条、6 项构成明细 |
| **上下文事件** | 内容被截断（上下文压缩）的记录 |
| **文件活动** | 每个文件的写 / 改 / 读次数与字符量 |
| **模型分布** | 本会话用到的模型及调用次数 |
| **文件类型** | 按扩展名归类 |
| **活跃时段** | 24 小时分布 |
| **命令执行** | 完整命令历史，可按失败 / 慢 / 后台筛选，点击行展开输出 |

卡片布局与总览页完全一致，栅格自动塌成单列。

### 上下文总览（侧边栏「上下文总览」）

全局视角，聚合所有会话：

- 全部会话数、Token 总消耗、预估总费用
- 缓存命中率、工具调用总数、活跃时长
- 近 14 天用量柱状图（Token / 费用双轴）
- Token 构成环形图、耗时构成环形图
- 活跃度热力图（7 行 × N 周，可切 Token / 轮次 / 会话）
- 技能加载、工具调用、命令执行排行
- 会话列表（搜索 / 按工作区筛选 / 排序 / 跳转）

---

## 设置与国际化

总览页右上角齿轮按钮，分两组：

### 基础设置（panel.js 原生）

| 项 | 说明 |
|---|---|
| **上下文窗口** | 200K / 1.0M / 2.0M，影响上下文占用百分比的计算 |
| **自动刷新** | 是否随 sidecar 推送自动重绘 |
| **紧凑模式** | 缩小卡片内边距和字号 |

### 外观与行为（i18n 层追加）

| 项 | 说明 |
|---|---|
| **语言 / Language** | **EN / 中文** 切换，默认英文 |
| **界面缩放** | 90% / 100% / 110% |
| **显示侧边卡片** | 是否注入右侧面板的当前会话卡片 |
| **显示侧边栏入口** | 是否显示「Context Overview」菜单项 |
| **恢复默认** | 一键还原全部设置（含语言回英文） |

### 国际化实现

翻译由独立文件 `sidecars/context-panel/i18n.js` 完成，作为一段独立脚本追加在
`panel.js` 之后注入，**不修改 UI 源码中的任何字符串字面量**：

- 通过 `TreeWalker` 遍历插件自身四个容器（总览浮层 / 侧边卡片 / 菜单项 / 浮动提示）内的文本节点
- 用中→英词典按「长词优先」做替换，WeakMap 保存原文用于中文还原
- `title` / `data-tip` / `placeholder` 属性同样翻译
- `MutationObserver` 回调是微任务，在浏览器绘制前同步翻译，因此 sidecar 每 5 秒重绘出的新内容不会闪出中文
- 只处理插件自己的 DOM，**绝不碰 Antigravity 宿主界面**

所有设置保存在 `localStorage`（键前缀 `agy-context:`），重启后保留。
语言键为 `agy-context:lang`，取值 `en` / `zh`。

---

## 安装

**从 GitHub 直接安装**（无需上架 Marketplace，`agy` 会克隆仓库）：

```bash
agy plugin install https://github.com/richuff/agy-context
```

在 CLI 交互界面里也可以用 `/plugin install https://github.com/richuff/agy-context`。

本地目录或本地仓库：

```bash
agy plugin install ./agy-context
```

> 安装后可在 Antigravity App 的 **Customizations → Installed**，或 `agy plugin list` 中查看。
> 更新版本：`agy plugin uninstall agy-context` 后重新安装；或直接重跑安装命令。

安装后需在 `~/.gemini/config/config.json` 启用 sidecar：

```json
{
  "sidecars": {
    "agy-context/context-panel": { "enabled": true }
  }
}
```

重启 Antigravity 生效。

---

## 发布

### 方式一：GitHub 直装（已可用，无需审核）

官方 `agy plugin install` 支持直接传 GitHub 仓库 URL。只要仓库是 public、根目录有合法的
`plugin.json`，任何人执行下面命令即可安装：

```bash
agy plugin install https://github.com/richuff/agy-context
```

### 方式二：上架 Antigravity Marketplace（需 Google 审核）

上架后用户可通过 `agy plugin install agy-context` 或在 App 的 **Marketplace** 标签里搜索安装。

前置条件（本项目已满足）：

| 检查 | 状态 |
|---|---|
| `agy plugin validate` 零 error | ✅ |
| `plugin.json` 含 `name` / `displayName` / `description` / `version` / `logo` / `suggestedPrompts` / `author` | ✅ |
| `README.md` + 内置 1:1 logo（`assets/logo.jpg`） | ✅ |
| 组件路径符合规范（skills/、sidecars/ 等） | ✅ |

提交入口：[Antigravity Marketplace partner intake form](https://forms.gle/2EX5RFYPoJe1UgxR9)

> `agy plugin validate --strict` 会对根目录 `AGENTS.md` 报一条警告（"plugins load rules only from rules/"）。
> 这是官方所述的**多工具仓库预期行为**——`AGENTS.md` 是给贡献者看的常驻硬约束，
> 故意不放入 `rules/` 以免注入到最终用户会话。按官方 CI 过滤方案排除该文件后，
> 发布阻塞项为 0。

### 发版流程

1. 改 `plugin.json` 的 `version`（SemVer）
2. 跑 `agy plugin validate .` 与 `node test/test-stats.mjs`
3. `git commit` + `git tag v3.0.1` + `git push --tags`
4. 用户卸载重装即可拿到新版本

---

## 数据来源

全部读自 `~/.gemini/antigravity/` 下的本地文件：

| 数据 | 来源 |
|---|---|
| 会话列表、标题、步数 | `conversation_summaries.db` |
| Token 用量 | `brain/<id>/.system_generated/logs/transcript.jsonl` 的 `input_tokens` / `cache_read_tokens` / `output_tokens` |
| 工具调用 | transcript 的 `tool_calls` |
| 命令与输出 | `tool_calls` 的 `run_command` + `GENERIC` 记录 |
| 文件操作 | `tool_calls` 的 `write_file` / `edit_file` / `read_file` |
| 上下文构成 | 按各类消息的字符占比映射到实际 token |
| 上下文事件 | transcript 的 `truncated_fields` |
| 模型名称 | `conversations/<id>.db` 的 `gen_metadata` |

### 上下文怎么算

**已用量 = 最后一次请求的 `input_tokens + cache_read_tokens`**

这是精确值。分项（系统提示词 / 工具定义 / 用户消息 / 助手消息 / 模型思考 / 工具结果）按 transcript 中各类消息的字符数占比推算，是估算值。

### 耗时怎么算

取相邻事件时间戳的间隔，按**后一个事件的类型**归类：

| 后一个事件 | 归类 |
|---|---|
| `GENERIC` | 工具执行 |
| `PLANNER_RESPONSE` + thinking | 模型思考 |
| `PLANNER_RESPONSE` 无 thinking | 模型回复 |
| `SYSTEM_MESSAGE` | 系统开销 |
| `USER_INPUT` | 等待输入 |

间隔 > 5 分钟的视为空闲，不计入活跃时长。

---

## 隐私

所有路径在展示前经过脱敏：

| 原始 | 显示 |
|---|---|
| `C:\Users\<user>\...` | `~\...` |
| `C:\Users\<user>\.gemini\antigravity\brain\<uuid>\scratch\x.exe` | `~\…\scratch\x.exe` |
| `D:\Mygit\foo\bar.hpp` | `…\foo\bar.hpp` |

- 主目录折叠为 `~`
- 深层路径压缩为 `…\最后两段`
- 盘符路径去掉盘符
- 文件列表只显示文件名

侧边面板不显示 `.gemini` 内部路径。

---

## 费用估算

按公开 API 单价计算，**不是官方账单**：

| 项 | 单价 |
|---|---|
| 输入 | $1.25 / M tokens |
| 输出 | $10 / M tokens |
| 缓存读取 | $0.31 / M tokens |

可用环境变量覆盖：

```bash
AGY_PRICE_IN=1.25
AGY_PRICE_OUT=10
AGY_PRICE_CACHE=0.31
```

---

## 技术实现

| 组件 | 说明 |
|---|---|
| `plugin.json` | 插件清单 |
| `sidecars/context-panel/sidecar.json` | sidecar 定义 |
| `sidecars/context-panel/main.mjs` | CDP 客户端，把面板注入 Antigravity 页面 |
| `sidecars/context-panel/panel.js` | 前端 UI（总览浮层 + 侧边卡片） |
| `sidecars/context-panel/i18n.js` | 独立的 i18n DOM 后处理层 |
| `scripts/stats.mjs` | 统计计算引擎 |
| `skills/agy-stats/SKILL.md` | 技能文档 |
| `assets/logo.jpg` | 插件 logo（1:1） |

### 注入方式

sidecar 通过 CDP 连接 Antigravity：

1. 读 `%APPDATA%\Antigravity\DevToolsActivePort` 拿调试端口
2. WebSocket 连 `/json/version` 拿 `webSocketDebuggerUrl`
3. `Target.attachToTarget` + `Runtime.evaluate` 注入 `panel.js`
4. 每 5 秒推送一次最新统计数据

页面加载后：

- 在侧边栏插入「上下文总览」菜单项
- 在右侧面板注入当前会话卡片（默认折叠）

### 为什么不用官方 Sidecar WebUI

`sidecar.json` 支持 `has_web_ui` + `ui_config`，官方会创建 iframe 挂载：

```html
<div data-testid="sidecar-iframe-slot"
     data-sidecar-id="agy-context/context-panel"
     data-visible="false">
```

但入口 UI 被 feature flag 挡住：

```js
pluginSidebarSection: {
  feature: false,
  applyAll: [{ runtimeGating: { customFlag: "enable-plugin-sidebar-section" } }]
}
```

该 flag 由 Google 的 Mendel 实验系统服务端下发，本地无法开启。所以采用 CDP 注入方案。

---

## 兼容性

| 项 | 版本 |
|---|---|
| Antigravity | 2.32.1（实测） |
| Node.js | 22+（需要 `node:sqlite`） |
| 平台 | Windows（其他平台未测试） |

---

## 已知限制

- **模型名称**在部分会话中为空（transcript 未记录），此时从 `gen_metadata` 读取
- **上下文分项**是估算值，只有总量精确
- **无真实压缩事件**：Antigravity 不记录上下文压缩，只能用 `truncated_fields` 近似
- **子 Agent 标题**多为「(未命名)」，因为 Antigravity 没有给它们命名
- **行数变化**（`+16/-3`）无法计算，只能给出字符量

---

## 致谢与声明

总览仪表盘（Context Overview）的界面设计与布局借鉴参考了 [dsh-context](https://github.com/deepseek-ai/dsh-context)，特此鸣谢其提供的设计灵感与思路。

---

## License

MIT
