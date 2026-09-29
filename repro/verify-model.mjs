import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, 'apps/api/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const key = process.env.LLM_API_KEY?.trim();
const model = process.env.LLM_MODEL?.trim() || 'ZHIPU/GLM-5.3-Flash';
const base = (process.env.LLM_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/u, '');
const url = new URL(base);
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('云模型地址必须是无内嵌凭据的 HTTPS 地址。');
const result = { checked_at: new Date().toISOString(), requested_model: model, api_format: 'chat_completions', status: 'not_configured' };
if (!key) {
  const output = JSON.stringify({ ...result, next_action: '在 apps/api/.env.local 设置已开通该模型服务的百炼 API Key 后重试。' }, null, 2);
  if (process.argv.includes('--save')) writeFileSync(resolve(root, 'model-check.json'), output + '\n');
  console.log(output);
  process.exitCode = 2;
} else {
  const started = performance.now();
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '请只输出 JSON 对象 {"sum":4,"topic":"计算机课程复现检查"}，不加代码块。' }], reasoning_effort: 'low', max_tokens: 1024, stream: false }),
      signal: AbortSignal.timeout(60000),
    });
    result.http_status = response.status;
    if (!response.ok) {
      result.status = 'failed'; result.reason = 'provider_http_error';
    } else {
      const payload = await response.json();
      result.returned_model = payload.model ?? null;
      const content = payload.choices?.[0]?.message?.content;
      const parsed = typeof content === 'string' ? JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/gu, '').trim()) : null;
      result.output_check = parsed?.sum === 4;
      result.model_check = payload.model === model;
      result.usage = payload.usage ?? null;
      result.status = result.output_check && result.model_check ? 'passed' : 'failed';
    }
  } catch (error) {
    result.status = 'failed'; result.reason = error?.name || 'unknown_error';
  }
  result.elapsed_ms = Math.round(performance.now() - started);
  const output = JSON.stringify(result, null, 2);
  if (process.argv.includes('--save')) writeFileSync(resolve(root, 'model-check.json'), output + '\n');
  console.log(output);
  if (result.status !== 'passed') process.exitCode = 1;
}
