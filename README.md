# 智算智伴：源代码与手动复现

本仓库交付的是智算智伴的源代码，不是已部署的网站或含数据库的一键运行包。项目包含 React 学生端、教师端、管理端，Fastify API，以及课程学习、知识图谱、诊断练习、智能答疑、智能出题和 AI 学伴等功能的实现。评审可按下列步骤在自己的电脑上启动程序；实际可见内容取决于导入的数据和配置的 AI 服务。

**重要边界：** Git 仓库没有包含 `.runtime/` 演示数据库快照，也没有提交 `data/**/raw/`、`data/**/processed/` 中的完整课程语料与题库。仅克隆源码可以启动基础平台，但**不能还原原演示中的完整课程、知识图谱、真题、具身研学或已有学习记录**。这些内容不能靠 `pnpm db:setup` 凭空生成；缺少原始数据时请使用下文的“源码基础运行”步骤，不要执行 `pnpm db:setup`。云端智能能力还需要评审自行配置有效的服务密钥。

## 一、环境准备

以下命令以 Windows PowerShell 为例，均在仓库根目录运行。需要：

- Git、Node.js **24.14.0 或更新的 24.x**、pnpm **11.5.2**。
- 二选一：Docker Desktop（含 `docker compose`，须先启动 Docker Desktop），或本机 PostgreSQL **17**。不需要同时启动两个数据库。
- 首次安装 JavaScript 依赖、拉取 Docker 镜像需要联网。网页浏览器建议使用最新版 Chrome 或 Edge。

```powershell
git clone https://github.com/Kevin325272/zhisuan-zhiban.git
Set-Location .\zhisuan-zhiban
node --version
pnpm --version
pnpm install --frozen-lockfile
```

如果 `pnpm` 未安装，可先执行 `npm install --global pnpm@11.5.2`，再检查版本。不要在 ZIP 预览窗口中运行命令。选择一个自己有写入权限的目录；采用下面的**本机 PostgreSQL** 方式时，项目完整路径还应只含英文、数字等 ASCII 字符，例如 `D:\zhisuan-zhiban`，避免 Windows `initdb` 在中文路径下失败。

## 二、生成本机配置

在新克隆的仓库根目录执行：

```powershell
pnpm repro:configure
```

它会生成 `.env.reproduction`、`apps/api/.env.local`、`.repro-accounts.json`，分别保存本机端口/数据库参数、API 配置和随机生成的演示账号密码。这些文件被 Git 忽略，不在仓库中。脚本发现文件已存在时会**拒绝覆盖**；重复运行前先检查自己的旧配置，不要覆盖已有数据或把密码提交到 GitHub。

默认端口为数据库 `55435`、API `53105`、网页 `57305`，均应只用于本机。若这些端口已被其他程序占用，先确认占用者并换到空闲端口；不要连接其他项目的数据库。数据库端口可在首次配置前通过 `REPRO_DATABASE_PORT` 指定；API/Web 端口变更还需同步修改生成的两个配置文件。

## 三、启动独立 PostgreSQL

选择 **A 或 B**，只执行其中一种。

### A. Docker Desktop

确认 Docker Desktop 已启动后，在根目录执行：

```powershell
docker compose --env-file .env.reproduction -f compose.reproduction.yml up -d --wait
```

该 Compose 项目使用独立命名卷，数据库只映射到 `127.0.0.1:55435`（或配置的端口）。不要用其他项目的 PostgreSQL 容器代替它。

### B. 本机 PostgreSQL 17

安装 PostgreSQL 17 后，在根目录执行：

```powershell
node repro/postgres.mjs start
```

脚本默认从 `C:\Program Files\PostgreSQL\17\bin` 查找 `initdb.exe`、`pg_ctl.exe` 和 `psql.exe`。如果安装在其他位置，先在同一个 PowerShell 窗口设置 `$env:POSTGRES_BIN = 'D:\PostgreSQL\17\bin'`。脚本会在本仓库 `.runtime/repro-postgres/` 新建独立数据库集群，不会自动使用电脑上其他小组的数据库。

## 四、初始化源码基础数据

**新克隆、未提供原始数据时，请逐行执行以下命令，不要运行 `pnpm db:setup`：**

```powershell
pnpm db:migrate
pnpm --filter @xuetu/api db:seed:platform
pnpm db:seed:auth
pnpm db:check
```

这会建立表结构、三个演示身份、四门 408 课程的目录与权限，并为三个账号设置本机随机密码；不会自动产生完整题库或课程知识图谱。`pnpm db:check` 应输出当前数据库名称和各类数据数量。在此基础上，也可执行 `pnpm --filter @xuetu/api db:seed:demo-roster` 和 `pnpm --filter @xuetu/api db:seed:community`，加入源码中合成的班级与社区演示记录；它们不代表真实学生数据。

评审如果**另行持有且有权使用**与 `data/` 下各 `manifest.json` 校验值匹配的完整原始资料，可按各数据目录 README 恢复相应的 `raw/`、`processed/` 文件，再在这个**独立本机数据库**上执行 `pnpm db:setup`、`pnpm db:seed:auth`、`pnpm db:check`。`db:setup` 会依次导入真题、课程、试卷和课程图谱等内容；缺少任意必需数据会报错，不是程序已经自动下载了资料。原演示数据库中的历史学习记录仍不会由这些导入命令生成。

## 五、分别启动 API 和网页

在仓库根目录打开第一个 PowerShell 窗口，执行并保持运行：

```powershell
pnpm repro:api
```

打开第二个 PowerShell 窗口，仍在仓库根目录，执行并保持运行：

```powershell
pnpm repro:web
```

浏览器访问 [http://127.0.0.1:57305/login](http://127.0.0.1:57305/login)。可在本机运行 `Get-Content .repro-accounts.json` 查看账号和随机密码。用户名分别是 `user_student_001`、`user_teacher_001`、`user_admin_001`；三者的密码以**本机生成文件**为准，不在 README 中提供固定密码。API 健康检查地址是 [http://127.0.0.1:53105/api/v1/system-status](http://127.0.0.1:53105/api/v1/system-status)，正常时 `data.status` 为 `ready`。

## 六、可选：接入智能服务

不填密钥也能启动平台，但真实的 AI 答疑、出题、诊断或学伴调用不能因此视为已接通。评审如果有兼容 Chat Completions 的服务，可在**仅保存在本机**的 `apps/api/.env.local` 中填写 `LLM_API_KEY`，并核对 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_FORMAT` 及 `AI_WORKFLOW_PROVIDER=openai_compatible`，保存后重启 API。提供方必须与所填模型名称匹配；默认示例配置不保证评审拥有对应账号或额度。

浮窗学伴的独立工作流接入还需同时设置 `XUETU_AGENT_CHAT_BASE_URL` 和 `XUETU_AGENT_CHAT_SECRET`。如果使用 Dify 工作流，须使用与该智能体实际应用类型和接口契约匹配的配置；不能把任意 Dify App Key 直接当成通用大模型 Key。没有密钥时可能只看到本地演示回复、不可用提示或空结果，不应当作真实云端调用成功。**不要把任何 API Key 写入 README、提交到仓库或发送给评审。**

## 七、结束与排查

- 结束时在 API 和网页窗口各按 `Ctrl+C`。Docker 方式再执行 `docker compose --env-file .env.reproduction -f compose.reproduction.yml down`；本机 PostgreSQL 方式执行 `node repro/postgres.mjs stop`。两者都保留已有数据库数据。
- `pnpm` 找不到：确认 Node.js 和 pnpm 安装成功，关闭并重新打开 PowerShell 后检查版本。
- Docker 连接失败：先启动 Docker Desktop；如果没有 Docker，可改用 PostgreSQL 17 的 B 方案。
- `initdb` 报路径错误：本机 PostgreSQL 方式把整个项目放到纯英文路径，重新在**全新的项目目录**按步骤配置，不要直接覆盖旧数据库目录。
- 数据库连接或端口错误：核对 `.env.reproduction`、`apps/api/.env.local` 指向同一个本机端口，并确认该端口没有被其他项目占用。
- `db:setup` 提示找不到 `raw/` 文件：源码仓库本来不含完整原始资料。无资料时使用第四节的基础数据步骤；缺少资料不能复现原演示的全部内容。
- 课程/知识图谱/智能出题页为空：先看 `pnpm db:check` 的课程、题目和知识点数量。仅有目录而没有原始课程资料、审核后的题目或有效 AI 密钥时，页面内容不等于原演示。

代码结构：`apps/web` 为 React/Vite 前端，`apps/api` 为 Fastify 后端，`packages/contracts` 为共享数据契约，`data` 为数据清单和可公开的小型样例，`repro` 为本机配置/数据库脚本。源码检查可运行 `pnpm typecheck`、`pnpm build`、`pnpm test`；单元测试通过不等于已验证所有外部数据和云服务。
