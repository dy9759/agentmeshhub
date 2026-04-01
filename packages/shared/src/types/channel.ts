export interface Channel {
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
}

export interface ChannelMember {
  channel: string;
  agentId: string;
  joinedAt: string;
}

export interface CreateChannelRequest {
  name: string;
  description?: string;
}
