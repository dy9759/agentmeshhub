import type { WebSocket } from "ws";
import type { Interaction, WSMessage } from "@agentmesh/shared";

interface AgentConnection {
  socket: WebSocket;
  agentId: string;
  lastPong: number;
}

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

export class WebSocketManager {
  private connections = new Map<string, AgentConnection>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startPingLoop();
  }

  register(agentId: string, socket: WebSocket): void {
    // Close existing connection if any
    const existing = this.connections.get(agentId);
    if (existing && existing.socket.readyState <= 1) {
      existing.socket.close(1000, "Replaced by new connection");
    }

    this.connections.set(agentId, {
      socket,
      agentId,
      lastPong: Date.now(),
    });

    socket.on("close", () => {
      // Only remove if this is still the active connection
      const current = this.connections.get(agentId);
      if (current?.socket === socket) {
        this.connections.delete(agentId);
      }
    });

    console.log(`[ws-manager] Agent ${agentId} connected (total: ${this.connections.size})`);
  }

  unregister(agentId: string): void {
    const conn = this.connections.get(agentId);
    if (conn) {
      if (conn.socket.readyState <= 1) {
        conn.socket.close(1000, "Unregistered");
      }
      this.connections.delete(agentId);
      console.log(`[ws-manager] Agent ${agentId} disconnected (total: ${this.connections.size})`);
    }
  }

  pushToAgent(agentId: string, interaction: Interaction): boolean {
    const conn = this.connections.get(agentId);
    if (!conn || conn.socket.readyState !== 1) {
      return false;
    }

    const msg: WSMessage = {
      type: "interaction",
      payload: { interaction },
      id: interaction.id,
    };

    try {
      conn.socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  pushToAgents(
    agentIds: string[],
    interaction: Interaction,
  ): { delivered: string[]; failed: string[] } {
    const delivered: string[] = [];
    const failed: string[] = [];

    for (const agentId of agentIds) {
      if (this.pushToAgent(agentId, interaction)) {
        delivered.push(agentId);
      } else {
        failed.push(agentId);
      }
    }

    return { delivered, failed };
  }

  isOnline(agentId: string): boolean {
    const conn = this.connections.get(agentId);
    return conn?.socket.readyState === 1;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      for (const [agentId, conn] of this.connections) {
        if (now - conn.lastPong > PING_INTERVAL_MS + PONG_TIMEOUT_MS) {
          // Pong timeout, close connection
          console.log(`[ws-manager] Agent ${agentId} pong timeout, closing`);
          conn.socket.close(1000, "Pong timeout");
          this.connections.delete(agentId);
          continue;
        }

        if (conn.socket.readyState === 1) {
          conn.socket.send(JSON.stringify({ type: "ping" } as WSMessage));
        }
      }
    }, PING_INTERVAL_MS);
  }

  handlePong(agentId: string): void {
    const conn = this.connections.get(agentId);
    if (conn) {
      conn.lastPong = Date.now();
    }
  }

  destroy(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const [, conn] of this.connections) {
      conn.socket.close(1000, "Server shutting down");
    }
    this.connections.clear();
  }
}
