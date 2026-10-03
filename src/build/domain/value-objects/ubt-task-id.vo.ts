/**
 * UbtTaskId 值对象 —— UBT 构建任务的唯一标识
 */
export class UbtTaskId {
  private constructor(private readonly _value: string) {
    if (!_value || _value.trim().length === 0) {
      throw new Error('UbtTaskId 不能为空');
    }
  }

  static create(): UbtTaskId {
    return new UbtTaskId(crypto.randomUUID());
  }

  static fromString(id: string): UbtTaskId {
    if (!id || id.trim().length === 0) {
      throw new Error('UbtTaskId 不能为空');
    }
    return new UbtTaskId(id);
  }

  get value(): string {
    return this._value;
  }

  equals(other: UbtTaskId): boolean {
    return this._value === other._value;
  }
}
