import type { FastifyInstance } from "fastify";
import type { TeamService } from "../services/team.service.js";
import type { MessageBusService } from "../services/message-bus.service.js";
import { getAuth } from "../auth/middleware.js";

export function teamRoutes(
  app: FastifyInstance,
  teamService: TeamService,
  messageBus: MessageBusService,
) {
  // Create team
  app.post("/api/teams", async (request, reply) => {
    const auth = getAuth(request);
    const body = request.body as {
      name: string;
      description?: string;
      members?: Array<{ id: string; type: string }>;
    };
    const leaderId = auth.agentId ?? auth.ownerId;
    const leaderType = auth.agentId ? "agent" : "owner";
    if (!leaderId) {
      reply.code(400).send({ error: "Auth required" });
      return;
    }

    try {
      const team = await teamService.create(
        leaderId,
        leaderType as "agent" | "owner",
        {
          name: body.name,
          description: body.description,
          members: body.members as any,
        },
      );
      reply.code(201).send(team);
    } catch (err: any) {
      if (err.statusCode) {
        reply.code(err.statusCode).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // List teams
  app.get("/api/teams", async () => {
    const teams = await teamService.list();
    return { teams };
  });

  // Get team
  app.get("/api/teams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const team = await teamService.findById(id);
    if (!team) {
      reply.code(404).send({ error: "Team not found" });
      return;
    }
    return team;
  });

  // Add member
  app.post("/api/teams/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { memberId: string; memberType: string };
    try {
      const team = await teamService.addMember(
        id,
        body.memberId,
        body.memberType as "agent" | "owner",
      );
      return team;
    } catch (err: any) {
      if (err.statusCode) {
        reply.code(err.statusCode).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Remove member
  app.delete("/api/teams/:id/members/:memberId", async (request, reply) => {
    const { id, memberId } = request.params as {
      id: string;
      memberId: string;
    };
    try {
      const team = await teamService.removeMember(id, memberId);
      return team;
    } catch (err: any) {
      if (err.statusCode) {
        reply.code(err.statusCode).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Delete team
  app.delete("/api/teams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await teamService.delete(id);
    reply.code(204).send();
  });

  // Broadcast to team
  app.post("/api/teams/:id/broadcast", async (request, reply) => {
    const auth = getAuth(request);
    const { id } = request.params as { id: string };
    const body = request.body as { text: string };
    const fromId = auth.agentId ?? auth.ownerId;
    const fromType = auth.agentId ? "agent" : "owner";
    if (!fromId) {
      reply.code(400).send({ error: "Auth required" });
      return;
    }

    const team = await teamService.findById(id);
    if (!team) {
      reply.code(404).send({ error: "Team not found" });
      return;
    }

    const results = [];
    for (const member of team.members) {
      if (member.id === fromId) continue;
      try {
        const target =
          member.type === "agent"
            ? { agentId: member.id }
            : { ownerId: member.id };
        const r = await messageBus.send(
          fromId,
          fromType as "agent" | "owner",
          {
            type: "message",
            contentType: "text",
            target,
            payload: {
              text: body.text,
              data: { teamId: id, teamName: team.name },
            },
          },
        );
        results.push(r);
      } catch {
        /* skip unreachable members */
      }
    }

    reply
      .code(201)
      .send({ delivered: results.length, total: team.members.length - 1 });
  });
}
