import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(resolve(root, '.env.reproduction'));
const action = process.argv[2] || 'start';
if (!['start', 'stop', 'status'].includes(action)) throw new Error('用法：node repro/postgres.mjs start|stop|status');
const bin = process.env.POSTGRES_BIN || (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\17\\bin' : '');
const exe = (name) => bin ? resolve(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const runtime = resolve(root, '.runtime');
const data = resolve(runtime, 'repro-postgres');
for (const path of [runtime, data]) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('复现数据库目录不能是符号链接。');
}
mkdirSync(runtime, { recursive: true });
const fromRoot = relative(realpathSync(root), realpathSync(runtime));
if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('数据库运行目录超出源码目录。');
const port = String(process.env.XUETU_REPRO_DB_PORT || '55435');
const user = process.env.XUETU_REPRO_DB_USER;
const name = process.env.XUETU_REPRO_DB_NAME;
const password = process.env.XUETU_REPRO_DB_PASSWORD;
if (!/^\d{4,5}$/u.test(port) || !/^xuetu_repro[a-z0-9_]*$/u.test(name || '') || !/^xuetu_repro[a-z0-9_]*$/u.test(user || '') || !password) {
  throw new Error('缺少有效的独立复现数据库配置，请先运行 repro/configure.mjs。');
}
const env = { ...process.env, PGPASSWORD: password, PGCLIENTENCODING: 'UTF8' };
const run = (name, args, check = true) => {
  // The Windows PostgreSQL server inherits pipe handles from pg_ctl. Its
  // detached startup must not keep spawnSync waiting for pipe EOF.
  const detachedStart = name === 'pg_ctl' && args.includes('start');
  const result = spawnSync(exe(name), args, { encoding: 'utf8', windowsHide: true, env, ...(detachedStart ? { stdio: 'ignore' } : {}) });
  if (result.error) throw new Error(`${name} 无法执行，请安装 PostgreSQL 17 或设置 POSTGRES_BIN。`);
  if (check && result.status !== 0) throw new Error(`${name} 失败：${(result.stderr || result.stdout || '').replaceAll(password, '[REDACTED]')}`);
  return result;
};
const initialized = existsSync(resolve(data, 'PG_VERSION'));
const running = initialized && run('pg_ctl', ['-D', data, 'status'], false).status === 0;
if (action === 'status') {
  console.log(JSON.stringify({ initialized, running, host: '127.0.0.1', port: Number(port) }));
} else if (action === 'stop') {
  if (running) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  console.log(JSON.stringify({ stopped: true, data_preserved: true }));
} else {
  if (!initialized) {
    const pwfile = resolve(runtime, '.postgres-password');
    writeFileSync(pwfile, password + '\n', { flag: 'wx', mode: 0o600 });
    try {
      run('initdb', ['-D', data, '-U', user, '--encoding=UTF8', '--locale=C', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', `--pwfile=${pwfile}`]);
    } finally { unlinkSync(pwfile); }
  }
  if (!running) run('pg_ctl', ['-D', data, '-l', resolve(runtime, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  const args = ['-h', '127.0.0.1', '-p', port, '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const found = run('psql', [...args, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${name}'`]).stdout.trim();
  if (found !== '1') run('psql', [...args, '-c', `CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`]);
  console.log(JSON.stringify({ ready: true, database: name, host: '127.0.0.1', port: Number(port), version: run('postgres', ['--version']).stdout.trim() }));
}
