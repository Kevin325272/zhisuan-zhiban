import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import {
  AI_WORKFLOW_SLOT_BY_CAPABILITY,
  aiWorkflowCapabilitySchema,
  aiWorkflowRequestSchema,
  aiWorkflowResponseSchema,
  type AiWorkflowResponse,
} from "@xuetu/contracts";

/**
 * Contract-only fixture server. It verifies transport and schemas but does not
 * emulate model quality, RAG retrieval, diagnosis or tutoring behavior.
 */
export function buildAiWorkflowContractMock(secret: string) {
  if (!secret.trim()) throw new Error("Mock secret must not be empty.");
  const app = Fastify({ logger: false });

  app.post<{ Params: { capability: string }; Body: unknown }>(
    "/v1/ai-workflows/:capability",
    async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${secret}`) {
        return reply.code(401).send({
          code: "UNAUTHORIZED",
          message: "Contract mock authentication failed.",
        });
      }
      if (request.headers["x-xuetu-contract-version"] !== "0.2") {
        return reply.code(400).send({
          code: "CONTRACT_VERSION_INVALID",
          message: "X-Xuetu-Contract-Version must be 0.2.",
        });
      }
      const capability = aiWorkflowCapabilitySchema.safeParse(
        request.params.capability,
      );
      const body = aiWorkflowRequestSchema.safeParse(request.body);
      if (
        !capability.success
        || !body.success
        || capability.data !== body.data.capability
        || request.headers["idempotency-key"] !== body.data.request_id
      ) {
        return reply.code(400).send({
          code: "CONTRACT_REQUEST_INVALID",
          message: "Path, headers or request body do not match contract 0.2.",
        });
      }

      const diagnosisBlocks = body.data.capability === "diagnose"
        ? [
            {
              block_id: `mock_feedback_${body.data.capability}`,
              kind: "feedback" as const,
              title: "契约联调中的错因占位",
              content: "此固定响应只验证诊断结果的结构，不代表真实模型已经给出错因。",
            },
            {
              block_id: `mock_hint_${body.data.capability}`,
              kind: "hint" as const,
              title: "下一步提示",
              content: "回到本题确定性解析，先复核题干中的关键条件。",
            },
          ]
        : [{
            block_id: `mock_block_${body.data.capability}`,
            kind: "notice" as const,
            title: "契约联调固定响应",
            content: "此内容只证明HTTP与DTO兼容，不是AI讲解、诊断或推荐。",
          }];

      const response: AiWorkflowResponse = {
        contract_version: "0.2",
        request_id: body.data.request_id,
        capability: body.data.capability,
        slot: AI_WORKFLOW_SLOT_BY_CAPABILITY[body.data.capability],
        status: "ready",
        display_blocks: diagnosisBlocks,
        citations: body.data.context.source_chunks.slice(0, 1).map((chunk) => ({
          citation_id: `mock_citation_${body.data.capability}`,
          source_chunk_id: chunk.source_chunk_id,
          label: chunk.chapter,
          locator: chunk.locator,
        })),
        evidence_refs: body.data.learning_evidence.slice(0, 1).map((evidence) => ({
          evidence_id: evidence.evidence_id,
          label: "输入学习证据",
          summary: evidence.summary,
        })),
        next_actions: [{
          action_id: `mock_action_${body.data.capability}`,
          kind: "none",
          label: "契约校验完成",
          target: null,
        }],
        failure: null,
      };
      return aiWorkflowResponseSchema.parse(response);
    },
  );

  return app;
}

async function main() {
  const port = Number(process.env.AI_WORKFLOW_MOCK_PORT ?? "4310");
  const secret = process.env.AI_WORKFLOW_MOCK_SECRET ?? "contract-mock-secret";
  const app = buildAiWorkflowContractMock(secret);
  await app.listen({ host: "127.0.0.1", port });
  process.stdout.write(
    `AI workflow contract mock listening at http://127.0.0.1:${port}\n`,
  );
  process.stdout.write(
    "This fixture validates contract 0.2 only; it is not an AI service.\n",
  );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Failed to start AI workflow contract mock: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  });
}
