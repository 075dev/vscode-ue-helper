/**
 * UbtTaskCompleted 领域事件 —— UBT 构建任务完成时触发
 */

export interface UbtTaskCompletedPayload {
  taskId: string;
  projectName: string;
  status: string;
  exitCode: number;
  durationMs: number;
  errorCount: number;
  warningCount: number;
  timestamp: string;
}

export class UbtTaskCompleted {
  public readonly timestamp: Date;
  public readonly payload: UbtTaskCompletedPayload;

  private constructor(payload: UbtTaskCompletedPayload) {
    this.timestamp = new Date(payload.timestamp);
    this.payload = payload;
  }

  static from(
    taskId: string,
    projectName: string,
    status: string,
    exitCode: number,
    durationMs: number,
    errorCount: number,
    warningCount: number,
  ): UbtTaskCompleted {
    return new UbtTaskCompleted({
      taskId,
      projectName,
      status,
      exitCode,
      durationMs,
      errorCount,
      warningCount,
      timestamp: new Date().toISOString(),
    });
  }

  get eventName(): string {
    return 'UbtTaskCompleted';
  }
}
