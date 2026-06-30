/**
 * showControlPanel —— 聚焦侧边栏控制面板
 *
 * 调用 ControlPanelProvider.show() 通过 workbench.view.extension.ueHelper
 * 命令聚焦侧边栏的 UE Helper 控制面板视图。
 *
 * 注：Provider 本身在 extension.ts 激活时注册，
 * 这里只需要聚焦侧边栏即可。
 */

import { ControlPanelProvider } from '@ui/controlPanel';

export function executeShowControlPanel(): void {
  ControlPanelProvider.show();
}
