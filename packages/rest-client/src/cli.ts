#!/usr/bin/env node
import { Command } from "commander";
import { AgentMeshClient } from "./client.js";

const program = new Command();

program
  .name("agentmesh")
  .description("AgentMesh CLI — manage agents, send messages, create tasks")
  .version("0.1.0")
  .option("--hub <url>", "Hub URL", process.env.AGENTMESH_HUB_URL ?? "http://localhost:5555")
  .option("--key <apiKey>", "Owner API key", process.env.AGENTMESH_API_KEY ?? "");

function getClient(opts: { hub: string; key: string }): AgentMeshClient {
  if (!opts.key) {
    console.error("Error: API key required. Set AGENTMESH_API_KEY or use --key");
    process.exit(1);
  }
  return new AgentMeshClient({ hubUrl: opts.hub, apiKey: opts.key });
}

function print(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

// ── Health ─────────────────────────────────────────────────────────────────
program
  .command("health")
  .description("Check Hub health")
  .action(async () => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.health());
  });

// ── Owner ──────────────────────────────────────────────────────────────────
program
  .command("owner:create <name>")
  .description("Create a new owner and get an API key")
  .action(async (name: string) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = new AgentMeshClient({ hubUrl: opts.hub, apiKey: "" });
    print(await client.createOwner(name));
  });

// ── Agents ─────────────────────────────────────────────────────────────────
const agents = program.command("agent").description("Agent management");

agents
  .command("register <name>")
  .description("Register an agent")
  .option("-t, --type <type>", "Agent type", "generic")
  .option("-c, --capabilities <caps>", "Comma-separated capabilities")
  .action(async (name: string, cmdOpts: { type: string; capabilities?: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    const capabilities = cmdOpts.capabilities?.split(",").filter(Boolean);
    const result = await client.register({
      name,
      type: cmdOpts.type as "claude-code" | "openclaw" | "gemini" | "generic",
      capabilities,
    });
    print(result);
  });

agents
  .command("list")
  .description("List registered agents")
  .option("-c, --capability <cap>", "Filter by capability")
  .option("-s, --status <status>", "Filter by status")
  .action(async (cmdOpts: { capability?: string; status?: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.listAgents({ capability: cmdOpts.capability, status: cmdOpts.status as "online" | "offline" | "busy" | undefined }));
  });

agents
  .command("get <agentId>")
  .description("Get agent details")
  .action(async (agentId: string) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.getAgent(agentId));
  });

agents
  .command("match <capability>")
  .description("Find agents matching a capability")
  .option("--max-load <load>", "Maximum load (0-1)", "0.8")
  .action(async (capability: string, cmdOpts: { maxLoad: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.matchAgents(capability, parseFloat(cmdOpts.maxLoad)));
  });

// ── Messages ───────────────────────────────────────────────────────────────
const msg = program.command("msg").description("Send and receive messages");

msg
  .command("send <toAgentId> <text>")
  .description("Send a direct message to an agent")
  .action(async (toAgentId: string, text: string) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.send({
      type: "message",
      contentType: "text",
      target: { agentId: toAgentId },
      payload: { text },
    }));
  });

msg
  .command("poll <agentId>")
  .description("Poll inbox for an agent")
  .option("--after <id>", "Only return messages after this ID")
  .action(async (agentId: string, cmdOpts: { after?: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.poll(agentId, cmdOpts.after));
  });

msg
  .command("broadcast <capability> <text>")
  .description("Broadcast a message to agents with a capability")
  .action(async (capability: string, text: string) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.send({
      type: "broadcast",
      contentType: "text",
      target: { capability },
      payload: { text },
    }));
  });

// ── Channels ───────────────────────────────────────────────────────────────
const ch = program.command("channel").description("Channel management");

ch
  .command("create <name>")
  .description("Create a channel")
  .option("-d, --description <desc>", "Channel description")
  .action(async (name: string, cmdOpts: { description?: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.createChannel({ name, description: cmdOpts.description }));
  });

ch
  .command("list")
  .description("List channels")
  .action(async () => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.listChannels());
  });

ch
  .command("join <name>")
  .description("Join a channel (requires registered agentId — use --key as agentToken)")
  .action(async (name: string) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    await client.joinChannel(name);
    console.log(`Joined channel '${name}'`);
  });

// ── Tasks ──────────────────────────────────────────────────────────────────
const task = program.command("task").description("Task management");

task
  .command("create <type>")
  .description("Create a task")
  .requiredOption("-c, --capabilities <caps>", "Required capabilities (comma-separated)")
  .option("-p, --payload <json>", "Task payload as JSON string", "{}")
  .action(async (type: string, cmdOpts: { capabilities: string; payload: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    const requiredCapabilities = cmdOpts.capabilities.split(",").filter(Boolean);
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(cmdOpts.payload) as Record<string, unknown>;
    } catch {
      console.error("Error: --payload must be valid JSON");
      process.exit(1);
    }
    print(await client.createTask({ type, requiredCapabilities, payload }));
  });

task
  .command("list")
  .description("List tasks")
  .option("-s, --status <status>", "Filter by status")
  .action(async (cmdOpts: { status?: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.listTasks({ status: cmdOpts.status }));
  });

task
  .command("get <taskId>")
  .description("Get task details")
  .action(async (taskId: string) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    print(await client.getTask(taskId));
  });

task
  .command("status <taskId> <status>")
  .description("Update task status")
  .option("-r, --result <json>", "Result JSON")
  .action(async (taskId: string, status: string, cmdOpts: { result?: string }) => {
    const opts = program.opts<{ hub: string; key: string }>();
    const client = getClient(opts);
    let result: Record<string, unknown> | undefined;
    if (cmdOpts.result) {
      try {
        result = JSON.parse(cmdOpts.result) as Record<string, unknown>;
      } catch {
        console.error("Error: --result must be valid JSON");
        process.exit(1);
      }
    }
    print(await client.updateTaskStatus(taskId, {
      status: status as "pending" | "assigned" | "running" | "done" | "failed",
      result,
    }));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
