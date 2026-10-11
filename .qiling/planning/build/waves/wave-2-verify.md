# Wave 2 验证记录

## 第一轮派发(2026-09-20 ~01:20):全部 NOT_RUN(基础设施限流)
- 5 worker 并行派发(hermes/copilot gpt-4.1,--yolo)→ 全部 HTTP 429(Copilot utility models 速率限制),零提交退出。
- 处置:各 worktree 已 reset 清净(半成品脏改动丢弃);降并发为 2 + 错峰启动 + 小步原子提交后重试。
- 台账状态:5 任务 NOT_RUN(reason:外部 API 限流),待第二轮派发补跑。

## 第二轮派发(01:52-02:12):仍全部 NOT_RUN(同一限流未恢复)
- 2 并发(降速)+ 错峰 + 小步提交策略;两 worker 均在 ~20 分钟 API 重试后死于同一 429(utility models 配额长窗口耗尽,零提交)。
- gpt-4o 探针挂起无输出;gpt-4o-mini 被 hermes 64k 上下文下限拦截;claude 系 400 不支持;minimax 月度配额耗尽。
- 处置:冷却 25 分钟 → 单请求探针确认配额恢复 → 第三轮**串行**(1 并发)补跑;若第三轮仍全灭,按"连续失败即停"上报 partial。
