import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePiSession, buildDailyFromSessions, type PiSession } from '../../server/piParser.js';

// 复刻真实 pi JSONL 结构：本地模型（amax 代理的 qwen-3.8-27B）流式响应不带
// usage，assistant 消息 usage 全 0；云端模型则带真实 usage。
const lines = [
  { type: 'session', id: 'sess-1', timestamp: '2026-09-15T10:00:00.000Z', cwd: 'D:\\file\\demo' },
  { type: 'model_change', timestamp: '2026-09-15T10:00:01.000Z', provider: 'amax', modelId: 'qwen-3.8-27B' },
  // 用户消息（中文，约 2000 字 → 上下文累积）
  {
    type: 'message',
    timestamp: '2026-09-15T10:00:02.000Z',
    message: { role: 'user', content: '请帮我重构这个模块'.repeat(200) },
  },
  // 零 usage + 有内容 → 应估算
  {
    type: 'message',
    timestamp: '2026-09-15T10:00:10.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: '好的，我先看一下代码。' },
        { type: 'toolCall', name: 'read', arguments: { path: 'src/index.ts' } },
      ],
      model: 'qwen-3.8-27B',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
    },
  },
  {
    type: 'message',
    timestamp: '2026-09-15T10:00:12.000Z',
    message: { role: 'toolResult', content: [{ type: 'text', text: 'console.log("hi");' }] },
  },
  // 零 usage + 有内容（含 thinking）→ 应估算，input 应大于上一条
  {
    type: 'message',
    timestamp: '2026-09-15T10:00:20.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '这个函数需要拆分。'.repeat(50) },
        { type: 'text', text: '已完成重构。' },
      ],
      model: 'qwen-3.8-27B',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
    },
  },
  // 压缩：上下文回落到底线 + summary
  { type: 'compaction', timestamp: '2026-09-15T10:00:30.000Z', summary: '重构了 index.ts' },
  {
    type: 'message',
    timestamp: '2026-09-15T10:00:31.000Z',
    message: { role: 'user', content: '继续' },
  },
  {
    type: 'message',
    timestamp: '2026-09-15T10:00:40.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '好的，继续推进。' }],
      model: 'qwen-3.8-27B',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
    },
  },
  // 零 usage + 空内容（aborted）→ 不记录
  {
    type: 'message',
    timestamp: '2026-09-15T10:00:50.000Z',
    message: {
      role: 'assistant',
      content: [],
      model: 'qwen-3.8-27B',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
      stopReason: 'aborted',
    },
  },
  // 真实 usage（切换云端模型）→ 按上报值统计
  { type: 'model_change', timestamp: '2026-09-15T10:01:00.000Z', provider: 'amax', modelId: 'deepseek-flash' },
  {
    type: 'message',
    timestamp: '2026-09-15T10:01:10.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      model: 'deepseek-flash',
      usage: { input: 5000, output: 100, cacheRead: 200, cacheWrite: 0, totalTokens: 5100, cost: { total: 0.01 } },
    },
  },
  // 真实 usage 后回到零 usage 模型 → input 应锚定到 5100 + 上一条回放
  { type: 'model_change', timestamp: '2026-09-15T10:02:00.000Z', provider: 'amax', modelId: 'qwen-3.8-27B' },
  {
    type: 'message',
    timestamp: '2026-09-15T10:02:10.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '收尾。' }],
      model: 'qwen-3.8-27B',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
    },
  },
];

function writeFixture(tmp: string): string {
  const filepath = join(tmp, 'session.jsonl');
  writeFileSync(filepath, lines.map(line => JSON.stringify(line)).join('\n'));
  return filepath;
}

function parseFixture(): PiSession {
  const tmp = mkdtempSync(join(tmpdir(), 'tokendash-pi-estimate-'));
  try {
    const session = parsePiSession(writeFixture(tmp));
    expect(session).not.toBeNull();
    return session!;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe('parsePiSession 零 usage 内容估算', () => {
  it('只记录有实际输出的零 usage 消息，并标记为估算', () => {
    const session = parseFixture();
    const events = session.tokenEvents;
    // 4 条估算 + 1 条真实（空内容 aborted 被跳过）
    expect(events).toHaveLength(5);
    expect(events[0].estimated).toBe(true);
    expect(events[0].model).toBe('qwen-3.8-27B');
    expect(events[0].inputTokens).toBeGreaterThan(0);
    expect(events[0].outputTokens).toBeGreaterThan(0);
    expect(events[0].totalTokens).toBe(events[0].inputTokens + events[0].outputTokens);
    // 上下文累积：第二条估算的 input 大于第一条
    expect(events[1].inputTokens).toBeGreaterThan(events[0].inputTokens);
  });

  it('compaction 后上下文回落，input 小于压缩前累积值', () => {
    const events = parseFixture().tokenEvents;
    expect(events[2].inputTokens).toBeLessThan(events[1].inputTokens);
    // 回落到底线 + 短 summary 附近
    expect(events[2].inputTokens).toBeGreaterThan(4000);
    expect(events[2].inputTokens).toBeLessThan(4500);
  });

  it('真实 usage 按上报值统计，并作为后续估算的锚点', () => {
    const events = parseFixture().tokenEvents;
    const real = events[3];
    expect(real.estimated).toBe(false);
    expect(real.model).toBe('deepseek-flash');
    expect(real.inputTokens).toBe(5000);
    expect(real.outputTokens).toBe(100);
    expect(real.totalTokens).toBe(5100);
    expect(real.cacheReadTokens).toBe(200);

    const after = events[4];
    expect(after.estimated).toBe(true);
    // 锚定：真实 input 5000 + 上报 output 100
    expect(after.inputTokens).toBe(5100);
  });
});

describe('buildDailyFromSessions 估算标记聚合', () => {
  it('daily 条目与 totals 都携带 estimatedTokens，模型明细区分真实/估算', () => {
    const response = buildDailyFromSessions([parseFixture()], 'Asia/Shanghai');
    expect(response.daily).toHaveLength(1);
    const day = response.daily[0];

    const estimatedSum = day.modelBreakdowns
      .filter(b => b.modelName === 'qwen-3.8-27B')
      .reduce((s, b) => s + b.estimatedTokens, 0);
    const qwen = day.modelBreakdowns.find(b => b.modelName === 'qwen-3.8-27B')!;
    const flash = day.modelBreakdowns.find(b => b.modelName === 'deepseek-flash')!;

    expect(estimatedSum).toBe(qwen.estimatedTokens);
    expect(estimatedSum).toBeGreaterThan(0); // 明细按模型拆分后只有 qwen 有估算
    expect(qwen.estimatedTokens).toBeGreaterThan(0);
    expect(flash.estimatedTokens).toBe(0);
    expect(day.estimatedTokens).toBe(qwen.estimatedTokens);
    expect(day.totalTokens).toBe(day.modelBreakdowns.reduce((s, b) => s + b.inputTokens + b.outputTokens, 0));
    expect(response.totals.estimatedTokens).toBe(day.estimatedTokens);
    expect(response.totals.totalTokens).toBe(day.totalTokens);
    expect(response.totals.totalTokens).toBeGreaterThan(response.totals.estimatedTokens);
  });
});
