/** 金额工具：内部一律用「分」（整数），仅在输入/展示层做换算。 */

/** 把用户输入（元）解析为分。非法输入返回 null。 */
export function parseAmountToFen(input: string): number | null {
  const raw = input.trim().replace(/,/g, '');
  if (!raw) return null;
  // 允许 12、12.3、12.34、.5、12. 等形式，拒绝多个小数点与其它字符
  if (!/^\d*\.?\d*$/.test(raw)) return null;
  if (raw === '.' || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** 分 → 元字符串，固定两位小数，不带千分位 */
export function fenToYuanString(fen: number): string {
  const sign = fen < 0 ? '-' : '';
  const abs = Math.abs(Math.round(fen));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 分 → 元（数值）。导出表格时用它写数值单元格，保证 Excel 里能直接求和 */
export function fenToYuan(fen: number): number {
  return Math.round(fen) / 100;
}

/** 分 → 展示金额，带千分位，默认两位小数 */
export function formatMoney(
  fen: number,
  options: { withSymbol?: boolean; symbol?: string; digits?: number; signed?: boolean } = {},
): string {
  const { withSymbol = false, symbol = '¥', digits = 2, signed = false } = options;
  const sign = fen < 0 ? '-' : signed && fen > 0 ? '+' : '';
  const abs = Math.abs(Math.round(fen)) / 100;
  const text = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${sign}${withSymbol ? symbol : ''}${text}`;
}

/** 紧凑展示：1.2万 / 3.4亿，用于概览卡片 */
export function formatCompactMoney(fen: number, symbol = '¥'): string {
  const yuan = Math.abs(fen) / 100;
  const sign = fen < 0 ? '-' : '';
  if (yuan >= 100_000_000) return `${sign}${symbol}${(yuan / 100_000_000).toFixed(2)}亿`;
  if (yuan >= 10_000) return `${sign}${symbol}${(yuan / 10_000).toFixed(2)}万`;
  return `${sign}${symbol}${yuan.toFixed(2)}`;
}

/** 百分比展示，分母为 0 时返回 0% */
export function percentOf(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

export function formatPercent(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

/** 安全整数求和 */
export function sumFen(values: number[]): number {
  return values.reduce((acc, cur) => acc + Math.round(cur || 0), 0);
}
