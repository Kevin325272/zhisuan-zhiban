import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['.env.reproduction', 'apps/api/.env.local', '.repro-accounts.json'];
for (const file of targets) {
  if (existsSync(resolve(root, file))) throw new Error(`${file} 已存在。为避免覆盖已有配置，本脚本已停止。`);
}
const databasePort = Number(process.env.REPRO_DATABASE_PORT || 55435);
if (!Number.isInteger(databasePort) || databasePort < 1024 || databasePort > 65535) {
  throw new Error('REPRO_DATABASE_PORT 必须是 1024 到 65535 之间的端口。');
}
const ports = { database: databasePort, api: 53105, web: 57105 };
const generated = () => `Repro_${randomBytes(18).toString('hex')}!`;
const databasePassword = randomBytes(24).toString('hex');
const adminPassword = generated();
const demoPassword = generated();
const databaseUrl = process.env.REPRO_DATABASE_URL || `postgresql://xuetu_repro:${databasePassword}@127.0.0.1:${ports.database}/xuetu_repro`;
const url = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('复现配置只接受本机 PostgreSQL 地址。远程部署请单独配置。');
}
if (!decodeURIComponent(url.pathname).replace(/^\//, '').startsWith('xuetu_repro')) {
  throw new Error('复现数据库名称必须以 xuetu_repro 开头，避免连接业务数据库。');
}
const shared = {
  XUETU_REPRO_DB_NAME: decodeURIComponent(url.pathname.slice(1)),
  XUETU_REPRO_DB_USER: decodeURIComponent(url.username),
  XUETU_REPRO_DB_PASSWORD: decodeURIComponent(url.password),
  XUETU_REPRO_DB_PORT: url.port || String(ports.database),
  XUETU_REPRO_API_PORT: ports.api,
  XUETU_REPRO_WEB_PORT: ports.web,
};
const api = {
  NODE_ENV: 'development', PORT: ports.api,
  DATABASE_URL: databaseUrl, DATABASE_SSL: 'disable', DATABASE_POOL_MAX: 10,
  XUETU_AUTH_MODE: 'session', XUETU_AUTH_COOKIE_SECURE: 'false', XUETU_TRUST_PROXY: 'false',
  XUETU_LISTEN_HOST: '127.0.0.1', XUETU_ENABLE_DEV_IDENTITY_HEADER: 'false',
  XUETU_INITIAL_ADMIN_PASSWORD: adminPassword, XUETU_LEGACY_STUDENT_PASSWORD: demoPassword,
  XUETU_STUDENT_REGISTRATION_MODE: 'self_service',
  XUETU_DEMO_COURSE_IDS: 'course_408_ds,course_408_co,course_408_os,course_408_cn',
  XUETU_ALLOW_LOCAL_DEMO_PAST_EXAMS: 'true', XUETU_ALLOW_MOCK_SCENARIOS: 'false',
  XUETU_ENABLE_LEGACY_AGENT_ROUTES: 'false', XUETU_ENABLE_LEGACY_DEMO_ROUTES: 'false',
  STUDENT_CARE_ENABLED: 'true', EXTERNAL_QUESTION_STORAGE_DIR: '.runtime/external-questions',
  AI_WORKFLOW_PROVIDER: 'openai_compatible',
  LLM_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  LLM_API_KEY: '', LLM_MODEL: 'ZHIPU/GLM-5.3-Flash', LLM_API_FORMAT: 'chat_completions',
  LLM_REASONING_EFFORT: 'low', LLM_MAX_OUTPUT_TOKENS: 4096, LLM_TIMEOUT_MS: 60000,
  EVALUATOR_MODE: 'mock', EVALUATOR_ALLOW_MOCK_FALLBACK: 'false',
};
const serialize = (values) => Object.entries(values).map(([key, value]) => {
  if (/[\r\n]/u.test(String(value))) throw new Error(`Invalid newline in ${key}`);
  return `${key}=${value}`;
}).join('\n') + '\n';
mkdirSync(resolve(root, 'apps/api'), { recursive: true });
writeFileSync(resolve(root, '.env.reproduction'), serialize(shared), { flag: 'wx', mode: 0o600 });
writeFileSync(resolve(root, 'apps/api/.env.local'), serialize(api), { flag: 'wx', mode: 0o600 });
writeFileSync(resolve(root, '.repro-accounts.json'), JSON.stringify({
  purpose: '仅用于本机独立复现实例，禁止提交此文件或用于线上服务',
  admin: { username: 'user_admin_001', password: adminPassword },
  student: { username: 'user_student_001', password: demoPassword },
  teacher: { username: 'user_teacher_001', password: demoPassword },
}, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ configured: true, ports, cloud_model: api.LLM_MODEL, cloud_key: 'not_configured', accounts_file: '.repro-accounts.json' }));
