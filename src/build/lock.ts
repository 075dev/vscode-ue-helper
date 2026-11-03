/**
 * buildLock —— UBT 构建互斥锁
 *
 * ## 为什么需要
 *
 * UBT 同一时间只能跑一个。`build`（全量 / rebuild / clean）与 `liveCoding`
 * 都是 spawn UBT 进程，两个并发时 UHT 代码生成阶段会交叉写
 * `Intermediate/Build/` 下的 `.generated.h`，表现为随机出现的
 * "unknown type name 'FID_...'" 假诊断 —— 用户很难联想到是插件干的。
 *
 * 旧实现只在 `src/commands/build.ts` 有模块级 `buildInFlight` 标记，
 * `liveCoding` 路径完全没有守卫 —— 两条路径可以同时跑。
 *
 * ## 使用约定
 *
 * 1. 真正要 spawn UBT **之前**才加锁（解析项目/引擎阶段不加，避免长时间占锁）；
 * 2. 拿到锁的调用方必须在 `finally` 里 `unlockBuild()`；
 * 3. 已经是"持锁方"再调用同一条路径（如 build 的"编辑器运行中转发 Live Coding"）
 *    走 `alreadyLocked` 参数，不要重复加锁。
 */

/** 当前是否有构建在跑（build / rebuild / clean / liveCoding 任意一种） */
let locked = false;

/**
 * 是否有构建正在运行。
 *
 * 用于命令层做"快速拒绝"判断 —— 返回 true 时调用方应直接返回
 * `EC_OPERATION_CANCELLED`（对应 `cmd.buildInFlight` 文案）。
 */
export function isBuildLocked(): boolean {
  return locked;
}

/**
 * 尝试获取构建锁。
 *
 * @returns true = 获取成功（调用方必须在 finally 里 `unlockBuild()`）；
 *          false = 已有构建在跑，调用方应拒绝本次请求。
 */
export function tryLockBuild(): boolean {
  if (locked) {
    return false;
  }
  locked = true;
  return true;
}

/**
 * 释放构建锁。
 *
 * 幂等 —— 重复调用是安全的（不会误释放别人的锁，因为锁是单一全局状态，
 * 且调用方在 finally 中成对获取/释放）。
 */
export function unlockBuild(): void {
  locked = false;
}
