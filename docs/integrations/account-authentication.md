# 第一版本地账户与权限边界

## 运行边界

第一版使用本地 PostgreSQL 和服务端会话，面向挑战杯演示。它不是学校 SSO、短信/邮箱验证、多因素认证或云端生产部署。浏览器只收到 `AuthAccount`（用户名、显示名称、角色、状态和数据边界）；密码哈希、原始密码、会话令牌和会话哈希只保留在服务端。

## 账户与会话

用户名输入接受 4–32 位字母（含大写）、数字、下划线或连字符。服务端会先去除首尾空白并统一转换为小写后保存和匹配，因此用户名不区分大小写，浏览器返回的账户用户名也是规范化后的形式。

- `POST /api/v1/auth/register`：仅创建 `student`，输入 `username/display_name/password/password_confirmation`。
- `POST /api/v1/auth/login`：用户名+密码；未知、停用和密码错误统一返回 `INVALID_CREDENTIALS`。
- `GET /api/v1/auth/session`：读取 `xuetu_session` httpOnly、SameSite=Lax、服务端可撤销且默认 8 小时过期的 cookie。
- `POST /api/v1/auth/logout`：撤销当前服务端会话并清除 cookie。
- `POST /api/v1/auth/password`：当前账户改密；服务端撤销该账户的所有会话。

管理员不能公开注册。已登录管理员使用以下治理端点：

- `GET /api/v1/manage/accounts`
- `POST /api/v1/manage/accounts`（role 只能是 `student` 或 `admin`）
- `PATCH /api/v1/manage/accounts/:userId/status`
- `POST /api/v1/manage/accounts/:userId/reset-password`

这些响应不会包含密码或哈希；服务端保护最后一个启用管理员，也不允许管理员停用自己。

## 本地种子

迁移后在被忽略的 `apps/api/.env.local` 设置 `XUETU_INITIAL_ADMIN_PASSWORD` 与 `XUETU_LEGACY_STUDENT_PASSWORD`，执行：

```text
pnpm db:migrate
pnpm db:seed:auth
```

种子只给既有 `user_admin_001` 和 `user_student_001` 填充缺失哈希，不会重置已有哈希或把停用账户重新启用。历史学生的作答、错题和阅读进度继续归属 `user_student_001`，账户页会标明“历史本地演示数据”。

## 业务接口身份规则

课程阅读、练习评测、错题/学习记录、AI 插槽和整卷资料接口优先读取服务端会话。只有在 `XUETU_AUTH_MODE=local_dev` 且请求明确携带 `X-Dev-User-Id` 时，才保留旧自动化测试兼容路径；它不是浏览器登录方式，也不应被当作生产认证。

旧 BFS 工作台的兼容接口（例如 `/api/v1/tasks/*`、`/api/v1/learning-plan`）现在也先经过会话与角色门禁；它们仍保留原有演示状态模型，不应被误解为已经完成多账户生产级学情隔离。新练习中心、错题/学习记录、课程阅读进度和题库评测则按当前服务端用户写入 PostgreSQL。

本地演示不提供注册限流、邮箱/短信验证、MFA、SSO、审计日志归档或云端部署；这些是后续生产化工作，不在本批能力内。
