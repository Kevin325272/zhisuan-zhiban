# 408 题库本地导入源

本目录只保存可审查的导入工具和清单。原始 ZIP 与解压后的 JSON/图片不进入 Git；运行时 API 只读取 PostgreSQL，不能把 JSON 目录当数据库使用。

## 数据边界

- 来源：`csgraduates.com`，2009—2026 年，共 846 题。
- 当前用途：本地开发和挑战杯演示联调。
- 版权、转载和公开分发授权：尚未核验。
- 导入会保留题目来源 URL、年份、科目、题型、标签、图片引用、授权状态和使用范围。
- `question_html`、`option_html`、`explanation_html`、`solution_html` 不进入数据库。普通文本字段中残留的网页标签也会在导入前转成纯文本。
- 选择题可确定性判分；综合题只生成“待 AI 或教师复核”记录，不能自动声明正确。

## 安全导入

在仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\data\question-bank-408\tools\import-question-bank.ps1 `
  -ArchivePath "C:\Users\Administrator\Desktop\挑战杯\408_json_data(1).zip"
```

脚本会先验证 SHA-256、条目数量、总解压体积、固定根目录、绝对路径、`..` 路径和符号链接，再写入专用 staging 目录；目标已存在时拒绝覆盖。成功后数据位于 `data/question-bank-408/raw/408_json_data/`，原 ZIP 保持不变。

## PostgreSQL 本地路径

环境前置：Docker Desktop（含 Compose）或 PostgreSQL 17+。仓库自带的 Compose 只绑定 `127.0.0.1:55432`，密码仅用于本地开发。

```powershell
Copy-Item .\apps\api\.env.example .\apps\api\.env.local
pnpm db:up
pnpm question-bank:validate
pnpm db:setup
pnpm db:check
```

`question-bank:validate` 在连接数据库前用实际解压数据复核 18 年、846 题、题型数量、答案与选项、纯文本转换和资源引用契约。`db:setup` 依次执行迁移、本地演示用户/RBAC/课程种子，以及 846 题的事务导入。`db:down` 不删除命名卷；仓库没有提供自动删除数据库卷的命令。

### 本机 WSL2 备用实例

当前开发机未安装 Docker，因此实际验收使用独立的 `Xuetu-Postgres` WSL2 发行版与 PostgreSQL 17，仍通过 Windows 本机 `127.0.0.1:55432` 访问。它不修改已有的 `Ubuntu-24.04` 发行版，也不开放局域网端口。Windows 重启后可在仓库外用以下本地命令重新拉起该实例：

```powershell
Start-Process -FilePath wsl.exe -ArgumentList @(
  "-d", "Xuetu-Postgres", "-u", "root", "--", "bash", "-lc",
  "systemctl start postgresql@17-main && exec sleep infinity"
) -WindowStyle Hidden

Test-NetConnection 127.0.0.1 -Port 55432
pnpm db:check
```

该命令只适用于已经完成一次性安装和建库的当前开发机。新机器优先使用仓库的 `compose.postgres.yml`；不要把 WSL 发行版磁盘、数据库口令或 `.env.local` 提交到版本库。

本地演示身份为 `user_student_001`、`user_teacher_001`、`user_admin_001`。它们只配合 `XUETU_AUTH_MODE=local_dev` 和 `X-Dev-User-Id` 使用，不是生产级账号认证。
