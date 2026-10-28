import { useState } from 'react';

export interface ProgressiveList {
  /** 当前应展示的条数，已按 total 夹取 */
  count: number;
  hasMore: boolean;
  loadMore: () => void;
  reset: () => void;
}

interface State {
  key: string;
  count: number;
}

/**
 * 渐进式列表：只负责「展示多少条」，切片交给调用方。
 *
 * 两个设计点值得说明：
 *
 * 1. resetKey 变化时重置回 step —— 用「渲染期派生重置」而不是 useEffect。
 *    useEffect 在绘制之后才跑，筛选/搜索变化会先渲染一帧「新数据 + 旧条数」，
 *    列表高度闪一下再缩；搜索时每敲一个字闪一次。渲染期 setState 是 React
 *    官方 "adjusting state when a prop changes" 范式，会丢弃本次输出立即重渲染，
 *    首帧就是对的。首次渲染天然不重置（初值已等于 resetKey），不需要 isFirst。
 *
 * 2. 不做 loading 态。本地切片是同步的，任何 spinner 都是伪造的，只会让人
 *    以为数据在远端。将来改成真分页（从 storage 分片读）时再加，签名不变。
 */
export function useProgressiveList(total: number, step = 30, resetKey = ''): ProgressiveList {
  const [state, setState] = useState<State>({ key: resetKey, count: step });

  if (state.key !== resetKey) {
    setState({ key: resetKey, count: step });
  }

  // 即使 setState 还没生效，本次渲染也要按新 key 算，不能露出旧条数
  const raw = state.key === resetKey ? state.count : step;
  // 夹取兜底：删除或筛选后总数变少，不需要额外一次 setState。
  // 总数回升时不自动回退，保留用户已经展开的深度。
  const count = Math.min(raw, total);

  const loadMore = () => {
    setState((prev) => {
      const base = prev.key === resetKey ? prev.count : step;
      if (base >= total) return prev;
      return { key: resetKey, count: base + step };
    });
  };

  const reset = () => setState({ key: resetKey, count: step });

  return { count, hasMore: count < total, loadMore, reset };
}
