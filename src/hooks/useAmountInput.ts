import { useCallback, useMemo, useState } from 'react';
import { fenToYuanString, parseAmountToFen } from '@/utils/money';

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
    const left = fenToYuanString(accumulator);
    const current = parseAmountToFen(text);
    // 还没敲第二个数时只写「12.50 +」；敲了就把整个算式写全并补等号，
    // 等号是给用户看的信号：大号那串数字是结果，不是正在输入的操作数
    if (current === null) return `${left} ${operator}`;
    return `${left} ${operator} ${fenToYuanString(current)} =`;
  }, [accumulator, operator, text]);

  /**
   * 有运算符挂起时，大号数字显示「当前合计」，而不是刚敲的这个操作数。
   * 多笔累加（12.5 + 3.2）原来把第一个数藏在下方小字里、把第二个数放大，
   * 用户看不到总数；改成大号位放合计、小字位放完整算式。
   */
  const totalFen = useMemo(() => {
    if (accumulator === null || !operator) return null;
    const current = parseAmountToFen(text || '0') ?? 0;
    return operator === '+' ? accumulator + current : accumulator - current;
  }, [accumulator, operator, text]);

  const display = useMemo(
    () => (totalFen === null ? text || '0.00' : fenToYuanString(totalFen)),
    [totalFen, text],
  );

  /** 只有「既没输入、也没有算式」才算灰色占位；合计是真实数值，不能变灰 */
  const placeholder = totalFen === null && text === '';

  return {
    text,
    display,
    placeholder,
    valueFen,
    press,
    resolveFen,
    reset,
    setValue,
    expression,
  };
}
