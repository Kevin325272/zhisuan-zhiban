import { describe, expect, it } from "vitest";

async function storeClass() {
  const modulePath = "../src/services/ai-workflow/care-conversation-store.js";
  const loaded = await import(modulePath).catch(() => ({})) as {
    EphemeralCareConversationStore?: new (options: {
      maxTurns?: number;
      maxTurnChars?: number;
      now?: () => number;
      ttlMs?: number;
    }) => {
      appendExchange(userId: string, conversationId: string, user: string, assistant: string): void;
      read(userId: string, conversationId: string): Array<{ role: "user" | "assistant"; content: string }>;
    };
  };
  expect(loaded.EphemeralCareConversationStore).toBeTypeOf("function");
  return loaded.EphemeralCareConversationStore!;
}

describe("EphemeralCareConversationStore", () => {
  it("keeps only bounded recent turns and truncates each stored message", async () => {
    let now = 1_000;
    const EphemeralCareConversationStore = await storeClass();
    const store = new EphemeralCareConversationStore({
      maxTurns: 6,
      maxTurnChars: 20,
      now: () => now,
      ttlMs: 60_000,
    });

    for (let index = 1; index <= 4; index += 1) {
      store.appendExchange(
        "student_001",
        "care_001",
        `user-${index}-${"x".repeat(30)}`,
        `assistant-${index}-${"y".repeat(30)}`,
      );
      now += 1;
    }

    const turns = store.read("student_001", "care_001");
    expect(turns).toHaveLength(6);
    expect(turns.map((turn) => turn.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(turns[0]?.content).toMatch(/^user-2-/u);
    expect(turns.every((turn) => turn.content.length <= 20)).toBe(true);
  });

  it("isolates users and conversations and removes expired context", async () => {
    let now = 1_000;
    const EphemeralCareConversationStore = await storeClass();
    const store = new EphemeralCareConversationStore({
      now: () => now,
      ttlMs: 1_000,
    });
    store.appendExchange("student_001", "care_001", "第一轮", "第一条回复");

    expect(store.read("student_002", "care_001")).toEqual([]);
    expect(store.read("student_001", "care_002")).toEqual([]);
    expect(store.read("student_001", "care_001")).toHaveLength(2);

    now = 2_001;
    expect(store.read("student_001", "care_001")).toEqual([]);
  });
});
