import { create } from 'zustand';

/**
 * 界面态的极小 store，只放「跨页面共享、又不属于账本数据」的东西。
 *
 * 为什么需要它：自定义 tabBar 在**每个 tab 页各有一个独立实例**（官方机制），
 * 实例之间不共享状态。哪个 tab 该高亮，只能靠一条公共信源告诉它。
 * 账本数据（useStore）不合适承载这个信息——它一变就触发全量重算，
 * 而 tabBar 只关心「当前在哪一页」，因此单开一个 store，
 * 让 custom-tab-bar 只订阅这一个字段，账本数据变化不会连带它重渲染。
 *
 * 写入方是各个 tab 页的 useDidShow：switchTab 每次显示页面都会触发 onShow，
 * 缓存复用时也一样，所以高亮永远跟得上。
 */

export type TabKey = 'home' | 'ledger' | 'stats' | 'settings';

interface UiState {
  activeTab: TabKey;
  setActiveTab: (key: TabKey) => void;
  /**
   * 当前已打开的底部弹层数量。
   *
   * 存在的唯一原因：custom-tab-bar 由框架渲染在页面之上，**页面内的 z-index 管不到它**
   * （实测 `.overlay` 的 z-index:100 依然被 `.tabbar` 的 30 盖住，因为两者不在同一层叠上下文）。
   * 结果是「切换账本」这类弹层被导航栏压住，账本行看不见也点不到。
   * 弹层打开期间把 tabBar 隐藏，是唯一可靠让位的办法。
   *
   * 用计数而不是布尔：Sheet 可以嵌套（弹层里再开确认框），
   * 布尔会在内层关闭时过早恢复，把外层的弹层又露出来。
   */
  sheetDepth: number;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'home',
  setActiveTab: (key) => set((prev) => (prev.activeTab === key ? prev : { activeTab: key })),
  sheetDepth: 0,
  openSheet: () => set((prev) => ({ sheetDepth: prev.sheetDepth + 1 })),
  closeSheet: () => set((prev) => ({ sheetDepth: Math.max(0, prev.sheetDepth - 1) })),
}));

