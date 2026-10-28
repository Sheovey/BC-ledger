/** 轻量 id 生成：时间戳前缀 + 随机后缀，保证本地唯一且天然按创建顺序排序 */
export function uid(prefix = 'id'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}${rand}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
