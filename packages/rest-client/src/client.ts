import { HubClient } from "@agentmesh/hub";
import type {
  AgentRegistration,
  AgentFilter,
  SendInteractionRequest,
  CreateChannelRequest,
  CreateTaskRequest,
  UpdateTaskStatusRequest,
} from "@agentmesh/shared";

export interface AgentMeshClientConfig {
  hubUrl: string;
  apiKey: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * AgentMeshClient — thin wrapper around HubClient with retry logic.
 * Intended for use in scripts, CLIs, and integrations.
 */
export class AgentMeshClient {
  private hub: HubClient;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: AgentMeshClientConfig) {
    this.hub = new HubClient({
      hubUrl: config.hubUrl,
      apiKey: config.apiKey,
    });
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          await sleep(this.retryDelayMs * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  // Owner
  createOwner(name: string) {
    return this.withRetry(() => this.hub.createOwner(name));
  }

  // Agents
  register(registration: AgentRegistration) {
    return this.withRetry(() => this.hub.register(registration)).then((res) => {
      this.hub.setAgentToken(res.agentToken);
      return res;
    });
  }

  heartbeat(agentId: string, load?: number) {
    return this.withRetry(() => this.hub.heartbeat({ agentId, load }));
  }

  unregister(agentId: string) {
    return this.withRetry(() => this.hub.unregister(agentId));
  }

  listAgents(filter?: AgentFilter) {
    return this.withRetry(() => this.hub.listAgents(filter));
  }

  getAgent(agentId: string) {
    return this.withRetry(() => this.hub.getAgent(agentId));
  }

  matchAgents(capability: string, maxLoad?: number) {
    return this.withRetry(() => this.hub.matchAgents(capability, maxLoad));
  }

  // Interactions
  send(request: SendInteractionRequest) {
    return this.withRetry(() => this.hub.sendInteraction(request));
  }

  poll(agentId: string, afterId?: string, limit?: number) {
    return this.withRetry(() => this.hub.pollInteractions(agentId, { afterId, limit }));
  }

  // Channels
  createChannel(request: CreateChannelRequest) {
    return this.withRetry(() => this.hub.createChannel(request));
  }

  listChannels() {
    return this.withRetry(() => this.hub.listChannels());
  }

  joinChannel(channelName: string) {
    return this.withRetry(() => this.hub.joinChannel(channelName));
  }

  getChannelMessages(channelName: string, afterId?: string) {
    return this.withRetry(() => this.hub.getChannelMessages(channelName, { afterId }));
  }

  // Tasks
  createTask(request: CreateTaskRequest) {
    return this.withRetry(() => this.hub.createTask(request));
  }

  listTasks(opts?: { status?: string; assignedTo?: string; createdBy?: string }) {
    return this.withRetry(() => this.hub.listTasks(opts));
  }

  getTask(taskId: string) {
    return this.withRetry(() => this.hub.getTask(taskId));
  }

  assignTask(taskId: string, agentId: string) {
    return this.withRetry(() => this.hub.assignTask(taskId, agentId));
  }

  updateTaskStatus(taskId: string, request: UpdateTaskStatusRequest) {
    return this.withRetry(() => this.hub.updateTaskStatus(taskId, request));
  }

  // Health
  health() {
    return this.withRetry(() => this.hub.health());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
