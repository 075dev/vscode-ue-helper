# Technology Stack

**Project:** VSCodeUEHelper - clangd Proxy Localization Enhancement
**Researched:** 2026-07-01

## Recommended Stack

No new technology is required. The localization feature operates entirely within the existing stack.

### Core Framework
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | (project current) | All proxy code | Already in use; pure string processing, no runtime deps needed |

### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | -- | -- | All localization logic is pure TypeScript regex matching |

### Test Framework
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vitest / Jest | (project current) | Unit tests for cli.ts and localization.ts | Already in use; injectable spawnFn/io params make testing straightforward |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Localization engine | Pure regex rules in TypeScript | i18next / ICU MessageFormat | Overkill for simple pattern replacement; the rules are keyed by regex pattern, not message IDs. clangd does not emit stable message IDs. |
| Rule format | In-code TypeScript array | JSON config file | In-code keeps rules co-located with logic; JSON would require a loader. Could support JSON in future for user customization. |

## Installation

No new packages needed. All code changes are within `src/clangd/proxy/`.

## Sources

- Existing codebase: `src/clangd/proxy/cli.ts`, `bridge.ts`, `cliArgs.ts`, `localization.ts`
- (No external library references needed)
