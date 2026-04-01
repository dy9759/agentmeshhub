import { describe, it, expect } from "vitest";
import { InteractionSchema, SendInteractionRequestSchema } from "./index.js";

describe("InteractionSchema", () => {
  it("validates a text message", () => {
    const result = InteractionSchema.safeParse({
      id: "int-1",
      type: "message",
      contentType: "text",
      fromAgent: "agent-a",
      target: { agentId: "agent-b" },
      payload: { text: "hello" },
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects interaction with no target fields", () => {
    const result = InteractionSchema.safeParse({
      id: "int-1",
      type: "message",
      contentType: "text",
      fromAgent: "agent-a",
      target: {},  // empty target — should fail refinement
      payload: { text: "hello" },
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("validates a broadcast interaction", () => {
    const result = InteractionSchema.safeParse({
      id: "int-2",
      type: "broadcast",
      contentType: "text",
      fromAgent: "agent-a",
      target: { capability: "code-review" },
      payload: { text: "review this" },
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe("SendInteractionRequestSchema", () => {
  it("validates a DM request", () => {
    const result = SendInteractionRequestSchema.safeParse({
      type: "message",
      contentType: "text",
      target: { agentId: "agent-b" },
      payload: { text: "hi" },
    });
    expect(result.success).toBe(true);
  });

  it("validates a broadcast request", () => {
    const result = SendInteractionRequestSchema.safeParse({
      type: "broadcast",
      contentType: "json",
      target: { capability: "web-scraping" },
      payload: { data: { url: "https://example.com" } },
      metadata: { expectReply: true, schema: "scrape_request" },
    });
    expect(result.success).toBe(true);
  });
});
