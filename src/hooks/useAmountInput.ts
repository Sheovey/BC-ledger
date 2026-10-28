import { useCallback, useMemo, useState } from 'react';
import { parseAmountToFen } from '@/utils/money';

export type KeypadKey =
  | { kind: 'digit'; value: string }
  | { kind: 'dot' }
  | { kind: 'back' }
  | { kind: 'op'; value: '+' | '-' }
  | { kind: 'clear' };

interface Options {
  /** 初始金额（元字符串），编辑流水时传入 */
  initial?: string;
}

/**
 * 金额输入状态机（与 Web 版 hooks/useAmountInput.ts 逐行一致）。
 * 纯状态、无 DOM 依赖，因此两端可共用同一份实现。
 */
export function useAmountInput({ initial = '' }: Options = {}) {
  const [text, setText] = useState(initial);
  const [accumulator, setAccumulator] = useState<number | null>(null);
  const [operator, setOperator] = useState<'+' | '-' | null>(null);

  const valueFen = useMemo(() => parseAmountToFen(text) ?? 0, [text]);

  const press = useCallback(
    (key: KeypadKey) => {
      if (key.kind === 'digit') {
        setText((prev) => {
          if (prev.includes('.')) {
            const [, fraction = ''] = prev.split('.');
            if (fraction.length >= 2) return prev;
            return `${prev}${key.value}`;
          }
          if (prev === '0') return key.value;
          if (prev.replace('.', '').length >= 8) return prev;
          return `${prev}${key.value}`;
        });
        return;
      }
      if (key.kind === 'dot') {
        setText((prev) => {
          if (prev.includes('.')) return prev;
          return prev === '' ? '0.' : `${prev}.`;
        });
        return;
      }
      if (key.kind === 'back') {
        setText((prev) => (prev.length <= 1 ? '' : prev.slice(0, -1)));
        return;
      }
      if (key.kind === 'clear') {
        setText('');
        setAccumulator(null);
        setOperator(null);
        return;
      }
      // 加减暂存：与主流记账 App 一致，支持多段连续运算
      if (key.kind === 'op') {
        const current = parseAmountToFen(text || '0') ?? 0;
        setAccumulator((prevAcc) => {
          if (prevAcc === null || !operator) return current;
          return operator === '+' ? prevAcc + current : prevAcc - current;
        });
        setOperator(key.value);
        setText('');
      }
    },
    [text, operator],
  );

  /** 结算表达式，返回分；非负钳制在 UI 层处理 */
  const resolveFen = useCallback(() => {
    const current = parseAmountToFen(text || '0') ?? 0;
    if (accumulator === null || !operator) return current;
    return operator === '+' ? accumulator + current : accumulator - current;
  }, [accumulator, operator, text]);

  const reset = useCallback(() => {
    setText('');
    setAccumulator(null);
    setOperator(null);
  }, []);

  /** 供模板填充等外部场景直接写入金额 */
  const setValue = useCallback((value: string) => {
    setText(value);
    setAccumulator(null);
    setOperator(null);
  }, []);

  const expression = useMemo(() => {
    if (accumulator === null || !operator) return '';
    return `${(accumulator / 100).toFixed(2)} ${operator}`;
  }, [accumulator, operator]);

  return {
    text,
    display: text || '0.00',
    valueFen,
    press,
    resolveFen,
    reset,
    setValue,
    expression,
  };
}
