import { afterEach, describe, expect, it } from 'vitest';
import { getPricing, modelCost, normalizePricingModel, setPricingExchangeRate } from '../src/shared/modelPricing.js';

afterEach(() => setPricingExchangeRate(6));

describe('模型计费规则', () => {
  it('按模型名称匹配，忽略供应商并使用 Go 单价', () => {
    expect(normalizePricingModel('provider/GLM-5.2')).toBe('glm-5.2');
    expect(modelCost('provider/GLM-5.2', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(6.06);
    expect(modelCost('other/glm-5.2', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(6.06);
  });

  it('将缓存写入与缓存读取分开计价', () => {
    expect(modelCost('qwen3.8-max', 1_000_000, 0, 1_000_000, 1_000_000)).toBeCloseTo(4.75);
  });

  it('保留未知价格，不套用其他模型', () => {
    expect(getPricing('unknown')).toBeUndefined();
    expect(modelCost('glm-5.2', 0, 0, 0, 1)).toBeUndefined();
  });

  it('按每次请求的上下文长度选择价格', () => {
    expect(getPricing('gpt-6-luna', 272_000)?.input).toBe(0.1);
    expect(getPricing('gpt-6-luna', 272_001)?.input).toBe(0.2);
  });

  it('按 UTC 时间区分 DeepSeek 高峰与非高峰价格', () => {
    expect(modelCost('deepseek-v4.1-flash', 1_000_000, 0, 0, 0, '2026-10-16T02:00:00Z')).toBeCloseTo(0.3);
    expect(modelCost('deepseek-v4.1-flash', 1_000_000, 0, 0, 0, '2026-10-17T02:00:00Z')).toBeCloseTo(0.15);
  });

  it('按设置汇率换算 AMAX 人民币价格，人民币价值保持不变', () => {
    setPricingExchangeRate(6);
    const first = modelCost('amax/gpt-6.1-sol', 1000, 100, 500)!;
    setPricingExchangeRate(6.68);
    const second = modelCost('other/gpt-6.1-sol', 1000, 100, 500)!;
    expect(first * 6).toBeCloseTo(second * 6.68, 10);
    expect(second).toBeLessThan(first);
    expect(getPricing('glm-5.2')?.input).toBe(1.4);
  });

  it('拒绝非正数和无限汇率', () => {
    expect(() => setPricingExchangeRate(0)).toThrow();
    expect(() => setPricingExchangeRate(Infinity)).toThrow();
  });
});
