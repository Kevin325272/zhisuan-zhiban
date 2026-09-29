# 高校自命题试卷本地数据

本目录保存“高校自命题试卷库”第一版的数据清单。原始 ZIP 位于
`raw/自命题试卷.zip`，由 `.gitignore` 排除，不进入源码版本控制。

## 已核验范围

- 67 份 PDF，14 所高校，2017—2026 年，共 353 页。
- 32 份带文本层，35 份为扫描件。
- ZIP 内 `来源与下载记录.json` 保存官方文件 URL、落地页、页数、字节数和单文件 SHA256。
- 当前没有可靠答案或解析。

## 使用边界

- `license_status=unverified`
- `usage_scope=local_demo_only`
- `training_allowed=false`

公开可下载不等于获得模型训练、公开再分发或产品化授权。第一版只将其作为本地
整卷检索与阅读材料，不导入单题答案库、不自动评分、不宣称 AI 已理解或训练这些
试卷。

## 运行方式

```powershell
pnpm --filter @xuetu/api exam-papers:validate
pnpm --filter @xuetu/api db:seed:exam-papers
```

运行时数据库只保存可搜索元数据与来源审计；PDF 仍从本地 ZIP 按需读取。
