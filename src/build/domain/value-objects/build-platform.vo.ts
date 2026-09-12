/**
 * BuildPlatform 值对象 —— 构建平台
 */
export type BuildPlatformType = 'Win64' | 'Mac' | 'Linux';

export class BuildPlatform {
  private constructor(private readonly _value: BuildPlatformType) {}

  static create(value: string): BuildPlatform {
    const v = value as BuildPlatformType;
    const valid: BuildPlatformType[] = ['Win64', 'Mac', 'Linux'];
    if (!valid.includes(v)) {
      throw new Error(`无效的构建平台: "${value}"，应为 ${valid.join('/')}`);
    }
    return new BuildPlatform(v);
  }

  static win64(): BuildPlatform { return new BuildPlatform('Win64'); }
  static mac(): BuildPlatform { return new BuildPlatform('Mac'); }
  static linux(): BuildPlatform { return new BuildPlatform('Linux'); }

  get value(): BuildPlatformType {
    return this._value;
  }

  equals(other: BuildPlatform): boolean {
    return this._value === other._value;
  }
}
