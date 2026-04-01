import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, initializeDatabase } from "../db/connection.js";
import { OwnerService } from "./owner.service.js";
import { RegistryService } from "./registry.service.js";
import { MessageBusService } from "./message-bus.service.js";

async function makeServices() {
  const db = createDatabase(":memory:");
  initializeDatabase(db);
  const ownerService = new OwnerService(db);
  const { ownerId } = await ownerService.create("test-owner");
  const registry = new RegistryService(db);
  const bus = new MessageBusService(db, registry);
  return { registry, bus, ownerId };
}

describe("MessageBusService", () => {
  let registry: RegistryService;
  let bus: MessageBusService;
  let OWNER: string;

  beforeEach(async () => {
    ({ registry, bus, ownerId: OWNER } = await makeServices());
  });

  it("sends a DM and polls it", async () => {
    const a1 = await registry.register(OWNER, { name: "sender", type: "generic" });
    const a2 = await registry.register(OWNER, { name: "receiver", type: "generic" });

    await bus.send(a1.agentId, "agent", {
      type: "message",
      contentType: "text",
      target: { agentId: a2.agentId },
      payload: { text: "hello" },
    });

    const interactions = await bus.poll(a2.agentId);
    expect(interactions.length).toBe(1);
    expect(interactions[0].payload.text).toBe("hello");
  });

  it("poll respects afterId cursor", async () => {
    const a1 = await registry.register(OWNER, { name: "s", type: "generic" });
    const a2 = await registry.register(OWNER, { name: "r", type: "generic" });

    const m1 = await bus.send(a1.agentId, "agent", {
      type: "message",
      contentType: "text",
      target: { agentId: a2.agentId },
      payload: { text: "msg1" },
    });
    // Small delay to ensure distinct createdAt timestamps (cursor uses ISO timestamp)
    await new Promise((r) => setTimeout(r, 5));
    await bus.send(a1.agentId, "agent", {
      type: "message",
      contentType: "text",
      target: { agentId: a2.agentId },
      payload: { text: "msg2" },
    });

    const interactions = await bus.poll(a2.agentId, { afterId: m1.id });
    expect(interactions.length).toBe(1);
    expect(interactions[0].payload.text).toBe("msg2");
  });

  it("broadcast fans out to matching agents, skipping sender", async () => {
    const sender = await registry.register(OWNER, {
      name: "broadcaster",
      type: "generic",
      capabilities: ["code-review"],
    });
    const r1 = await registry.register(OWNER, {
      name: "reviewer-1",
      type: "generic",
      capabilities: ["code-review"],
    });
    const r2 = await registry.register(OWNER, {
      name: "reviewer-2",
      type: "generic",
      capabilities: ["code-review"],
    });
    const unrelated = await registry.register(OWNER, {
      name: "other",
      type: "generic",
      capabilities: ["web-scraping"],
    });

    await bus.broadcast(sender.agentId, "agent", {
      type: "broadcast",
      contentType: "text",
      target: { capability: "code-review" },
      payload: { text: "review this" },
    });

    const senderInbox = await bus.poll(sender.agentId);
    const r1Inbox = await bus.poll(r1.agentId);
    const r2Inbox = await bus.poll(r2.agentId);
    const unrelatedInbox = await bus.poll(unrelated.agentId);

    expect(senderInbox.length).toBe(0);  // skip self
    expect(r1Inbox.length).toBe(1);
    expect(r2Inbox.length).toBe(1);
    expect(unrelatedInbox.length).toBe(0);
  });
});
