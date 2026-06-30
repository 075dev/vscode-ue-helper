# Roadmap: VSCode UE Helper — 控制面板

**Milestone:** v1.0 — 控制面板
**Defined:** 2026-06-30
**Core Value:** UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。

## Phase 1: 面板框架 + 操作按钮

**Goal:** 创建 WebView 控制面板框架，集成所有现有命令的一键操作按钮。

**Requirements:** CTRL-01 ~ CTRL-10

**Success Criteria:**
1. 运行 `UE Helper: Show Control Panel` 打开面板
2. 面板显示 Build / Rebuild / Clean / Launch Editor / Live Coding 等按钮
3. 点击每个按钮都能正确执行对应命令
4. 面板为单例模式，再次打开命令聚焦已存在的面板
5. 面板关闭后释放所有资源

**Tasks:**
1. 创建 `src/ui/controlPanelMessages.ts` — 消息协议类型定义
2. 创建 `src/ui/controlPanel.html.ts` — HTML/CSS/JS 模板生成（操作按钮 Tab）
3. 创建 `src/ui/controlPanel.ts` — ControlPanel 类（单例管理、消息路由）
4. 创建 `src/commands/showControlPanel.ts` — 打开面板命令
5. 更新 `src/commands/index.ts` — 注册新命令
6. 更新 `package.json` — 添加命令 manifest
7. 更新 `src/i18n/locales/en.json` / `zh.json` — 面板文本
8. 创建 `test/unit/ui/controlPanel.test.ts` — 测试

---

## Phase 2: 配置编辑区 + Proxy 设置

**Goal:** 在面板中添加配置编辑 Tab 和 Proxy 设置 Tab，可视化修改所有配置项。

**Requirements:** CTRL-11 ~ CTRL-21

**Success Criteria:**
1. 面板 Config Tab 中修改 Configuration 后 settings.json 同步更新
2. 面板 Proxy Tab 中切换 Localization 开关后 clangd proxy 状态更新
3. 所有选择器和输入框加载当前配置为默认值
4. 配置修改后面板 UI 即时反映最新状态

**Tasks:**
1. 更新 `src/ui/controlPanel.html.ts` — 添加 Config / Proxy Tab HTML
2. 更新 `src/ui/controlPanel.ts` — 添加 updateConfig / getConfig 消息处理
3. 更新消息协议类型
4. 更新 i18n 文本

---

## Phase 3: 状态展示 + 细节打磨

**Goal:** 添加状态展示 Tab，完善面板体验（i18n、自动刷新、错误处理）。

**Requirements:** CTRL-22 ~ CTRL-28

**Success Criteria:**
1. 面板 Status Tab 正确显示项目/引擎/Proxy 状态
2. 面板打开时自动获取并显示最新状态
3. 切换 VS Code 语言后面板文本跟随切换
4. 插件卸载时面板自动关闭

**Tasks:**
1. 更新 `src/ui/controlPanel.html.ts` — 添加 Status Tab HTML
2. 更新 `src/ui/controlPanel.ts` — 添加 getStatus 消息处理
3. 添加 detection.ready 集成（await 后发送状态）
4. 完善错误处理和边界情况

---

## Phase Details

**Phase 1: 面板框架 + 操作按钮**
Goal: 创建 WebView 控制面板框架，集成所有现有命令的一键操作按钮。
Requirements: CTRL-01 ~ CTRL-10
Success criteria:
1. 运行 `UE Helper: Show Control Panel` 打开面板
2. 面板显示 Build / Rebuild / Clean / Launch Editor / Live Coding 等按钮
3. 点击每个按钮都能正确执行对应命令
4. 面板为单例模式，再次打开命令聚焦已存在的面板
5. 面板关闭后释放所有资源

**Phase 2: 配置编辑区 + Proxy 设置**
Goal: 在面板中添加配置编辑 Tab 和 Proxy 设置 Tab，可视化修改所有配置项。
Requirements: CTRL-11 ~ CTRL-21
Success criteria:
1. 面板 Config Tab 中修改 Configuration 后 settings.json 同步更新
2. 面板 Proxy Tab 中切换 Localization 开关后 clangd proxy 状态更新
3. 所有选择器和输入框加载当前配置为默认值
4. 配置修改后面板 UI 即时反映最新状态

**Phase 3: 状态展示 + 细节打磨**
Goal: 添加状态展示 Tab，完善面板体验（i18n、自动刷新、错误处理）。
Requirements: CTRL-22 ~ CTRL-28
Success criteria:
1. 面板 Status Tab 正确显示项目/引擎/Proxy 状态
2. 面板打开时自动获取并显示最新状态
3. 切换 VS Code 语言后面板文本跟随切换
4. 插件卸载时面板自动关闭
