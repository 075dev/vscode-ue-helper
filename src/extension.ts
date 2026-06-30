/**
 * VSCodeUEHelper —— 插件入口文件
 *
 * 本文件是整个插件的主入口,负责:
 *   1. 按固定顺序初始化所有子系统
 *   2. 首次激活时显示欢迎信息
 *   3. 卸载时清理资源
 *
 * 激活时机:
 *   - 工作区里包含 **.uproject 文件(最常见)
 *   - 用户手动执行任意 vscodeUEHelper.* 命令
 *
 * 模块激活顺序(非常重要):
 *   1. initI18n()       必须最先调用,在 Logger 之前
 *   2. Logger / Config  基础设施,所有模块都依赖
 *   3. activateDetection  项目/引擎发现。返回 DetectionHandles,包含 ready Promise
 *   4. activateBuild     UBT Task Provider
 *   5. activateClangd    clangd 状态栏 + 工作区备份
 *   6. activateUI        11 个状态栏按钮,await detection.ready 后渲染
 *   7. activateCommands  注册 15 个命令到 VS Code
 *
 * 关键设计: Promise 而非回调。
 * detection.ready 是一个 Promise,UI 层在 await 之后才渲染状态栏。
 * 这样避免"检测还没完成,状态栏先显示空"的竞态。
 *
 * 完整架构详见 doc/ 目录下的文档。
 */

import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { activateDetection } from '@detection';
import { activateBuild } from '@build';
import { activateClangd } from '@clangd';
import { activateUI } from '@ui';
import { activateCommands } from '@commands';
import { showProjectInfo } from '@commands/showProjectInfo';
import { initI18n, t } from '@i18n';
import { ControlPanelProvider } from '@ui/controlPanel';

// 模块级变量 —— 由 activate() 初始化,deactivate() 清理
let logger: Logger;
// 全局 disposable 列表 —— 当前各模块自己用 context.subscriptions 管理,
// 这个数组主要是备用
const disposables: vscode.Disposable[] = [];

/**
 * VS Code 激活插件时调用此函数。
 *
 * @param context VS Code 提供的扩展上下文(用于订阅事件、读写 globalState 等)
 *
 * 异常处理:
 *   - 任何模块激活失败都会 catch 在这里
 *   - 失败时 logger.error + showErrorMessage(弹窗给用户看)
 *   - 不让插件处于半激活状态 —— 失败后其他命令都不能用
 */
export function activate(context: vscode.ExtensionContext): Promise<void> {
  // 第一步: 初始化国际化。必须在 Logger 之前 —— Logger 的输出也可能要翻译
  // initI18n() 会读 vscode.env.language,自动选 zh 或 en locale
  initI18n();

  // 创建 Logger 实例,名字 'VSCodeUEHelper' 会作为 Output 通道的标题
  logger = new Logger('VSCodeUEHelper');

  // 读 vscode.workspace.getConfiguration('vscodeUEHelper'),所有字段强类型包装
  const config = new Config();

  // 计时 —— 方便看启动耗时
  const activationStart = Date.now();
  logger.info('Activating VSCodeUEHelper...');

  try {
    // === 按依赖顺序激活各个子系统 ===

    // 检测: 项目 + 引擎发现。返回 DetectionHandles,包含一个 ready Promise
    const detection = activateDetection(context, config, logger);

    // 构建: 注册 UBT Task Provider(Ctrl+Shift+B)。可选依赖 detection
    const build = activateBuild(context, config, logger, detection);

    // clangd: 启动状态栏 + 工作区备份。依赖 detection
    const clangd = activateClangd(context, config, logger, detection);

    // UI: 创建 11 个状态栏按钮。await detection.ready 后才渲染
    const ui = activateUI(context, config, logger, detection);

    // 命令: 注册 15 个命令到 VS Code
    activateCommands(context, config, logger, detection, clangd);

    // 侧边栏: 注册 ControlPanel WebviewViewProvider
    ControlPanelProvider.register({ context, config, logger, detection, clangd });

    // 报告启动耗时
    const elapsed = Date.now() - activationStart;
    logger.info(`VSCodeUEHelper activated in ${elapsed}ms`);

    // void 关键字: 告诉 TS 我故意没用到这个变量
    // build 和 ui 已被 activate 函数副作用处理(注册了状态栏/任务),不需要再操作
    void build;
    void ui;

    // === 首次激活欢迎信息 ===
    // 用 globalState 标记是否已显示过,避免每次激活都弹
    const hasShownWelcome = context.globalState.get<boolean>('vscodeUEHelper.welcomed');
    if (!hasShownWelcome) {
      // t('ui.welcome.real') 自动根据 locale 返回中文或英文
      void vscode.window.showInformationMessage(t('ui.welcome.real'), 'Open').then((choice) => {
        // 用户点了 Open 才执行 showProjectInfo —— 显示项目状态到 Output 面板
        if (choice === 'Open') {
          void showProjectInfo(config, logger, detection);
        }
      });
      // 标记已显示,写入 globalState(跨会话保留)
      void context.globalState.update('vscodeUEHelper.welcomed', true);
    }
  } catch (err) {
    // 任何激活步骤失败都走到这里
    logger.error('Activation failed:', err);
    void vscode.window.showErrorMessage(
      `VSCodeUEHelper failed to activate: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return Promise.resolve();
}

/**
 * VS Code 卸载插件时调用此函数。
 *
 * 清理工作:
 *   - 释放所有 disposable 资源(状态栏按钮、文件系统 watcher 等)
 *   - Logger 可能为 undefined(如果 activate 失败就走到 deactivate),所以用可选链
 */
export function deactivate(): void {
  // 注意: logger 是模块级变量,可能从未被赋值(极端情况: 插件加载就崩溃)
  logger?.info('Deactivating VSCodeUEHelper...');

  // 清理所有 disposables
  // 用 while + pop 而不是 forEach,是因为 dispose 过程中可能修改数组
  while (disposables.length) {
    const d = disposables.pop();
    try {
      d?.dispose();
    } catch (err) {
      // 个别 disposable 抛错不能影响其他清理
      logger?.warn('Disposable threw on dispose:', err);
    }
  }
}
