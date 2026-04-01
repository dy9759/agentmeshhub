import { eq, and } from "drizzle-orm";
import {
  generateTaskId,
  AppError,
  type Task,
  type CreateTaskRequest,
  type UpdateTaskStatusRequest,
} from "@agentmesh/shared";
import type { DB } from "../db/connection.js";
import { tasks } from "../db/schema.js";
import type { TaskEngine } from "../interfaces/task-engine.js";
import type { Registry } from "../interfaces/registry.js";

function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    type: row.type,
    requiredCapabilities: JSON.parse(row.requiredCapabilities),
    createdBy: row.createdBy,
    assignedTo: row.assignedTo ?? undefined,
    candidates: row.candidates ? JSON.parse(row.candidates) : undefined,
    status: row.status as Task["status"],
    payload: JSON.parse(row.payload),
    result: row.result ? JSON.parse(row.result) : undefined,
    timeoutMs: row.timeoutMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TaskEngineService implements TaskEngine {
  constructor(
    private db: DB,
    private registry: Registry,
  ) {}

  async create(
    createdBy: string,
    request: CreateTaskRequest,
  ): Promise<{ task: Task; matchedAgents: number }> {
    const id = generateTaskId();
    const now = new Date().toISOString();

    // Find capable agents for each required capability
    const allCandidates = new Set<string>();
    for (const cap of request.requiredCapabilities) {
      const matched = await this.registry.matchByCapability(cap);
      matched.forEach((a) => allCandidates.add(a.agentId));
    }
    // Remove the creator from candidates
    allCandidates.delete(createdBy);

    const candidatesList = [...allCandidates];

    this.db
      .insert(tasks)
      .values({
        id,
        type: request.type,
        requiredCapabilities: JSON.stringify(request.requiredCapabilities),
        createdBy,
        candidates: JSON.stringify(candidatesList),
        status: "pending",
        payload: JSON.stringify(request.payload),
        timeoutMs: request.timeoutMs ?? 30000,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Auto-assign to the least loaded candidate if available
    if (candidatesList.length > 0) {
      await this.assign(id, candidatesList[0]); // already sorted by load
    }

    const task = (await this.findById(id))!;
    return { task, matchedAgents: candidatesList.length };
  }

  async assign(taskId: string, agentId: string): Promise<Task> {
    const now = new Date().toISOString();
    this.db
      .update(tasks)
      .set({ assignedTo: agentId, status: "assigned", updatedAt: now })
      .where(eq(tasks.id, taskId))
      .run();

    return (await this.findById(taskId))!;
  }

  async updateStatus(
    taskId: string,
    request: UpdateTaskStatusRequest,
  ): Promise<Task> {
    const now = new Date().toISOString();
    const updates: Partial<typeof tasks.$inferInsert> = {
      status: request.status,
      updatedAt: now,
    };
    if (request.result) {
      updates.result = JSON.stringify(request.result);
    }

    this.db.update(tasks).set(updates).where(eq(tasks.id, taskId)).run();

    return (await this.findById(taskId))!;
  }

  async findById(taskId: string): Promise<Task | null> {
    const row = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();

    return row ? rowToTask(row) : null;
  }

  async list(opts?: {
    status?: string;
    assignedTo?: string;
    createdBy?: string;
  }): Promise<Task[]> {
    const conditions = [];
    if (opts?.status) conditions.push(eq(tasks.status, opts.status));
    if (opts?.assignedTo) conditions.push(eq(tasks.assignedTo, opts.assignedTo));
    if (opts?.createdBy) conditions.push(eq(tasks.createdBy, opts.createdBy));

    const query =
      conditions.length > 0
        ? this.db.select().from(tasks).where(and(...conditions))
        : this.db.select().from(tasks);

    return query.all().map(rowToTask);
  }
}
