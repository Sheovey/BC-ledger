/**
 * 弹窗时机闸门：此刻能不能插一个模态框。
 *
 * 原来这段逻辑私有在 update.ts 里，只服务「发现新版本」。现在「备份提醒」
 * 也要在同一时刻做判断——两份实现迟早会分叉（一个把记账页算成可弹、
 * 一个不算），用户在填记账表单时被弹窗打断，丢的是还没保存的整笔。
 * 所以抽出来一份，两个提示共用同一判据。
 *
 * 判据只有两条，都是「下面压着未提交内容」的场景：
 *   1. 有 Sheet / 确认框打开 —— 分类多选、时间设置、账本切换都在这里，
 *      关掉弹层即丢失所选，被强插一个弹窗同样难受；
 *   2. 停在记账页 —— 整页表单都在组件 useState 里，只有点保存才进 store。
 *
 * 其余页面（首页、流水、图表、我的）都是只读展示，随时可以弹。
 */
import Taro from '@tarojs/taro';
import { useUiStore } from '@/store/ui';

/**
 * 整页都是未提交表单的路由。目前只有记账页；
 * 以后新增「编辑资料」这类整页表单，把路由加进来即可。
 */
const FORM_ROUTES = ['pages/record/index'];

export function currentRoute(): string {
  try {
    const pages = Taro.getCurrentPages() as unknown as Array<{ route?: string }>;
    const cur = pages[pages.length - 1];
    return (cur && cur.route) || '';
  } catch {
    return '';
  }
}

export function canPromptNow(): boolean {
  if (useUiStore.getState().sheetDepth > 0) return false;
  const route = currentRoute();
  if (!route) return true;
  return !FORM_ROUTES.some((r) => route.indexOf(r) === 0);
}
