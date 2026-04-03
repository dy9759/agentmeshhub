import type {
  Agent,
  AgentRegistration,
  AgentHeartbeat,
  AgentFilter,
  Interaction,
  SendInteractionRequest,
  Channel,
  CreateChannelRequest,
  Task,
  CreateTaskRequest,
  UpdateTaskStatusRequest,
  RegisterResponse,
  ListAgentsResponse,
  ListInteractionsResponse,
  ListChannelsResponse,
  CreateTaskResponse,
  ListTasksResponse,
  HealthResponse,
  CreateOwnerResponse,
  WSMessage,
  WSInteractionPayload,
  WSSessionUpdatePayload,
} from "@agentmesh/shared";
import WebSocket from "ws";

export interface HubClientConfig {
  hubUrl: string;
  apiKey?: string;
  agentToken?: string;
}

export class HubClient {
  private hubUrl: string;
  private token: string;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  private wsReconnectDelay = 5000;
  private pingInterval: NodeJS.Timeout | null = null;
  private interactionCallbacks: Array<(interaction: Interaction) => void> = [];
  private wsConnected = false;

  constructor(config: HubClientConfig) {
    this.hubUrl = config.hubUrl.replace(/\/$/, "");
    this.token = config.agentToken || config.apiKey || "";
  }

  setAgentToken(token: string): void {
    this.token = token;
  }

  getAgentToken(): string {
    return this.token;
  }

  // WebSocket methods
  connectWebSocket(agentId: string): void {
    if (this.ws) return;

    const wsUrl = this.hubUrl.replace(/^http/, "ws") + "/ws";

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.ws!.send(JSON.stringify({
          type: "hello",
          payload: { agentId, agentToken: this.token },
        }));

        // Client-side ping every 30s
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === 1) {
            this.ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
      });

      this.ws.on("message", (data) => {
        try {
          const msg: WSMessage = JSON.parse(data.toString());
          this.handleWSMessage(msg);
        } catch {
          // ignore parse errors
        }
      });

      this.ws.on("close", () => {
        this.wsConnected = false;
        this.ws = null;
        this.scheduleReconnect(agentId);
      });

      this.ws.on("error", () => {
        // error event is followed by close event
      });
    } catch {
      this.scheduleReconnect(agentId);
    }
  }

  private handleWSMessage(msg: WSMessage): void {
    switch (msg.type) {
      case "ack":
        this.wsConnected = true;
        this.wsReconnectDelay = 5000; // reset backoff
        console.log("[hub-client] WebSocket authenticated");
        break;
      case "interaction": {
        const payload = msg.payload as WSInteractionPayload;
        if (payload?.interaction) {
          for (const cb of this.interactionCallbacks) {
            try { cb(payload.interaction); } catch { /* ignore */ }
          }
        }
        break;
      }
      case "ping":
        this.ws?.send(JSON.stringify({ type: "pong" }));
        break;
      case "session_update": {
        const payload = msg.payload as WSSessionUpdatePayload;
        if (payload) {
          for (const cb of this.interactionCallbacks) {
            try { cb({ type: "session_update", ...payload } as any); } catch { /* ignore */ }
          }
        }
        break;
      }
      case "typing":
      case "presence":
        // Forward to callbacks for UI handling
        for (const cb of this.interactionCallbacks) {
          try { cb({ type: msg.type, ...(msg.payload as Record<string, unknown>) } as any); } catch { /* ignore */ }
        }
        break;
      case "error":
        console.error("[hub-client] WS error:", msg.payload);
        break;
    }
  }

  private scheduleReconnect(agentId: string): void {
    if (this.wsReconnectTimer) return;
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectWebSocket(agentId);
      // Exponential backoff: 5s → 10s → 20s → 30s max
      this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, 30000);
    }, this.wsReconnectDelay);
  }

  onInteraction(callback: (interaction: Interaction) => void): void {
    this.interactionCallbacks.push(callback);
  }

  isWebSocketConnected(): boolean {
    return this.wsConnected;
  }

  disconnectWebSocket(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
  }

  private async fetch<T>(
    path: string,
    opts: RequestInit = {},
  ): Promise<T> {
    const url = `${this.hubUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string>),
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...opts,
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Hub API error ${response.status}: ${body}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // Owner
  async createOwner(name: string): Promise<CreateOwnerResponse> {
    return this.fetch("/api/owners", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  // Agent registration
  async register(registration: AgentRegistration): Promise<RegisterResponse> {
    return this.fetch("/api/register", {
      method: "POST",
      body: JSON.stringify(registration),
    });
  }

  async heartbeat(hb: AgentHeartbeat): Promise<Agent> {
    return this.fetch("/api/heartbeat", {
      method: "POST",
      body: JSON.stringify(hb),
    });
  }

  async unregister(agentId: string): Promise<void> {
    return this.fetch(`/api/agents/${agentId}`, {
      method: "DELETE",
    });
  }

  // Agent discovery
  async listAgents(filter?: AgentFilter): Promise<ListAgentsResponse> {
    const params = new URLSearchParams();
    if (filter?.type) params.set("type", filter.type);
    if (filter?.capability) params.set("capability", filter.capability);
    if (filter?.status) params.set("status", filter.status);
    if (filter?.maxLoad !== undefined)
      params.set("maxLoad", String(filter.maxLoad));

    const qs = params.toString();
    return this.fetch(`/api/agents${qs ? `?${qs}` : ""}`);
  }

  async getAgent(agentId: string): Promise<Agent> {
    return this.fetch(`/api/agents/${agentId}`);
  }

  async matchAgents(
    capability: string,
    maxLoad?: number,
  ): Promise<ListAgentsResponse> {
    const params = new URLSearchParams({ capability });
    if (maxLoad !== undefined) params.set("maxLoad", String(maxLoad));
    return this.fetch(`/api/agents/match?${params}`);
  }

  // Interactions
  async sendInteraction(
    request: SendInteractionRequest,
  ): Promise<{ id: string; delivered: boolean }> {
    return this.fetch("/api/interactions", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async pollInteractions(
    agentId: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<ListInteractionsResponse> {
    const params = new URLSearchParams({ agentId });
    if (opts?.afterId) params.set("afterId", opts.afterId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return this.fetch(`/api/interactions?${params}`);
  }

  // Conversations
  async getConversations(
    agentId: string,
  ): Promise<{ conversations: Array<{ agentId: string; lastMessage: Interaction; lastMessageAt: string }> }> {
    return this.fetch(`/api/conversations?agentId=${encodeURIComponent(agentId)}`);
  }

  async getOwnerConversations(
    ownerId: string,
  ): Promise<{ conversations: Array<{ peerId: string; peerType: string; lastMessage: Interaction; lastMessageAt: string }> }> {
    return this.fetch(`/api/conversations?ownerId=${encodeURIComponent(ownerId)}`);
  }

  async getChatHistory(
    myId: string,
    otherId: string,
    opts?: { afterId?: string; limit?: number },
    idType: "agentId" | "ownerId" = "agentId",
  ): Promise<{ messages: Interaction[] }> {
    const params = new URLSearchParams({ [idType]: myId });
    if (opts?.afterId) params.set("afterId", opts.afterId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return this.fetch(`/api/conversations/${encodeURIComponent(otherId)}/messages?${params}`);
  }

  // Owner inbox
  async pollOwnerInteractions(
    ownerId: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<ListInteractionsResponse> {
    const params = new URLSearchParams({ ownerId });
    if (opts?.afterId) params.set("afterId", opts.afterId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return this.fetch(`/api/interactions?${params}`);
  }

  // Channels
  async createChannel(request: CreateChannelRequest): Promise<Channel> {
    return this.fetch("/api/channels", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async listChannels(): Promise<ListChannelsResponse> {
    return this.fetch("/api/channels");
  }

  async joinChannel(channelName: string): Promise<void> {
    return this.fetch(`/api/channels/${channelName}/join`, {
      method: "POST",
    });
  }

  async getChannelMessages(
    channelName: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<ListInteractionsResponse> {
    const params = new URLSearchParams();
    if (opts?.afterId) params.set("afterId", opts.afterId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.fetch(
      `/api/channels/${channelName}/messages${qs ? `?${qs}` : ""}`,
    );
  }

  // Tasks
  async createTask(request: CreateTaskRequest): Promise<CreateTaskResponse> {
    return this.fetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async listTasks(opts?: {
    status?: string;
    assignedTo?: string;
    createdBy?: string;
  }): Promise<ListTasksResponse> {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.assignedTo) params.set("assignedTo", opts.assignedTo);
    if (opts?.createdBy) params.set("createdBy", opts.createdBy);
    const qs = params.toString();
    return this.fetch(`/api/tasks${qs ? `?${qs}` : ""}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.fetch(`/api/tasks/${taskId}`);
  }

  async assignTask(taskId: string, agentId: string): Promise<Task> {
    return this.fetch(`/api/tasks/${taskId}/assign`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
  }

  async updateTaskStatus(
    taskId: string,
    request: UpdateTaskStatusRequest,
  ): Promise<Task> {
    return this.fetch(`/api/tasks/${taskId}/status`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // Health
  async health(): Promise<HealthResponse> {
    return this.fetch("/health");
  }

  // Files
  async uploadFile(
    filePath: string,
  ): Promise<{ id: string; fileName: string; size: number; expiresAt: string }> {
    const { readFileSync } = await import("node:fs");
    const { basename } = await import("node:path");

    const fileName = basename(filePath);
    const fileBuffer = readFileSync(filePath);

    // Build multipart body manually (Node.js built-in FormData not available in all envs)
    const boundary = `----AgentMesh${Date.now()}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(header),
      fileBuffer,
      Buffer.from(footer),
    ]);

    const url = `${this.hubUrl}/api/files`;
    const headers: Record<string, string> = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`File upload failed ${response.status}: ${text}`);
    }

    return response.json() as Promise<{
      id: string;
      fileName: string;
      size: number;
      expiresAt: string;
    }>;
  }

  async downloadFile(
    fileId: string,
    destPath: string,
  ): Promise<{ filePath: string; fileName: string; size: number }> {
    const { writeFileSync } = await import("node:fs");

    const url = `${this.hubUrl}/api/files/${fileId}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`File download failed ${response.status}: ${text}`);
    }

    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const fileName = match ? match[1] : `file-${fileId}`;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    writeFileSync(destPath, buffer);

    return { filePath: destPath, fileName, size: buffer.length };
  }
}
