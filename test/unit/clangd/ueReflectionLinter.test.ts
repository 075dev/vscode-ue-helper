/**
 * ueReflectionLinter 单元测试（P2-2）
 *
 * 直接测纯函数 analyzeReflection，覆盖三条规则：
 *   1. UCLASS/USTRUCT 缺 GENERATED_BODY -> error
 *   2. 反射宏类名前缀违规 -> warning
 *   3. UFUNCTION 多 RPC specifier -> error
 */
import { describe, it, expect } from 'vitest';
import { analyzeReflection } from '@clangd/ueReflectionLinter';

describe('analyzeReflection (P2-2)', () => {
  it('UCLASS 有 GENERATED_BODY 且前缀合规 -> 无诊断', () => {
    const code = `UCLASS()
class AMyActor : public AActor
{
    GENERATED_BODY()
public:
    void Foo();
};`;
    expect(analyzeReflection(code)).toEqual([]);
  });

  it('UCLASS 缺 GENERATED_BODY -> error ue-missing-generated-body', () => {
    const code = `UCLASS()
class AMyActor : public AActor
{
public:
    void Foo();
};`;
    const diags = analyzeReflection(code);
    const missing = diags.find((d) => d.code === 'ue-missing-generated-body');
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe('error');
  });

  it('UCLASS 前缀违规（M 不在 A/U）-> warning ue-prefix', () => {
    const code = `UCLASS()
class MyClass : public UObject
{
    GENERATED_BODY()
};`;
    const diags = analyzeReflection(code);
    const prefix = diags.find((d) => d.code === 'ue-prefix');
    expect(prefix).toBeDefined();
    expect(prefix?.severity).toBe('warning');
    expect(prefix?.message).toContain('MyClass');
  });

  it('USTRUCT 前缀 F 合规且有 GENERATED_BODY -> 无诊断', () => {
    const code = `USTRUCT()
struct FMyStruct
{
    GENERATED_BODY()
};`;
    expect(analyzeReflection(code)).toEqual([]);
  });

  it('UFUNCTION 同时指定 Server 和 Client -> error ue-multi-rpc', () => {
    const code = `UFUNCTION(Server, Client)
void MyRPC();`;
    const diags = analyzeReflection(code);
    const rpc = diags.find((d) => d.code === 'ue-multi-rpc');
    expect(rpc).toBeDefined();
    expect(rpc?.severity).toBe('error');
    expect(rpc?.message).toContain('Server');
    expect(rpc?.message).toContain('Client');
  });

  it('UFUNCTION 单个 RPC specifier -> 无 multi-rpc 诊断', () => {
    const code = `UFUNCTION(Server, reliable)
void MyServerRPC();`;
    const diags = analyzeReflection(code);
    expect(diags.find((d) => d.code === 'ue-multi-rpc')).toBeUndefined();
  });

  it('UENUM enum class E 前缀合规 -> 无诊断', () => {
    const code = `UENUM(BlueprintType)
enum class EMyEnum : uint8
{
    Value1,
    Value2,
};`;
    expect(analyzeReflection(code)).toEqual([]);
  });
});
