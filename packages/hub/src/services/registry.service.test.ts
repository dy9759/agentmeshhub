import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, initializeDatabase } from "../db/connection.js";
import { RegistryService } from "./registry.service.js";
import { OwnerService } from "./owner.service.js";

async function makeDb() {
  const db = createDatabase(":memory:");
  initializeDatabase(db);
  // Create a real owner to satisfy FK constraints
  const ownerService = new OwnerService(db);
  const { ownerId } = await ownerService.create("test-owner");
  return { db, ownerId };
}

describe("RegistryService", () => {
  let registry: RegistryService;
  let OWNER: string;

  beforeEach(async () => {
    const { db, ownerId } = await makeDb();
    registry = new RegistryService(db);
    OWNER = ownerId;
  });

  it("registers an agent and returns an Agent record", async () => {
    const agent = await registry.register(OWNER, {
      name: "test-agent",
      type: "generic",
    });

    expect(agent.agentId).toBeDefined();
    expect(agent.name).toBe("test-agent");
    expect(agent.state.status).toBe("online");
  });

  it("upserts agent on re-registration with same name + machineId + ownerId", async () => {
    const reg = { name: "agent-a", type: "generic" as const, machineId: "machine-1" };
    const a1 = await registry.register(OWNER, reg);
    const a2 = await registry.register(OWNER, reg);

    expect(a2.agentId).toBe(a1.agentId);
  });

  it("finds agent by id", async () => {
    const created = await registry.register(OWNER, { name: "finder", type: "generic" });
    const found = await registry.findById(created.agentId);

    expect(found).not.toBeNull();
    expect(found?.name).toBe("finder");
  });

  it("heartbeat updates last heartbeat and load", async () => {
    const agent = await registry.register(OWNER, { name: "hb-agent", type: "generic" });
    const updated = await registry.heartbeat({ agentId: agent.agentId, load: 0.5 });

    expect(updated.state.load).toBe(0.5);
  });

  it("matchByCapability returns agents with matching capability, sorted by load", async () => {
    const a1 = await registry.register(OWNER, {
      name: "reviewer-1",
      type: "generic",
      capabilities: ["code-review"],
    });
    const a2 = await registry.register(OWNER, {
      name: "reviewer-2",
      type: "generic",
      capabilities: ["code-review"],
    });

    await registry.heartbeat({ agentId: a1.agentId, load: 0.8 });
    await registry.heartbeat({ agentId: a2.agentId, load: 0.2 });

    const agents = await registry.matchByCapability("code-review");

    expect(agents.length).toBe(2);
    expect(agents[0].agentId).toBe(a2.agentId); // lower load first
    expect(agents[1].agentId).toBe(a1.agentId);
  });

  it("matchByCapability respects maxLoad filter", async () => {
    const heavy = await registry.register(OWNER, {
      name: "heavy",
      type: "generic",
      capabilities: ["code-review"],
    });
    const light = await registry.register(OWNER, {
      name: "light",
      type: "generic",
      capabilities: ["code-review"],
    });

    await registry.heartbeat({ agentId: heavy.agentId, load: 0.9 });
    await registry.heartbeat({ agentId: light.agentId, load: 0.3 });

    const agents = await registry.matchByCapability("code-review", { maxLoad: 0.7 });

    expect(agents.length).toBe(1);
    expect(agents[0].agentId).toBe(light.agentId);
  });
});
