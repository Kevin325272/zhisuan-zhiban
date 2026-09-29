import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [databasePort, apiPort, webPort] = process.argv.slice(2).map(Number);
const validPort = (port) => Number.isInteger(port) && port >= 1024 && port <= 65535;
if (![databasePort, apiPort, webPort].every(validPort)) throw new Error('端口必须是 1024 到 65535 之间的整数。');
if (new Set([databasePort, apiPort, webPort]).size !== 3) throw new Error('数据库、API、网页端口不能重复。');

const sharedPath = resolve(root, '.env.reproduction');
const apiPath = resolve(root, 'apps/api/.env.local');
const read = (path) => readFileSync(path, 'utf8');
const setValue = (text, key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}=.*$`, 'm');
  if (!pattern.test(text)) throw new Error(`配置文件缺少 ${key}：${pathForError(key)}`);
  return text.replace(pattern, line);
};
const pathForError = (key) => key === 'DATABASE_URL' || key === 'PORT' ? apiPath : sharedPath;

let shared = read(sharedPath);
let api = read(apiPath);
const databaseUrlText = api.match(/^DATABASE_URL=(.*)$/m)?.[1];
if (!databaseUrlText) throw new Error(`配置文件缺少 DATABASE_URL：${apiPath}`);
let databaseUrl;
try { databaseUrl = new URL(databaseUrlText); } catch { throw new Error('DATABASE_URL 不是有效的 PostgreSQL 地址。'); }
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname)) {
  throw new Error('DATABASE_URL 不是本机 PostgreSQL 地址，无法安全切换端口。');
}
if (!decodeURIComponent(databaseUrl.pathname).replace(/^\//, '').startsWith('xuetu_repro')) {
  throw new Error('DATABASE_URL 指向的数据库不是独立的 xuetu_repro 数据库。');
}
databaseUrl.port = String(databasePort);
shared = setValue(shared, 'XUETU_REPRO_DB_PORT', databasePort);
shared = setValue(shared, 'XUETU_REPRO_API_PORT', apiPort);
shared = setValue(shared, 'XUETU_REPRO_WEB_PORT', webPort);
api = setValue(api, 'PORT', apiPort);
api = setValue(api, 'DATABASE_URL', databaseUrl.toString());
writeFileSync(sharedPath, shared, 'utf8');
writeFileSync(apiPath, api, 'utf8');
console.log(JSON.stringify({ updated: true, database: databasePort, api: apiPort, web: webPort }));
