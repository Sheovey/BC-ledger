/**
 * 存储驱动：数据层与宿主环境的唯一接触面
 *
 * 存在理由：
 * 微信小程序没有 localStorage，本地缓存通过 wx.getStorageSync 访问，
 * 且单 key 上限 1MB、单个小程序总量 10MB（官方文档口径）。
 * 把读写收敛到这一层之后，上层持久化逻辑两端共用一套，只换驱动即可。
 *
 * 使用约定：
 * - 值一律以字符串（JSON）进出，驱动不参与序列化。
 * - 当前默认走 Web 驱动；小程序端启动时调用 setStorageDriver(createWxDriver()) 覆盖。
 */

export type StorageError = 'quota' | 'unknown';

export interface StorageDriver {
  readonly name: string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** 列出以 prefix 开头的所有 key，用于分片清理与旧数据迁移 */
  keys(prefix: string): string[];
}

/** 把底层异常归类成上层能处理的两类：容量不足 / 其他 */
export function classifyStorageError(error: unknown): StorageError {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return 'quota';
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/quota|exceed|storage\s*(size|limit)|full/i.test(message)) return 'quota';
  return 'unknown';
}

function createWebDriver(): StorageDriver {
  return {
    name: 'web',
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      localStorage.setItem(key, value);
    },
    removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* 忽略：删除失败不应打断主流程 */
      }
    },
    keys(prefix) {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix)) out.push(key);
        }
      } catch {
        /* 忽略 */
      }
      return out;
    },
  };
}

/** 只声明真正用到的四个能力，避免为了类型去引整个小程序类型包 */
interface WxStorageLike {
  getStorageSync: (key: string) => unknown;
  setStorageSync: (key: string, data: string) => void;
  removeStorageSync: (key: string) => void;
  getStorageInfoSync: () => { keys: string[] };
}

function getWx(): WxStorageLike | null {
  const scope = globalThis as { wx?: WxStorageLike };
  const wx = scope.wx;
  if (wx && typeof wx.getStorageSync === 'function' && typeof wx.setStorageSync === 'function') {
    return wx;
  }
  return null;
}

/**
 * 小程序驱动
 *
 * 注意两个与 Web 不同的点：
 * 1. getStorageSync 在 key 不存在时返回空字符串而非 null，需归一化；
 * 2. setStorageSync 超限会直接抛异常，没有独立的错误类型，只能靠消息文本归类。
 */
export function createWxDriver(): StorageDriver {
  const wx = getWx();
  if (!wx) throw new Error('createWxDriver 只能在微信小程序环境中调用');
  return {
    name: 'wx',
    getItem(key) {
      try {
        const value = wx.getStorageSync(key);
        if (typeof value === 'string') return value === '' ? null : value;
        return value == null ? null : JSON.stringify(value);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      wx.setStorageSync(key, value);
    },
    removeItem(key) {
      try {
        wx.removeStorageSync(key);
      } catch {
        /* 忽略 */
      }
    },
    keys(prefix) {
      try {
        return wx.getStorageInfoSync().keys.filter((key) => key.startsWith(prefix));
      } catch {
        return [];
      }
    },
  };
}

function detectDriver(): StorageDriver {
  if (getWx()) return createWxDriver();
  if (typeof localStorage !== 'undefined') return createWebDriver();
  throw new Error('当前宿主既没有 wx.storage 也没有 localStorage，无法持久化');
}

let current: StorageDriver = detectDriver();

export function getStorageDriver(): StorageDriver {
  return current;
}

/** 仅用于小程序端启动时替换驱动，或在测试中注入内存驱动 */
export function setStorageDriver(driver: StorageDriver): void {
  current = driver;
}

export { createWebDriver };
