import type { FastifyInstance } from "fastify";
import { CreateTaskRequestSchema, UpdateTaskStatusRequestSchema } from "@agentmesh/shared";
import type { TaskEngineService } from "../services/task-engine.service.js";
import { getAuth } from "../auth/middleware.js";

export function taskRoutes(
  app: FastifyInstance,
  taskEngine: TaskEngineService,
) {
  // Create task
  app.post("/api/tasks", async (request, reply) => {
    const auth = getAuth(request);
    if (!auth.agentId) {
      reply.code(400).send({ error: "Agent token required" });
      return;
    }
    const body = CreateTaskRequestSchema.parse(request.body);
    const result = await taskEngine.create(auth.agentId, body);
    reply.code(201).send(result);
  });

  // List tasks
  app.get("/api/tasks", async (request) => {
    const query = request.query as Record<string, string>;
    const tasks = await taskEngine.list({
      status: query.status,
      assignedTo: query.assignedTo,
      createdBy: query.createdBy,
    });
    return { tasks };
  });

  // Get task by ID
  app.get("/api/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await taskEngine.findById(id);
    if (!task) {
      reply.code(404).send({ error: "Task not found" });
      return;
    }
    return task;
  });

  // Assign task
  app.post("/api/tasks/:id/assign", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { agentId } = request.body as { agentId: string };
    const task = await taskEngine.assign(id, agentId);
    return task;
  });

  // Update task status
  app.post("/api/tasks/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateTaskStatusRequestSchema.parse(request.body);
    const task = await taskEngine.updateStatus(id, body);
    return task;
  });
}
