/**
 * UbtTask 聚合根 —— UBT 构建任务
 *
 * 封装一次 UBT 构建的完整生命周期：
 *   1. 创建（参数配置）
 *   2. 执行（生成 UBT 命令）
 *   3. 完成（记录结果）
 *
 * 对应现有代码中的 UBTArgs / UBTCommand / BuildResult。
 */

import { type UbtTaskId } from '../value-objects/ubt-task-id.vo';
import { type BuildConfiguration } from '../value-objects/build-configuration.vo';
import { type BuildTarget } from '../value-objects/build-target.vo';
import { type BuildPlatform } from '../value-objects/build-platform.vo';
import { UbtTaskCreated } from '../events/ubt-task-created.event';
import { UbtTaskCompleted } from '../events/ubt-task-completed.event';

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type BuildMode = 'build' | 'rebuild' | 'clean';

export interface UbtTaskProps {
  id: UbtTaskId;
  projectPath: string;
  projectName: string;
  configuration: BuildConfiguration;
  target: BuildTarget;
  platform: BuildPlatform;
  ubtPath: string;
  mode: BuildMode;
  status?: TaskStatus;
}

export interface BuildOutput {
  exitCode: number;
  durationMs: number;
  output: string[];
  errorCount: number;
  warningCount: number;
}

export class UbtTask {
  private readonly _id: UbtTaskId;
  private _projectPath: string;
  private _projectName: string;
  private _configuration: BuildConfiguration;
  private _target: BuildTarget;
  private _platform: BuildPlatform;
  private _ubtPath: string;
  private _mode: BuildMode;
  private _status: TaskStatus;
  private _result: BuildOutput | undefined;
  private readonly _events: object[] = [];

  private constructor(props: UbtTaskProps) {
    this._id = props.id;
    this._projectPath = props.projectPath;
    this._projectName = props.projectName;
    this._configuration = props.configuration;
    this._target = props.target;
    this._platform = props.platform;
    this._ubtPath = props.ubtPath;
    this._mode = props.mode;
    this._status = props.status ?? 'pending';
  }

  // ---- 工厂方法 ----

  static create(props: UbtTaskProps): UbtTask {
    const task = new UbtTask(props);
    task._events.push(
      UbtTaskCreated.from(
        props.id.value,
        props.projectName,
        props.configuration.value,
        props.target.value,
        props.platform.value,
      ),
    );
    return task;
  }

  // ---- 领域方法 ----

  /**
   * 标记任务开始运行
   */
  markRunning(): void {
    if (this._status !== 'pending') {
      throw new Error(`不能启动状态为 "${this._status}" 的任务`);
    }
    this._status = 'running';
  }

  /**
   * 标记任务完成并记录结果
   */
  complete(result: BuildOutput): void {
    if (this._status !== 'running') {
      throw new Error(`不能完成状态为 "${this._status}" 的任务`);
    }
    this._status = result.exitCode === 0 ? 'succeeded' : 'failed';
    this._result = result;
    this._events.push(
      UbtTaskCompleted.from(
        this._id.value,
        this._projectName,
        this._status,
        result.exitCode,
        result.durationMs,
        result.errorCount,
        result.warningCount,
      ),
    );
  }

  /**
   * 构建 UBT 命令行参数
   */
  buildCommandArgs(): string[] {
    const targetName = this._target.resolveTargetName(this._projectName);
    return [
      targetName,
      this._platform.value,
      this._configuration.value,
      `-Project=${this._projectPath}`,
      '-waitmutex',
    ];
  }

  // ---- Getters ----

  get id(): UbtTaskId { return this._id; }
  get projectPath(): string { return this._projectPath; }
  get projectName(): string { return this._projectName; }
  get configuration(): BuildConfiguration { return this._configuration; }
  get target(): BuildTarget { return this._target; }
  get platform(): BuildPlatform { return this._platform; }
  get ubtPath(): string { return this._ubtPath; }
  get mode(): BuildMode { return this._mode; }
  get status(): TaskStatus { return this._status; }
  get result(): BuildOutput | undefined { return this._result; }
  get events(): readonly object[] { return [...this._events]; }

  get isPending(): boolean { return this._status === 'pending'; }
  get isRunning(): boolean { return this._status === 'running'; }
  get isCompleted(): boolean { return this._status === 'succeeded' || this._status === 'failed'; }
  get isSuccess(): boolean { return this._status === 'succeeded'; }

  // ---- 相等性 ----

  equals(other: UbtTask): boolean {
    return this._id.equals(other._id);
  }
}
