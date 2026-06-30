/**
 * UE 反射宏补全静态数据。
 *
 * 数据与解析逻辑分离，便于后续 VS Code provider 复用并保持解析模块单一职责。
 */

export const UE_REFLECTION_MACROS = [
  'UFUNCTION',
  'UPROPERTY',
  'UCLASS',
  'USTRUCT',
  'UENUM',
  'UMETA',
] as const;

export type UeReflectionMacro = (typeof UE_REFLECTION_MACROS)[number];

export type UeMacroCompletionItem = {
  readonly label: string;
  readonly insertText: string;
  readonly detail: string;
  readonly documentation: string;
};

export const META_COMPLETIONS = labels([
  'DisplayName',
  'ToolTip',
  'ShortToolTip',
  'AdvancedDisplay',
  'AutoCreateRefTerm',
  'BlueprintInternalUseOnly',
  'WorldContext',
  'DefaultToSelf',
  'HidePin',
  'DeterminesOutputType',
  'ClampMin',
  'ClampMax',
  'UIMin',
  'UIMax',
  'AllowPrivateAccess',
] as const, 'Metadata');

export const MACRO_COMPLETIONS = {
  UFUNCTION: labels([
    'BlueprintCallable',
    'BlueprintPure',
    'BlueprintImplementableEvent',
    'BlueprintNativeEvent',
    'CallInEditor',
    'Category',
    'Server',
    'Client',
    'NetMulticast',
    'Reliable',
    'meta',
  ] as const, 'FunctionSpecifier'),
  UPROPERTY: labels([
    'EditAnywhere',
    'EditDefaultsOnly',
    'EditInstanceOnly',
    'VisibleAnywhere',
    'BlueprintReadOnly',
    'BlueprintReadWrite',
    'Category',
    'Replicated',
    'ReplicatedUsing',
    'Transient',
    'Config',
    'meta',
  ] as const, 'PropertySpecifier'),
  UCLASS: labels([
    'Blueprintable',
    'BlueprintType',
    'Abstract',
    'Config',
    'ClassGroup',
    'EditInlineNew',
    'MinimalAPI',
    'meta',
  ] as const, 'ClassSpecifier'),
  USTRUCT: labels(['BlueprintType', 'Atomic', 'NoExport', 'Immutable', 'meta'] as const, 'StructSpecifier'),
  UENUM: labels(['BlueprintType', 'Flags', 'ScriptName', 'meta'] as const, 'EnumSpecifier'),
  UMETA: labels(['DisplayName', 'Hidden', 'ToolTip', 'ShortToolTip'] as const, 'Metadata'),
} as const satisfies Record<UeReflectionMacro, readonly UeMacroCompletionItem[]>;

function labels(values: readonly string[], detail: string): readonly UeMacroCompletionItem[] {
  return values.map((value) => item(value, insertTextFor(value), detail));
}

function item(label: string, insertText: string, detail: string): UeMacroCompletionItem {
  return { label, insertText, detail, documentation: `UE ${detail}: ${label}` };
}

function insertTextFor(label: string): string {
  if (label === 'meta') {
    return 'meta=($1)';
  }
  if (label === 'Category' || label === 'DisplayName' || label === 'ToolTip' || label === 'ShortToolTip') {
    return `${label}="$1"`;
  }
  return label;
}
