# 智算智伴源码与复现入口

这是“智算智伴”程序源代码和本地演示数据库。源码包含学生端、教师端、管理端、智能答疑、智能出题、知识图谱/学习路径、具身研学和可拖动 AI 学伴等功能。演示数据库快照位于 `.runtime/repro-demo.sql`。

重要：当前便携 PostgreSQL 在**含中文字符的目录**下无法初始化。请将压缩包解压至从盘符到项目目录都为英文字母、数字的路径，例如 `D:\zhisuan-demo`。不要解压到 `D:\比赛项目\源码`，也不要在压缩包预览窗口直接运行。首次安装依赖需要访问 npm 网络。

## 最简单的启动方式（Windows）

1. 安装 Node.js 24.x（建议 24.19 或更高版本）。安装程序自带 Corepack，不需要单独安装 pnpm。
2. 将压缩包完整解压到纯英文路径（例如 `D:\zhisuan-demo`），双击根目录的 `start.cmd`（或 `队友启动.cmd`）。
3. 脚本会自动安装依赖、初始化本地 PostgreSQL、导入演示数据库并打开浏览器。
4. 访问 `http://127.0.0.1:57105/login`。演示账号密码会自动写入 `.repro-accounts.json`。
5. 结束演示时双击 `stop.cmd`。

如果双击没有反应，请在本目录打开 PowerShell，执行 `powershell -ExecutionPolicy Bypass -File .\\run-demo.ps1`，窗口中的错误信息可以直接定位缺少的环境。

## 手动启动

使用 Node.js 24.16.0 或更高的 24.x 版本、pnpm 11.5.2 和 PostgreSQL 17。以下命令均在本目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm repro:configure
node repro/postgres.mjs start
pnpm db:setup
pnpm db:seed:auth
pnpm db:check
pnpm repro:api
```

保持 API 终端运行，另开一个本目录终端：

```powershell
node repro/prepare-demo.mjs --local-demo
pnpm repro:web
```

Windows 原生 PostgreSQL 路径默认 `C:\Program Files\PostgreSQL\17\bin`。其他路径可设置 `POSTGRES_BIN`。没有原生 PostgreSQL 时可用 `compose.reproduction.yml`；不要同时启动两种数据库。Docker 命令见完整指南。

浏览器入口：`http://127.0.0.1:57105/login`。本地随机生成的账号密码仅写入 `.repro-accounts.json`，不要上传；学生、教师和管理员用户名分别为 `user_student_001`、`user_teacher_001`、`user_admin_001`。新学生首次进入学习设置，完成目标、自评和起步筛查后进入学习面板。

`prepare-demo.mjs` 只为独立本机数据库中的 8 道自编筛查题和 8 道自编练习题执行有审计说明的演示审核。正式教学应由教师重新审核，不得把此步骤当作真实教师签审。也可不用该脚本，改由管理员在正常管理流程逐题审核。

## 云模型配置

编辑 `apps/api/.env.local` 中的 `LLM_API_KEY`，保留以下非敏感配置，保存后重启 API：

```dotenv
AI_WORKFLOW_PROVIDER=openai_compatible
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=ZHIPU/GLM-5.3-Flash
LLM_API_FORMAT=chat_completions
LLM_REASONING_EFFORT=low
LLM_MAX_OUTPUT_TOKENS=4096
LLM_TIMEOUT_MS=60000
```

```powershell
pnpm repro:model --save
```

未配置 Key 时，核验脚本以状态 `not_configured`、退出码 2 结束，不会生成伪造的模型结果。详细标识与当前验证边界见 `../模型接入/模型接入与标识说明.md`。

## 结构与测试

| 目录 | 内容 |
| --- | --- |
| `apps/web` | React/Vite 学生端、教师端、管理员页面 |
| `apps/api` | Fastify API、权限与会话、数据库服务、模型适配器 |
| `packages/contracts` | Zod 数据契约与共享类型 |
| `data` | 可复现导入的数据、原图归档、来源清单及验证工具 |
| `repro` | 独立配置、数据库管理、Web 启动、演示审核、模型核验 |
| `deploy` | 部署脚本、反向代理配置及生产环境示例 |
| `e2e` | 原有 Playwright 测试；包含模拟服务场景，不能代替云模型实测 |

```powershell
pnpm typecheck
pnpm build
pnpm test
```

测试终端不要额外注入运行实例的 `XUETU_LISTEN_HOST` 等环境变量；API 和数据库命令会自行读取 `.env.local`。默认编程执行器为 `mock`，只用于演示流程；真实代码运行需单独接入 Judge0。

停止 API 和 Web 后执行 `node repro/postgres.mjs stop`。源码包不包含 `node_modules`、`apps/api/.env.local`、已生成配置、数据库目录、云服务 Key、线上账户密码或学生私有上传文件；`start.cmd` 会在首次启动时自动安装依赖并生成本机配置。请不要把 `.env.reproduction`、`.repro-accounts.json` 或 `.runtime/repro-postgres` 上传到公共仓库。课程页原图与原始教材归档未随分享包分发，课程原页查看/原始图示功能可能不可用；源码运行和演示课程/题库数据不依赖原图。

## 常见问题

- **提示“不是内部或外部命令”**：请从压缩包中完整解压后双击根目录的 `start.cmd`，不要直接在压缩包预览窗口运行；新版入口只调用英文文件名 `run-demo.ps1`，可避免中文路径编码问题。
- **具身研学或智能出题为空白**：确认 `.runtime/repro-demo.sql` 存在，并使用根目录的 `start.cmd` 启动。该快照包含演示课程、题库、学习画像和研学数据。
- **端口被占用**：确认 `55435`（数据库）、`53105`（API）、`57105`（网页）没有被其他程序占用。仅关闭自己先前打开的演示窗口后重试。
- **提示 `apps/api/.env.local 已存在`**：旧压缩包误包含本机配置，不能继续使用旧包。新版不会包含 `.env.local`；请解压到全新目录，不要覆盖旧目录。
- **提示 `initdb` 或 UTF-8 路径错误**：完整路径中含中文字符，请改为纯英文路径，例如 `D:\zhisuan-demo`。
