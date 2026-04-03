import { eq } from "drizzle-orm";
import { generateTeamId, AppError } from "@agentmesh/shared";
import type { Team, TeamMember, CreateTeamRequest } from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { teams, agents, owners } from "../db/schema.js";

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

function rowToTeam(row: typeof teams.$inferSelect): Team {
  return {
    id: row.id,
    name: row.name,
    leaderId: row.leaderId,
    leaderType: row.leaderType as "agent" | "owner",
    members: safeJsonParse<TeamMember[]>(row.members, []),
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TeamService {
  constructor(private db: DB) {}

  async create(
    leaderId: string,
    leaderType: "agent" | "owner",
    request: CreateTeamRequest,
  ): Promise<Team> {
    const id = generateTeamId();
    const now = new Date().toISOString();

    // Validate members exist
    if (request.members) {
      for (const m of request.members) {
        if (m.type === "agent") {
          const a = this.db
            .select({ agentId: agents.agentId })
            .from(agents)
            .where(eq(agents.agentId, m.id))
            .get();
          if (!a) throw new AppError(`Agent '${m.id}' not found`, 404);
        } else {
          const o = this.db
            .select({ ownerId: owners.ownerId })
            .from(owners)
            .where(eq(owners.ownerId, m.id))
            .get();
          if (!o) throw new AppError(`Owner '${m.id}' not found`, 404);
        }
      }
    }

    const members: TeamMember[] = [
      { id: leaderId, type: leaderType, role: "leader", joinedAt: now },
      ...(request.members ?? []).map((m) => ({
        id: m.id,
        type: m.type,
        role: "member" as const,
        joinedAt: now,
      })),
    ];

    this.db
      .insert(teams)
      .values({
        id,
        name: request.name,
        leaderId,
        leaderType,
        members: JSON.stringify(members),
        description: request.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return (await this.findById(id)) as Team;
  }

  async findById(teamId: string): Promise<Team | null> {
    const row = this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .get();
    return row ? rowToTeam(row) : null;
  }

  async findByName(name: string): Promise<Team | null> {
    const row = this.db
      .select()
      .from(teams)
      .where(eq(teams.name, name))
      .get();
    return row ? rowToTeam(row) : null;
  }

  async addMember(
    teamId: string,
    memberId: string,
    memberType: "agent" | "owner",
  ): Promise<Team> {
    const team = await this.findById(teamId);
    if (!team) throw new AppError("Team not found", 404);

    if (team.members.some((m) => m.id === memberId)) {
      return team; // already a member
    }

    const now = new Date().toISOString();
    const members = [
      ...team.members,
      {
        id: memberId,
        type: memberType,
        role: "member" as const,
        joinedAt: now,
      },
    ];

    this.db
      .update(teams)
      .set({
        members: JSON.stringify(members),
        updatedAt: now,
      })
      .where(eq(teams.id, teamId))
      .run();

    return (await this.findById(teamId)) as Team;
  }

  async removeMember(teamId: string, memberId: string): Promise<Team> {
    const team = await this.findById(teamId);
    if (!team) throw new AppError("Team not found", 404);
    if (memberId === team.leaderId)
      throw new AppError("Cannot remove team leader", 400);

    const now = new Date().toISOString();
    const members = team.members.filter((m) => m.id !== memberId);

    this.db
      .update(teams)
      .set({
        members: JSON.stringify(members),
        updatedAt: now,
      })
      .where(eq(teams.id, teamId))
      .run();

    return (await this.findById(teamId)) as Team;
  }

  async list(): Promise<Team[]> {
    const rows = this.db.select().from(teams).all();
    return rows.map(rowToTeam);
  }

  async delete(teamId: string): Promise<void> {
    this.db.delete(teams).where(eq(teams.id, teamId)).run();
  }
}
