import { getStorageDriver } from './storage';
import type { LedgerData } from '@/types';

/**
 * 云同步接入层 —— 接口已就位，当前不启用。
 *
 * 为什么留这一层而不是直接对接云开发：
 * 本应用目前只服务自己，自动同步的持续成本（云开发套餐 19.9 元/月起，
 * 且免费环境在小程序发布后第 15 天到期）换不来对应收益；
 * 但「以后要能开放给人用」又要求现在别把路堵死。所以先定协议、留空实现。
 *
 * 将来接入只需动三处，不需要改页面和 store：
 * 1. 在本文件新增一个 SyncProvider 实现；
 * 2. 启动时 `setSyncProvider(...)`；
 * 3. 开关打开后 `syncAfterWrite()` 会自动接上（已挂在写入链路里）。
 *
 * 推荐零成本路线：腾讯云 CloudBase 免费档（3000 资源点/月，每 6 个月续期）。
 * 客户端直连数据库即可，不必写云函数 —— 权限选「仅创建者可读写」时
 * _openid 由服务端注入，天然按用户隔离，所以连登录页都不需要。
 * 注意：openid 绑定微信号，用户换微信号后数据不再与旧账号关联。
 */

export interface SyncSnapshot {
  /** 快照生成时间（毫秒），合并时用它判断哪边更新 */
  updatedAt: number;
  /** 整份数据的 JSON 文本。本地分片是为绕开单 key 上限，云端存整份即可 */
  payload: string;
}

export interface PullResult {
  /** 云端没有数据（首次同步） */
  empty: boolean;
  snapshot: SyncSnapshot | null;
}

export interface SyncProvider {
  readonly id: string;
  readonly label: string;
  /** 环境是否就绪：未开通云环境、未配置 envId 时应返回 false */
  isAvailable(): boolean;
  pull(): Promise<PullResult>;
  push(snapshot: SyncSnapshot): Promise<void>;
}

/** 默认实现：什么也不做。所有同步调用在未启用时都落到这里 */
const localOnly: SyncProvider = {
  id: 'local',
  label: '仅本机',
  isAvailable: () => true,
  pull: async () => ({ empty: true, snapshot: null }),
  push: async () => {
    /* 未接入云端，刻意留空 */
  },
};

let current: SyncProvider = localOnly;

export function getSyncProvider(): SyncProvider {
  return current;
}

export function setSyncProvider(provider: SyncProvider): void {
  current = provider;
}

/**
 * 同步开关属于「设备级配置」，刻意不放进 LedgerData：
 * 它跟着账号与设备走，导出给别人没有意义，也不该被恢复操作覆盖。
 */
const ENABLED_KEY = 'ledger-app.sync.enabled';

export function isSyncEnabled(): boolean {
  try {
    return getStorageDriver().getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSyncEnabled(enabled: boolean): void {
  try {
    const driver = getStorageDriver();
    if (enabled) driver.setItem(ENABLED_KEY, '1');
    else driver.removeItem(ENABLED_KEY);
  } catch {
    /* 开关记不住不影响本地使用 */
  }
}

let pushTimer: number | undefined;

/**
 * 写入成功后的推送入口，已挂在 persist 链路上。
 * 未启用同步时第一行就返回，开销只有一次 storage 读。
 */
export function syncAfterWrite(data: LedgerData): void {
  if (!isSyncEnabled()) return;
  const provider = current;
  if (provider.id === 'local' || !provider.isAvailable()) return;

  // 记账是低频操作，3 秒防抖足以把连续几次点击合并成一次上传
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    const snapshot: SyncSnapshot = { updatedAt: Date.now(), payload: JSON.stringify(data) };
    // 推送失败不影响本地已落盘的数据，下次写入会再试
    provider.push(snapshot).catch(() => {});
  }, 3000);
}

/** 供界面展示同步状态，避免页面直接读 provider 细节 */
export function describeSyncState(): { enabled: boolean; label: string } {
  return {
    enabled: isSyncEnabled() && current.id !== 'local',
    label: current.id === 'local' ? '仅保存在本机' : current.label,
  };
}
