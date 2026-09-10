/**
 * UE 反射诊断 linter 静态数据（P2-2）。
 *
 * 数据与诊断逻辑分离，同 ueMacroCompletionData 范式。
 * 诊断规则：UCLASS/USTRUCT 缺 GENERATED_BODY、类名前缀违规、UFUNCTION 多 RPC。
 */

/** 反射宏类型 */
export type UeReflectionMacroKind = 'UCLASS' | 'USTRUCT' | 'UENUM' | 'UINTERFACE';

/** GENERATED_BODY 合法变体（任一出现即算满足） */
export const GENERATED_BODY_PATTERNS = [
  'GENERATED_BODY',
  'GENERATED_UCLASS_BODY',
  'GENERATED_USTRUCT_BODY',
  'GENERATED_UINTERFACE_BODY',
] as const;

/** UCLASS/USTRUCT 声明后多少行内必须出现 GENERATED_BODY */
export const GENERATED_BODY_MAX_LOOKAHEAD_LINES = 7;

/** UFUNCTION 中互斥的 RPC specifier（同时出现多个则 error） */
export const UFUNCTION_RPC_SPECIFIERS = ['Server', 'Client', 'NetMulticast'] as const;

/** 反射宏 -> 期望的类名前缀（首字母不符则 warning） */
export const REFLECTION_MACRO_PREFIXES: Readonly<Record<UeReflectionMacroKind, readonly string[]>> =
  {
    // A = AActor 派生，U = UObject 派生（非 Actor），两者皆合法
    UCLASS: ['A', 'U'],
    USTRUCT: ['F'],
    UENUM: ['E'],
    UINTERFACE: ['I'],
  };
