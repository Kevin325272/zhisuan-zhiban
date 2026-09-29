import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(resolve(root, '.env.reproduction'));
const require = createRequire(resolve(root, 'apps/web/package.json'));
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', process.env.XUETU_REPRO_WEB_PORT || '57105', '--strictPort'], {
  cwd: resolve(root, 'apps/web'), stdio: 'inherit',
  env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${process.env.XUETU_REPRO_API_PORT || '53105'}` },
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
