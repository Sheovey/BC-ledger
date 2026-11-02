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
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'home',
  setActiveTab: (key) => set((prev) => (prev.activeTab === key ? prev : { activeTab: key })),
}));
