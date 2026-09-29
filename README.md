# 智算智伴：压缩包优先演示、源码保底复现

提交材料采用“两条路线”。首选使用上一版评审演示压缩包，它包含便携 PostgreSQL、演示数据库快照和分步启动脚本，适合现场直接演示；如果压缩包因电脑环境、权限或端口问题无法运行，再使用本 GitHub 仓库的源码手动配置。两条路线互为备份，**不要把两套目录、数据库或配置文件混在一起**。

本仓库交付的是智算智伴源代码，包含 React 学生端、教师端、管理端、Fastify API，以及课程学习、知识图谱、诊断练习、智能答疑、智能出题和 AI 学伴等功能的实现。实际可见内容取决于导入的数据和配置的 AI 服务。

**重要边界：** Git 仓库没有包含 `.runtime/` 演示数据库快照，也没有提交 `data/**/raw/`、`data/**/processed/` 中的完整课程语料与题库。仅克隆源码可以启动基础平台，但**不能还原压缩包中的完整课程、知识图谱、真题、具身研学或已有学习记录**。这些内容不能靠 `pnpm db:setup` 凭空生成；缺少原始数据时请使用“源码保底复现”步骤，不要执行 `pnpm db:setup`。云端智能能力还需要评审自行配置有效的服务密钥。

## 路线 A：上一版压缩包优先演示

压缩包不放在 GitHub 源码仓库中，请在提交材料中单独附上上一版评审演示包。文件名以你最终上传的文件为准，下面以 `智算智伴-评审演示包-v1.0.8.zip` 为例。该包已经包含便携 PostgreSQL 和演示数据库快照，评审电脑不需要另外安装 PostgreSQL。

### A1. 解压位置

1. 将压缩包完整下载到本地，不要在浏览器或压缩包预览窗口内直接运行。
2. 解压到纯英文、数字路径，例如 `D:\zhisuan-demo`。不要放在桌面、微信临时目录或包含中文字符的路径下。
3. 如果电脑上曾经解压过旧版本，请使用新的目录，例如 `D:\zhisuan-demo-v1`，不要覆盖旧目录，也不要把旧目录里的 `.runtime`、`.env.local` 或 `node_modules` 复制过来。

### A2. 按顺序启动

在解压后的压缩包根目录，严格按顺序双击下面的脚本；每一步窗口显示完成后再进行下一步：

1. `01-检查环境.cmd`：检查 Windows、Node.js、pnpm 和便携 PostgreSQL。
2. `02-安装依赖.cmd`：首次运行需要联网，等待依赖安装完成。
3. `03-生成本机配置.cmd`：生成本机端口、数据库连接和随机演示账号。
4. `04-启动数据库.cmd`：启动该压缩包自己的便携 PostgreSQL，不会连接其他小组的数据库。
5. `05-导入演示数据.cmd`：导入压缩包内的演示数据库快照。
6. `06-初始化演示账号.cmd`：初始化学生、教师和管理员账号。
7. `07-启动API.cmd`：保持窗口打开，不要关闭。
8. `08-启动网页.cmd`：按窗口显示的地址打开浏览器，通常是 `http://127.0.0.1:57305/login`。

账号密码写入压缩包根目录的 `.repro-accounts.json`，不要把该文件上传到 GitHub 或写进提交说明。演示结束时先关闭 API 和网页窗口，再双击 `停止本演示.cmd`。该脚本只停止本压缩包使用的端口和数据库，不会停止电脑上的其他项目。

### A3. 压缩包失败时的判断

- `01-检查环境.cmd` 报 Node.js、pnpm 或路径错误：安装 Node.js 24.14.0 或更高的 24.x，重新打开 PowerShell，并把压缩包移到纯英文路径。
- 双击窗口一闪而过：在压缩包根目录打开 PowerShell，执行 `powershell -ExecutionPolicy Bypass -File .\run-demo.ps1`，保留窗口中的错误信息。
- `initdb`、UTF-8 或权限错误：不要修补旧目录，改用新的纯英文目录重新完整解压。
- 端口被占用或数据库连接失败：先关闭本压缩包之前留下的 API/数据库窗口；不要删除或替换其他项目的数据库。仍失败时直接切换到路线 B。
- 具身研学、智能出题或知识图谱为空：确认已经完成第 05 步“导入演示数据”，且使用的是同一个压缩包目录。仍为空时不要从别的项目复制数据库，切换到路线 B 并按源码数据边界排查。

压缩包路线失败后，建议保留失败窗口中的最后 20 行报错，并在**另一个全新目录**使用路线 B；不要在压缩包目录里执行源码配置命令。

## 路线 B：GitHub 源码保底复现

### B1. 环境准备

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

### B2. 生成本机配置

在新克隆的仓库根目录执行：

```powershell
pnpm repro:configure
```

它会生成 `.env.reproduction`、`apps/api/.env.local`、`.repro-accounts.json`，分别保存本机端口/数据库参数、API 配置和随机生成的演示账号密码。这些文件被 Git 忽略，不在仓库中。脚本发现文件已存在时会**拒绝覆盖**；重复运行前先检查自己的旧配置，不要覆盖已有数据或把密码提交到 GitHub。

默认端口为数据库 `55435`、API `53105`、网页 `57305`，均应只用于本机。若这些端口已被其他程序占用，先确认占用者并换到空闲端口；不要连接其他项目的数据库。数据库端口可在首次配置前通过 `REPRO_DATABASE_PORT` 指定；API/Web 端口变更还需同步修改生成的两个配置文件。

### B3. 启动独立 PostgreSQL

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

### B4. 初始化源码基础数据

**新克隆、未提供原始数据时，请逐行执行以下命令，不要运行 `pnpm db:setup`：**

```powershell
pnpm db:migrate
pnpm --filter @xuetu/api db:seed:platform
pnpm db:seed:auth
pnpm db:check
```

这会建立表结构、三个演示身份、四门 408 课程的目录与权限，并为三个账号设置本机随机密码；不会自动产生完整题库或课程知识图谱。`pnpm db:check` 应输出当前数据库名称和各类数据数量。在此基础上，也可执行 `pnpm --filter @xuetu/api db:seed:demo-roster` 和 `pnpm --filter @xuetu/api db:seed:community`，加入源码中合成的班级与社区演示记录；它们不代表真实学生数据。

评审如果**另行持有且有权使用**与 `data/` 下各 `manifest.json` 校验值匹配的完整原始资料，可按各数据目录 README 恢复相应的 `raw/`、`processed/` 文件，再在这个**独立本机数据库**上执行 `pnpm db:setup`、`pnpm db:seed:auth`、`pnpm db:check`。`db:setup` 会依次导入真题、课程、试卷和课程图谱等内容；缺少任意必需数据会报错，不是程序已经自动下载了资料。原演示数据库中的历史学习记录仍不会由这些导入命令生成。

### B5. 分别启动 API 和网页

在仓库根目录打开第一个 PowerShell 窗口，执行并保持运行：

```powershell
pnpm repro:api
```

打开第二个 PowerShell 窗口，仍在仓库根目录，执行并保持运行：

```powershell
pnpm repro:web
```

浏览器访问 [http://127.0.0.1:57305/login](http://127.0.0.1:57305/login)。可在本机运行 `Get-Content .repro-accounts.json` 查看账号和随机密码。用户名分别是 `user_student_001`、`user_teacher_001`、`user_admin_001`；三者的密码以**本机生成文件**为准，不在 README 中提供固定密码。API 健康检查地址是 [http://127.0.0.1:53105/api/v1/system-status](http://127.0.0.1:53105/api/v1/system-status)，正常时 `data.status` 为 `ready`。

### B6. 可选：接入智能服务

不填密钥也能启动平台，但真实的 AI 答疑、出题、诊断或学伴调用不能因此视为已接通。评审如果有兼容 Chat Completions 的服务，可在**仅保存在本机**的 `apps/api/.env.local` 中填写 `LLM_API_KEY`，并核对 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_FORMAT` 及 `AI_WORKFLOW_PROVIDER=openai_compatible`，保存后重启 API。提供方必须与所填模型名称匹配；默认示例配置不保证评审拥有对应账号或额度。

浮窗学伴的独立工作流接入还需同时设置 `XUETU_AGENT_CHAT_BASE_URL` 和 `XUETU_AGENT_CHAT_SECRET`。如果使用 Dify 工作流，须使用与该智能体实际应用类型和接口契约匹配的配置；不能把任意 Dify App Key 直接当成通用大模型 Key。没有密钥时可能只看到本地演示回复、不可用提示或空结果，不应当作真实云端调用成功。**不要把任何 API Key 写入 README、提交到仓库或发送给评审。**

### B7. 结束与排查

- 结束时在 API 和网页窗口各按 `Ctrl+C`。Docker 方式再执行 `docker compose --env-file .env.reproduction -f compose.reproduction.yml down`；本机 PostgreSQL 方式执行 `node repro/postgres.mjs stop`。两者都保留已有数据库数据。
- `pnpm` 找不到：确认 Node.js 和 pnpm 安装成功，关闭并重新打开 PowerShell 后检查版本。
- Docker 连接失败：先启动 Docker Desktop；如果没有 Docker，可改用 PostgreSQL 17 的 B 方案。
- `initdb` 报路径错误：本机 PostgreSQL 方式把整个项目放到纯英文路径，重新在**全新的项目目录**按步骤配置，不要直接覆盖旧数据库目录。
- 数据库连接或端口错误：核对 `.env.reproduction`、`apps/api/.env.local` 指向同一个本机端口，并确认该端口没有被其他项目占用。
- `db:setup` 提示找不到 `raw/` 文件：源码仓库本来不含完整原始资料。无资料时使用第四节的基础数据步骤；缺少资料不能复现原演示的全部内容。
- 课程/知识图谱/智能出题页为空：先看 `pnpm db:check` 的课程、题目和知识点数量。仅有目录而没有原始课程资料、审核后的题目或有效 AI 密钥时，页面内容不等于原演示。

代码结构：`apps/web` 为 React/Vite 前端，`apps/api` 为 Fastify 后端，`packages/contracts` 为共享数据契约，`data` 为数据清单和可公开的小型样例，`repro` 为本机配置/数据库脚本。源码检查可运行 `pnpm typecheck`、`pnpm build`、`pnpm test`；单元测试通过不等于已验证所有外部数据和云服务。
