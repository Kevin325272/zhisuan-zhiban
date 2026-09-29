import { z } from "zod";

import type { EvaluatorConfig } from "../../config/evaluator.js";
import { CodeEvaluatorError } from "./code-evaluator.js";

const languageSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const submissionTokenSchema = z.object({
  token: z.string().min(1),
});

const submissionResultSchema = z.object({
  token: z.string().optional(),
  status: z.object({
    id: z.number().int().nonnegative(),
    description: z.string().min(1),
  }),
  stdout: z.string().nullable().default(null),
  stderr: z.string().nullable().default(null),
  compile_output: z.string().nullable().default(null),
  message: z.string().nullable().default(null),
  time: z.union([z.string(), z.number()]).nullable().default(null),
  memory: z.number().nonnegative().nullable().default(null),
});

export type Judge0Language = z.infer<typeof languageSchema>;
export type Judge0SubmissionResult = z.infer<typeof submissionResultSchema>;

export interface Judge0ExecutionRequest {
  sourceCode: string;
  languageId: number;
  compilerOptions?: string;
}

interface Judge0ClientDependencies {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class Judge0Client {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly config: EvaluatorConfig,
    dependencies: Judge0ClientDependencies = {},
  ) {
    if (!config.baseUrl) {
      throw new CodeEvaluatorError(
        "隔离评测服务地址未配置。",
        "EVALUATOR_NOT_CONFIGURED",
        503,
        false,
        "configuration",
      );
    }
    this.baseUrl = config.baseUrl;
    this.fetchFn = dependencies.fetch ?? fetch;
    this.sleep = dependencies.sleep ?? defaultSleep;
  }

  async listLanguages(): Promise<Judge0Language[]> {
    const payload = await this.requestJson<unknown>("/languages", { method: "GET" });
    const parsed = z.array(languageSchema).safeParse(payload);
    if (!parsed.success) throw this.invalidResponse("语言目录格式无法识别。");
    return parsed.data;
  }

  async execute(request: Judge0ExecutionRequest): Promise<Judge0SubmissionResult> {
    const created = await this.requestJson<unknown>(
      "/submissions?base64_encoded=false&wait=false",
      {
        method: "POST",
        body: JSON.stringify({
          source_code: request.sourceCode,
          language_id: request.languageId,
          stdin: "",
          cpu_time_limit: this.config.cpuTimeLimitSeconds,
          wall_time_limit: this.config.wallTimeLimitSeconds,
          memory_limit: this.config.memoryLimitKb,
          max_processes_and_or_threads: this.config.maxProcesses,
          max_file_size: this.config.maxFileSizeKb,
          enable_network: false,
          compiler_options: request.compilerOptions,
        }),
      },
    );
    const tokenResult = submissionTokenSchema.safeParse(created);
    if (!tokenResult.success) throw this.invalidResponse("评测服务未返回任务标识。");

    for (let attempt = 0; attempt < this.config.maxPollAttempts; attempt += 1) {
      const payload = await this.requestJson<unknown>(
        `/submissions/${encodeURIComponent(tokenResult.data.token)}?base64_encoded=false&fields=stdout,stderr,compile_output,message,status,time,memory`,
        { method: "GET" },
      );
      const parsed = submissionResultSchema.safeParse(payload);
      if (!parsed.success) throw this.invalidResponse("评测结果格式无法识别。");
      if (parsed.data.status.id > 2) return parsed.data;
      if (attempt < this.config.maxPollAttempts - 1) {
        await this.sleep(this.config.pollIntervalMs);
      }
    }

    throw new CodeEvaluatorError(
      "隔离评测服务处理超时，请稍后重试。",
      "EVALUATOR_POLL_TIMEOUT",
      503,
      true,
      "infrastructure",
    );
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(this.config.authToken
            ? { [this.config.authHeader]: this.config.authToken }
            : {}),
        },
      });
      if (!response.ok) {
        throw new CodeEvaluatorError(
          "隔离评测服务暂时不可用。",
          "EVALUATOR_UPSTREAM_ERROR",
          503,
          response.status === 429 || response.status >= 500,
          "infrastructure",
          { upstream_status: response.status },
        );
      }
      try {
        return (await response.json()) as T;
      } catch {
        throw this.invalidResponse("评测服务返回了非 JSON 数据。");
      }
    } catch (caught) {
      if (caught instanceof CodeEvaluatorError) throw caught;
      throw new CodeEvaluatorError(
        "无法连接隔离评测服务，请稍后重试。",
        "EVALUATOR_NETWORK_ERROR",
        503,
        true,
        "infrastructure",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private invalidResponse(detail: string) {
    return new CodeEvaluatorError(
      `隔离评测服务响应异常：${detail}`,
      "EVALUATOR_INVALID_RESPONSE",
      502,
      true,
      "infrastructure",
    );
  }
}
