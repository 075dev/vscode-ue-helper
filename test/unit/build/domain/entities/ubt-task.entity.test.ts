/**
 * UbtTask 聚合根单元测试
 */

import { describe, it, expect } from 'vitest';
import { UbtTask } from '@build/domain/entities/ubt-task.entity';
import { UbtTaskId } from '@build/domain/value-objects/ubt-task-id.vo';
import { BuildConfiguration } from '@build/domain/value-objects/build-configuration.vo';
import { BuildTarget } from '@build/domain/value-objects/build-target.vo';
import { BuildPlatform } from '@build/domain/value-objects/build-platform.vo';

describe('UbtTask Aggregate', () => {
  function makeTask() {
    return UbtTask.create({
      id: UbtTaskId.fromString('test-task-1'),
      projectPath: 'D:/Project/MyProject.uproject',
      projectName: 'MyProject',
      configuration: BuildConfiguration.development(),
      target: BuildTarget.editor(),
      platform: BuildPlatform.win64(),
      ubtPath: 'D:/UE_5.5/Engine/Build/BatchFiles/Build.bat',
      mode: 'build',
    });
  }

  describe('创建', () => {
    it('should create with pending status', () => {
      const task = makeTask();
      expect(task.isPending).toBe(true);
      expect(task.projectName).toBe('MyProject');
      expect(task.mode).toBe('build');
    });

    it('should emit created event on creation', () => {
      const task = makeTask();
      expect(task.events.length).toBeGreaterThanOrEqual(1);
    });

    it('should generate unique IDs', () => {
      const a = UbtTask.create({
        id: UbtTaskId.create(),
        projectPath: 'P.uproject', projectName: 'P',
        configuration: BuildConfiguration.development(),
        target: BuildTarget.game(),
        platform: BuildPlatform.win64(),
        ubtPath: '/ue/Build.bat',
        mode: 'build',
      });
      const b = UbtTask.create({
        id: UbtTaskId.create(),
        projectPath: 'P.uproject', projectName: 'P',
        configuration: BuildConfiguration.development(),
        target: BuildTarget.game(),
        platform: BuildPlatform.win64(),
        ubtPath: '/ue/Build.bat',
        mode: 'build',
      });
      expect(a.id.equals(b.id)).toBe(false);
    });
  });

  describe('生命周期', () => {
    it('should transition pending → running → succeeded', () => {
      const task = makeTask();
      task.markRunning();
      expect(task.isRunning).toBe(true);

      task.complete({
        exitCode: 0,
        durationMs: 120000,
        output: ['Build succeeded'],
        errorCount: 0,
        warningCount: 0,
      });
      expect(task.isSuccess).toBe(true);
      expect(task.result?.exitCode).toBe(0);
      expect(task.result?.durationMs).toBe(120000);
    });

    it('should transition pending → running → failed on non-zero exit', () => {
      const task = makeTask();
      task.markRunning();
      task.complete({
        exitCode: 1,
        durationMs: 5000,
        output: ['error LNK2001'],
        errorCount: 3,
        warningCount: 5,
      });
      expect(task.isSuccess).toBe(false);
      expect(task.status).toBe('failed');
      expect(task.result?.errorCount).toBe(3);
    });

    it('should reject marking running when already running', () => {
      const task = makeTask();
      task.markRunning();
      expect(() => task.markRunning()).toThrow();
    });

    it('should reject completing when not running', () => {
      const task = makeTask();
      expect(() =>
        task.complete({ exitCode: 0, durationMs: 0, output: [], errorCount: 0, warningCount: 0 }),
      ).toThrow();
    });
  });

  describe('命令行参数', () => {
    it('should build correct UBT args for Editor target', () => {
      const task = makeTask();
      const args = task.buildCommandArgs();
      expect(args[0]).toBe('MyProjectEditor');
      expect(args[1]).toBe('Win64');
      expect(args[2]).toBe('Development');
      expect(args[3]).toBe('-Project=D:/Project/MyProject.uproject');
    });

    it('should build correct UBT args for Game target', () => {
      const task = UbtTask.create({
        id: UbtTaskId.fromString('test-game'),
        projectPath: 'P.uproject', projectName: 'P',
        configuration: BuildConfiguration.shipping(),
        target: BuildTarget.game(),
        platform: BuildPlatform.linux(),
        ubtPath: '/ue/RunUBT.sh',
        mode: 'build',
      });
      const args = task.buildCommandArgs();
      expect(args[0]).toBe('P');
      expect(args[1]).toBe('Linux');
      expect(args[2]).toBe('Shipping');
    });
  });

  describe('相等性', () => {
    it('should be equal when same id', () => {
      const a = makeTask();
      const b = makeTask();
      expect(a.equals(b)).toBe(true);
    });

    it('should not be equal when different id', () => {
      const a = makeTask();
      const b = UbtTask.create({
        id: UbtTaskId.fromString('other-task'),
        projectPath: 'O.uproject', projectName: 'O',
        configuration: BuildConfiguration.development(),
        target: BuildTarget.game(),
        platform: BuildPlatform.win64(),
        ubtPath: '/ue/Build.bat',
        mode: 'build',
      });
      expect(a.equals(b)).toBe(false);
    });
  });
});
