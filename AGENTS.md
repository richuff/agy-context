# AGENTS.md

- 协作纪律：见 [./多会话协作纪律.md](./多会话协作纪律.md)（开工前读、收尾前对照检查清单）
- 数字口径唯一来源：`scripts/stats.mjs`；禁止在别处重算
- 全本地数据，不联网；路径展示前脱敏
- 改动统计逻辑必跑 `node test/test-stats.mjs`
- `_ref/`、`_webui_backup/` 为只读参考副本，不直接改
