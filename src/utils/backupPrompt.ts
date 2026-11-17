/**
 * 备份提醒的调度。
 *
 * 要解决的问题：数据只在本机，用户不会自己想起来导出备份。
 * 1.1.7 之前只有「进设置页看到一行提示」，可用户可能一个月不进设置页。
 * 这里把它升级成主动弹窗，把「要自己想起来」降级成「弹出来点一下」。
 *
 * 三个约束，都是踩过或想过才写下来的：
 *
 * 1. **拒绝之后必须冷却。** 点「稍后」如果不清零、不记录，下一笔流水保存后
 *    条件依然满足，就会每笔都弹，用户很快会卸载。这里记 lastPromptAt，7 天内不再弹。
 * 2. **只在能弹的时机弹。** 判据与「发现新版本」共用 promptGate，记账页与
 *    有弹层时一律推迟——记账表单全在组件 useState 里，被打断等于整笔白填。
 * 3. **升级后跳过冷却，多问一次。** 版本更新本身不会清 storage（官方口径：
 *    本地缓存只在代码包被清理时才清），但新版本的迁移逻辑（DATA_VERSION）
 *    是唯一会改写存量数据的时刻，也是唯一可能因 bug 吃掉数据的时刻。
 *    所以升级后第一次启动，即使还在冷却期也要重新判一次。
 */
import { getAccountInfoSync } from '@tarojs/taro';
import { APP_VERSION } from '@/config/version';
import {
  exportedAt,
  exportedTxCount,
  markPromptShown,
  markSeenVersion,
  promptAt,
  seenVersion,
} from '@/db/persist';
import { useStore } from '@/store/useStore';
import { useUiStore, type BackupPromptInfo } from '@/store/ui';
import { hasOnboarded } from '@/utils/onboard';
import { canPromptNow } from '@/utils/promptGate';

const DAY = 86_400_000;

/** 距上次导出超过这么多天，且期间有新增流水 → 提醒 */
export const BACKUP_REMIND_DAYS = 14;
/** 距上次导出新增这么多笔 → 提醒（数据攒得快时不必等满 14 天） */
export const BACKUP_REMIND_TX = 50;
/** 弹过一次之后，这么多天内不再弹 */
export const BACKUP_COOLDOWN_DAYS = 7;
/** 从未导出过时，至少要攒这么多笔才值得打扰一次 */
export const BACKUP_MIN_TX = 10;

export type PromptReason = 'due' | 'no-data' | 'fresh' | 'not-enough' | 'cooldown';

export interface PromptDecision extends BackupPromptInfo {
  due: boolean;
  /** 不该弹的具体原因，供验收与排查；不弹时界面不显示任何东西 */
  reason: PromptReason;
}

/**
 * 本次启动是否为「升级后第一次」。
 * 缓存起来是因为 evaluateBackupPrompt 可能被调用多次，而 markSeenVersion
 * 只该在第一次判定时写——否则第二次读到的就是新版本号，升级判定永远为 false。
 */
let upgradeFlag: boolean | null = null;

function isUpgradeSession(txCount: number): boolean {
  if (upgradeFlag !== null) return upgradeFlag;
  const seen = seenVersion();
  const current = APP_VERSION;
  if (seen === current) {
    upgradeFlag = false;
  } else if (seen === null) {
    // 从未记录过版本号：可能是全新安装，也可能是老用户第一次用上本功能。
    // 用「有没有数据」区分——有数据说明是后者，按升级处理，该提醒就提醒。
    upgradeFlag = txCount > 0;
  } else {
    upgradeFlag = true;
  }
  markSeenVersion(current);
  return upgradeFlag;
}

/** 纯判定，不改界面。验收脚本可直接调它核对 due / reason */
export function evaluateBackupPrompt(): PromptDecision {
  const txCount = useStore.getState().data.txs.length;
  const upgrade = isUpgradeSession(txCount);

  const lastExport = exportedAt();
  const newTx = Math.max(0, txCount - exportedTxCount());
  const days = lastExport ? Math.floor((Date.now() - lastExport) / DAY) : null;
  const info: BackupPromptInfo = { days, newTx, upgrade };
  const idle = (reason: PromptReason): PromptDecision => ({ due: false, reason, ...info });

  if (txCount === 0) return { due: false, reason: 'no-data', ...info };

  // 刚装就催「你该备份了」只会制造焦虑：还没有值得丢的东西
  if (!lastExport && txCount < BACKUP_MIN_TX) return idle('fresh');

  const overTime = (days === null || days >= BACKUP_REMIND_DAYS) && newTx > 0;
  const overVolume = newTx >= BACKUP_REMIND_TX;
  if (!overTime && !overVolume) return idle('not-enough');

  // 升级场景跳过冷却，理由见文件头第 3 条
  if (!upgrade) {
    const last = promptAt();
    if (last && Date.now() - last < BACKUP_COOLDOWN_DAYS * DAY) return idle('cooldown');
  }

  return { due: true, reason: 'due', ...info };
}

function isDevelop(): boolean {
  try {
    return getAccountInfoSync().miniProgram.envVersion === 'develop';
  } catch {
    // 取不到版本信息时按真机处理：宁可多弹一次，也不能让线上永远不提醒
    return false;
  }
}

/**
 * 由 tab 页的 useDidShow 调用：该弹就弹，不该弹就什么都不做。
 *
 * 开发者工具里默认不弹，否则会挡住所有验收脚本的点击。
 * 验收通过 __ledgerBackup.forcePrompt() 直接驱动界面。
 */
export function requestBackupPrompt(): PromptDecision | null {
  if (isDevelop()) return null;
  if (!canPromptNow()) return null;
  // 首次引导还没读完就先别弹：两个全屏层叠在一起，用户会以为界面点不动。
  // 引导读完（sheetDepth 归零）后，下一次进 tab 页自然会补上。
  if (!hasOnboarded()) return null;
  // 已经有一个在显示，别叠
  if (useUiStore.getState().backupPrompt) return null;

  const decision = evaluateBackupPrompt();
  if (!decision.due) return null;

  // 展示即打扰：先记冷却，再交给界面渲染。顺序反了会出现
  // 「弹窗已显示但冷却没写」，下次进页面又弹一遍。
  markPromptShown();
  useUiStore.getState().setBackupPrompt({
    days: decision.days,
    newTx: decision.newTx,
    upgrade: decision.upgrade,
  });
  return decision;
}

/** 用户点了「稍后」：只关界面，冷却时间已在展示时记过 */
export function dismissBackupPrompt(): void {
  useUiStore.getState().setBackupPrompt(null);
}

/**
 * 弹层处理完后要接的动作。
 * 目前唯一的使用者是升级流程：备份完（或用户跳过）之后要接着弹「重启」。
 * 没有这个回调的话，备份弹层关掉就停了，用户以为更新也取消了。
 */
let afterPrompt: (() => void) | null = null;
let afterPromptRuns = 0;

export function setAfterPrompt(fn: (() => void) | null): void {
  afterPrompt = fn;
}

/** 由弹层在「导出完成」与「用户跳过」两条路径上调用 */
export function runAfterPrompt(): void {
  const fn = afterPrompt;
  afterPrompt = null;
  if (!fn) return;
  afterPromptRuns += 1;
  fn();
}

/** 验收用：回调到底有没有被接上（重启流程不能断） */
export function __afterPromptRuns(): number {
  return afterPromptRuns;
}

/**
 * 验收用：只判「升级前会不会拦截」，不产生任何界面副作用。
 * 与 requestPreUpgradeBackup 共用同一判据，避免验收测的和实际跑的不是一套逻辑。
 */
export function willBlockBeforeUpgrade(): boolean {
  const txCount = useStore.getState().data.txs.length;
  const newTx = Math.max(0, txCount - exportedTxCount());
  return txCount > 0 && newTx > 0;
}

/**
 * 升级前拦截：新包已下载、尚未应用时调用。
 *
 * 判据刻意比常规提醒宽——不看 14 天、不看 50 笔、不看冷却期，
 * **只要存在未备份的新增流水就提醒**。
 * 理由是 onUpdateReady 触发时旧代码与 storage 都还在，
 * 这是唯一能赶在版本切换之前提醒的窗口；错过之后，
 * 「删除小程序重装」那条路径根本没有任何代码会运行，无从拦截。
 *
 * 返回 true 表示弹层已占用这次时机，调用方不要再去弹重启提示。
 */
export function requestPreUpgradeBackup(onDone: () => void): boolean {
  // 判据与 willBlockBeforeUpgrade 同一份，验收测的就是实际跑的那条
  if (!willBlockBeforeUpgrade()) return false;
  // 已有弹层在显示，别覆盖：让那个先处理完，重启由它的回调接上
  if (useUiStore.getState().backupPrompt) return false;

  const txCount = useStore.getState().data.txs.length;
  const newTx = Math.max(0, txCount - exportedTxCount());
  const lastExport = exportedAt();
  setAfterPrompt(onDone);
  useUiStore.getState().setBackupPrompt({
    days: lastExport ? Math.floor((Date.now() - lastExport) / DAY) : null,
    newTx,
    upgrade: false,
    preUpgrade: true,
  });
  return true;
}

/**
 * 验收专用：绕过 develop 跳过与全部判定，直接把弹层推出来。
 * release 下不挂到全局（见 app.tsx），不影响线上行为。
 */
export function forceBackupPrompt(info?: Partial<BackupPromptInfo>): void {
  useUiStore.getState().setBackupPrompt({
    days: info?.days ?? null,
    newTx: info?.newTx ?? 0,
    upgrade: info?.upgrade ?? false,
  });
}

/** 验收专用：清掉「本次启动是否升级」的缓存，让下一次判定重新比对版本号 */
export function resetUpgradeCache(): void {
  upgradeFlag = null;
}
