/**
 * BuildTarget 值对象 —— UBT 构建目标类型
 */
export type BuildTargetType = 'Editor' | 'Game' | 'Server' | 'Client';

export class BuildTarget {
  private constructor(private readonly _value: BuildTargetType) {}

  static create(value: string): BuildTarget {
    const v = value as BuildTargetType;
    const valid: BuildTargetType[] = ['Editor', 'Game', 'Server', 'Client'];
    if (!valid.includes(v)) {
      throw new Error(`无效的构建目标: "${value}"，应为 ${valid.join('/')}`);
    }
    return new BuildTarget(v);
  }

  static editor(): BuildTarget { return new BuildTarget('Editor'); }
  static game(): BuildTarget { return new BuildTarget('Game'); }
  static server(): BuildTarget { return new BuildTarget('Server'); }
  static client(): BuildTarget { return new BuildTarget('Client'); }

  get value(): BuildTargetType {
    return this._value;
  }

  /**
   * 解析为 UBT 实际使用的 target 名（如 MyProjectEditor）
   */
  resolveTargetName(projectName: string): string {
    switch (this._value) {
      case 'Editor': return `${projectName}Editor`;
      case 'Server': return `${projectName}Server`;
      case 'Client': return `${projectName}Client`;
      case 'Game': default: return projectName;
    }
  }

  equals(other: BuildTarget): boolean {
    return this._value === other._value;
  }
}
