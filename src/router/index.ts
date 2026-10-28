import Taro from '@tarojs/taro';
import type { Route } from '@/types';

/**
 * 路由适配层。
 *
 * Web 版是自建路由栈（useStore.route + navigate/resetTo），
 * 小程序有原生页面栈，只能映射过去。Route 类型保持不变，
 * 页面里仍然是 navigate({ name: 'books' })，由这里翻译成 url。
 */

const PAGES: Record<Route['name'], string> = {
  home: '/pages/home/index',
  books: '/pages/books/index',
  book: '/pages/book/index',
  record: '/pages/record/index',
  ledger: '/pages/ledger/index',
  stats: '/pages/stats/index',
  accounts: '/pages/accounts/index',
  budget: '/pages/budget/index',
  projects: '/pages/projects/index',
  templates: '/pages/templates/index',
  categories: '/pages/categories/index',
  settings: '/pages/settings/index',
};

/**
 * 已迁移完成的页面。未在清单内的目标只提示、不跳转，
 * 避免 navigateTo 因页面不存在而抛错导致白屏。
 */
const READY = new Set<Route['name']>([
  'home',
  'record',
  'ledger',
  'settings',
  'stats',
  'accounts',
  'categories',
  'books',
  'budget',
  'projects',
  'templates',
]);

export function routeToUrl(route: Route): string {
  const base = PAGES[route.name] ?? PAGES.home;
  const query: string[] = [];
  const raw = route as Record<string, unknown>;

  if (typeof raw.bookId === 'string' && raw.bookId) {
    query.push(`bookId=${encodeURIComponent(raw.bookId)}`);
  }
  if (typeof raw.txId === 'string' && raw.txId) {
    query.push(`txId=${encodeURIComponent(raw.txId)}`);
  }
  if (typeof raw.presetType === 'string' && raw.presetType) {
    query.push(`presetType=${encodeURIComponent(raw.presetType)}`);
  }

  return query.length ? `${base}?${query.join('&')}` : base;
}

function guard(route: Route): boolean {
  if (READY.has(route.name)) return true;
  Taro.showToast({ title: '该页面尚未迁移', icon: 'none', duration: 1500 });
  return false;
}

/**
 * 导航失败要出声。
 * Taro.navigateTo 返回 Promise，不接 catch 时失败是静默的——
 * 表现为「点了没反应」，排查时完全看不到线索（实测踩过一次）。
 */
function reportFail(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error ?? '');
  // eslint-disable-next-line no-console
  console.warn(`[router] ${action} 失败:`, message);
  Taro.showToast({ title: '页面跳转失败，请重试', icon: 'none', duration: 1500 });
}

/** 前进（对应 Web 版 navigate） */
export function navigate(route: Route): void {
  if (!guard(route)) return;
  Taro.navigateTo({ url: routeToUrl(route) }).catch((error) => reportFail('navigateTo', error));
}

/** 重置到某个页面（对应 Web 版 resetTo） */
export function resetTo(route: Route): void {
  if (!guard(route)) return;
  Taro.reLaunch({ url: routeToUrl(route) }).catch((error) => reportFail('reLaunch', error));
}

/**
 * 替换当前页（用于底部 Tab 切换）。
 * Web 版 tab 之间是同一页面内的视图切换，小程序没有这层视图容器，
 * 用 redirectTo 而不是 reLaunch：只换当前这一页，页面栈不重建，切换更快。
 */
export function replaceTo(route: Route): void {
  if (!guard(route)) return;
  Taro.redirectTo({ url: routeToUrl(route) }).catch((error) => reportFail('redirectTo', error));
}

/**
 * 返回（对应 Web 版 back）。
 *
 * 两处兜底，都是被实测坑出来的：
 * - getCurrentPages 在某些时机（页面刚 reLaunch、或上一个页面已被回收）会返回 1 项，
 *   此时 navigateBack 必然失败。所以栈深为 1 时直接 reLaunch 到 fallback。
 * - navigateBack 本身也可能 reject（例如从分享卡片直达、栈被系统清过），
 *   必须 catch 后补一次 reLaunch，否则用户看到的是「点了没反应」。
 */
export function back(fallback: Route = { name: 'home' }): void {
  let depth = 1;
  try {
    depth = Taro.getCurrentPages()?.length ?? 1;
  } catch {
    depth = 1;
  }

  if (depth > 1) {
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.reLaunch({ url: routeToUrl(fallback) }).catch((error) => reportFail('reLaunch', error));
    });
  } else {
    Taro.reLaunch({ url: routeToUrl(fallback) }).catch((error) => reportFail('reLaunch', error));
  }
}

/** 读取页面参数 */
export function useQuery(): Record<string, string> {
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') out[k] = decodeURIComponent(v);
  }
  return out;
}

export { PAGES as PAGE_PATHS };
