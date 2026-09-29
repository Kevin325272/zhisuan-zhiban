# 小型测试样本

这里仅放经过人工抽查、保留稳定 ID 和来源字段的小规模样本，用于前后端自动化测试。不要从完整语料中随机抽取后直接提交；样本应覆盖正常检索、无结果、低置信和来源回溯场景。

- `bfs-rag-sample.jsonl`：由 `pnpm data:sample` 生成的 8 条 BFS 联调切块。
- `bfs-sample-labels.json`：每条样本的选择理由和证据角色。
- `bfs-query-cases.json`：5 个正常命中、2 个低置信、1 个无结果用例。

运行 `pnpm data:check` 可校验完整语料、样本引用、查询用例和清单哈希。
