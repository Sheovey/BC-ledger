/**
 * 首次引导的状态存取与弹出判定。
 *
 * 单独成文件是因为三个地方都要读它：
 * 1. `components/FirstRunGuide.tsx` 决定要不要显示；
 * 2. `utils/backupPrompt.ts` 在引导未读完时不弹备份提醒
 *    （两个全屏层叠在一起，用户会以为界面点不动）；
 * 3. 验收脚本要能重置标记。
 *
 * key 写在一处，避免两边各写一个字符串然后悄悄漂移。
 */
import { getAccountInfoSync } from '@tarojs/taro';
import { getStorageDriver } from '@/db/storage';

const ONBOARDED_KEY = 'ledger-app.onboarded';

/**
 * develop 环境下的自动弹出开关。
 *
 * 起因是一次真事故：开发者工具里十几个验收脚本共用一个 storage，
 * IDE 重启后标记会丢，引导一弹就把后续所有点击挡在遮罩外面——
 * 表现是 `canPromptNow()` 因 `sheetDepth > 0` 返回 false，
 * 「首页可以弹更新提示」那条断言直接变红，与更新逻辑毫无关系。
 *
 * 所以 develop 下默认不自动弹，只有验收显式 reset 过才弹。
 * 真实环境（体验版/正式版）不受影响，仍然「没读过就弹」。
 */
let testForce = false;

function isDevelop(): boolean {
  try {
    return getAccountInfoSync().miniProgram.envVersion === 'develop';
  } catch {
    // 取不到版本信息时按真实环境处理：宁可弹一次，也不能让线上永不出现
    return false;
  }
}

export function hasOnboarded(): boolean {
  try {
    return getStorageDriver().getItem(ONBOARDED_KEY) === '1';
  } catch {
    // 读不到就当已看过：宁可少弹一次，也别在存储异常时每次启动都挡路
    return true;
  }
}

/** 启动时是否自动展示引导 */
export function shouldAutoShow(): boolean {
  if (hasOnboarded()) return false;
  if (!isDevelop()) return true;
  return testForce;
}

export function markOnboarded(): void {
  try {
    getStorageDriver().setItem(ONBOARDED_KEY, '1');
  } catch {
    /* 记不住就下次再弹，不影响记账 */
  }
}

/** 验收专用：清标记，并允许本次会话自动弹出（真实环境不需要这个开关） */
export function resetOnboarded(): void {
  testForce = true;
  try {
    getStorageDriver().removeItem(ONBOARDED_KEY);
  } catch {
    /* 忽略 */
  }
}
