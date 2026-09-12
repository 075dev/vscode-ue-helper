/**
 * BuildConfiguration 值对象 —— UBT 构建配置
 */
export type BuildConfigurationType = 'Debug' | 'DebugGame' | 'Development' | 'Shipping' | 'Test';

export class BuildConfiguration {
  private constructor(private readonly _value: BuildConfigurationType) {}

  static create(value: string): BuildConfiguration {
    const v = value as BuildConfigurationType;
    const valid: BuildConfigurationType[] = ['Debug', 'DebugGame', 'Development', 'Shipping', 'Test'];
    if (!valid.includes(v)) {
      throw new Error(`无效的构建配置: "${value}"，应为 ${valid.join('/')}`);
    }
    return new BuildConfiguration(v);
  }

  static debug(): BuildConfiguration { return new BuildConfiguration('Debug'); }
  static debugGame(): BuildConfiguration { return new BuildConfiguration('DebugGame'); }
  static development(): BuildConfiguration { return new BuildConfiguration('Development'); }
  static shipping(): BuildConfiguration { return new BuildConfiguration('Shipping'); }
  static test(): BuildConfiguration { return new BuildConfiguration('Test'); }

  get value(): BuildConfigurationType {
    return this._value;
  }

  equals(other: BuildConfiguration): boolean {
    return this._value === other._value;
  }
}
