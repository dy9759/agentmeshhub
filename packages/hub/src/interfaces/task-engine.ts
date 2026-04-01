import type {
  Task,
  CreateTaskRequest,
  UpdateTaskStatusRequest,
} from "@agentmesh/shared";

export interface TaskEngine {
  create(
    createdBy: string,
    request: CreateTaskRequest,
  ): Promise<{ task: Task; matchedAgents: number }>;

  assign(taskId: string, agentId: string): Promise<Task>;

  updateStatus(
    taskId: string,
    request: UpdateTaskStatusRequest,
  ): Promise<Task>;

  findById(taskId: string): Promise<Task | null>;

  list(opts?: {
    status?: string;
    assignedTo?: string;
    createdBy?: string;
  }): Promise<Task[]>;
}
