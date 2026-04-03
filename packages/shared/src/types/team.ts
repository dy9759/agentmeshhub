export type TeamRole = "leader" | "member";

export interface TeamMember {
  id: string;
  type: "agent" | "owner";
  role: TeamRole;
  joinedAt: string;
}

export interface Team {
  id: string;
  name: string;
  leaderId: string;
  leaderType: "agent" | "owner";
  members: TeamMember[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
  members?: Array<{ id: string; type: "agent" | "owner" }>;
}
