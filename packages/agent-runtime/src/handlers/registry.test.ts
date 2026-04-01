import { describe, it, expect, vi } from "vitest";
import { HandlerRegistry } from "./registry.js";
import type { Interaction } from "@agentmesh/shared";

function makeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: "int-1",
    type: "message",
    contentType: "text",
    fromId: "agent-a",
    fromType: "agent",
    fromAgent: "agent-a",
    target: { agentId: "agent-b" },
    payload: { text: "hello" },
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("HandlerRegistry", () => {
  it("matches by schema", async () => {
    const registry = new HandlerRegistry();
    const handler = { canHandle: vi.fn(() => true), handle: vi.fn(async () => null) };
    registry.onSchema("code_review_request", handler);

    const interaction = makeInteraction({ metadata: { schema: "code_review_request" } });
    const matched = registry.match(interaction);
    expect(matched).toBe(handler);
  });

  it("matches by capability for broadcast", () => {
    const registry = new HandlerRegistry();
    const handler = { canHandle: vi.fn(() => true), handle: vi.fn(async () => null) };
    registry.onCapability("code-review", handler);

    const interaction = makeInteraction({
      type: "broadcast",
      target: { capability: "code-review" },
    });
    const matched = registry.match(interaction);
    expect(matched).toBe(handler);
  });

  it("schema match takes priority over capability", () => {
    const registry = new HandlerRegistry();
    const schemaHandler = { canHandle: vi.fn(() => true), handle: vi.fn(async () => null) };
    const capHandler = { canHandle: vi.fn(() => true), handle: vi.fn(async () => null) };

    registry.onSchema("my_schema", schemaHandler);
    registry.onCapability("code-review", capHandler);

    const interaction = makeInteraction({
      type: "broadcast",
      target: { capability: "code-review" },
      metadata: { schema: "my_schema" },
    });
    expect(registry.match(interaction)).toBe(schemaHandler);
  });

  it("falls back to generic handler via canHandle", () => {
    const registry = new HandlerRegistry();
    const nopeHandler = { canHandle: vi.fn(() => false), handle: vi.fn(async () => null) };
    const yesHandler = { canHandle: vi.fn(() => true), handle: vi.fn(async () => null) };
    registry.addHandler(nopeHandler);
    registry.addHandler(yesHandler);

    const matched = registry.match(makeInteraction());
    expect(matched).toBe(yesHandler);
  });

  it("falls back to default handler", () => {
    const registry = new HandlerRegistry();
    const defaultHandler = { canHandle: vi.fn(() => true), handle: vi.fn(async () => null) };
    registry.setDefaultHandler(defaultHandler);

    const matched = registry.match(makeInteraction());
    expect(matched).toBe(defaultHandler);
  });

  it("returns null when no handler matches", () => {
    const registry = new HandlerRegistry();
    expect(registry.match(makeInteraction())).toBeNull();
  });
});
