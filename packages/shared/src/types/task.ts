export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "done"
  | "failed";

export interface Task {
  id: string;
  type: string;
  requiredCapabilities: string[];
  createdBy: string;
  assignedTo?: string;
  candidates?: string[]; // agent IDs who can handle it
  status: TaskStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  type: string;
  requiredCapabilities: string[];
  payload: Record<string, unknown>;
  timeoutMs?: number;
}

export interface UpdateTaskStatusRequest {
  status: TaskStatus;
  result?: Record<string, unknown>;
}
