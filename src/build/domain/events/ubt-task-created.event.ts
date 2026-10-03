/**
 * UbtTaskCreated 领域事件 —— UBT 构建任务被创建时触发
 */

export interface UbtTaskCreatedPayload {
  taskId: string;
  projectName: string;
  configuration: string;
  target: string;
  platform: string;
  timestamp: string;
}

export class UbtTaskCreated {
  public readonly timestamp: Date;
  public readonly payload: UbtTaskCreatedPayload;

  private constructor(payload: UbtTaskCreatedPayload) {
    this.timestamp = new Date(payload.timestamp);
    this.payload = payload;
  }

  static from(
    taskId: string,
    projectName: string,
    configuration: string,
    target: string,
    platform: string,
  ): UbtTaskCreated {
    return new UbtTaskCreated({
      taskId,
      projectName,
      configuration,
      target,
      platform,
      timestamp: new Date().toISOString(),
    });
  }

  get eventName(): string {
    return 'UbtTaskCreated';
  }
}
