import type {
  Interaction,
  SendInteractionRequest,
  SenderType,
} from "@agentmesh/shared";

export interface MessageBus {
  send(
    fromId: string,
    fromType: SenderType,
    request: SendInteractionRequest,
  ): Promise<Interaction>;

  sendToChannel(
    fromId: string,
    fromType: SenderType,
    channel: string,
    request: SendInteractionRequest,
  ): Promise<Interaction>;

  broadcast(
    fromId: string,
    fromType: SenderType,
    request: SendInteractionRequest,
  ): Promise<Interaction[]>;

  poll(
    agentId: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<Interaction[]>;

  pollOwner(
    ownerId: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<Interaction[]>;

  getChannelMessages(
    channel: string,
    opts?: { afterId?: string; limit?: number },
  ): Promise<Interaction[]>;

  getConversations(
    agentId: string,
  ): Promise<Array<{ agentId: string; lastMessage: Interaction; lastMessageAt: string }>>;

  getOwnerConversations(
    ownerId: string,
  ): Promise<Array<{ peerId: string; peerType: "agent" | "owner"; lastMessage: Interaction; lastMessageAt: string }>>;

  getChatHistory(
    myId: string,
    otherId: string,
    opts?: { afterId?: string; limit?: number; beforeId?: string },
  ): Promise<Interaction[]>;
}
