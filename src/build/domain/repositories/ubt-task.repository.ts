/**
 * UbtTaskRepository —— 仓储接口
 *
 * 定义 UbtTask 聚合根的持久化契约。
 * 实现放在 infrastructure/ 层。
 */

import { type UbtTask } from '../entities/ubt-task.entity';
import { type UbtTaskId } from '../value-objects/ubt-task-id.vo';

export interface UbtTaskRepository {
  save(task: UbtTask): Promise<void>;
  findById(id: UbtTaskId): Promise<UbtTask | null>;
  findAll(): Promise<UbtTask[]>;
  findByProjectName(projectName: string): Promise<UbtTask[]>;
  delete(id: UbtTaskId): Promise<void>;
}
