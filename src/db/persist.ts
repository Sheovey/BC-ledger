import type { Category, LedgerData, Tx } from '@/types';
import { DATA_VERSION, createInitialData, createPresetCategories } from './seed';
import { classifyStorageError, getStorageDriver, type StorageError } from './storage';

/**
 * 持久化层
 *
 * 多账号约定：数据按 userId 分区存储，同一宿主换账号不会串数据。
 * - 已登录：`ledger-app.v1.u:<userId>.*`
 * - 未登录（登录页之前的历史数据）：`ledger-app.v1.*`
 * 首次登录时会把未登录数据复制一份到账号分区，避免老用户数据"消失"。
 *
 * 分片约定（2026-10-27 重构）：
 * 原先整份 LedgerData 写进单个 key，在微信小程序里会撞上「单 key 1MB」硬上限
 * （官方 wx.setStorage 文档：单个 key 最大 1MB，总量 10MB）。
 * 现在拆成两块：
 * - `<前缀>meta`：账本/分类/账户/项目/模板/预算/设置 + 分片计数，通常几十 KB；
 * - `<前缀>tx.<i>`：流水按 TX_CHUNK_SIZE 条一片，每条约 250-320 字节，一片约 90KB。
 * 写入顺序是先分片后 meta，meta 里的 txChunks 始终指向已落盘的分片，
 * 中途失败也只是回退到上一份完整数据，不会出现「meta 说有 5 片、实际只有 2 片」。
 */

const BASE = 'ledger-app.v1';
const BACKUP_BASE = 'ledger-app.backup.v1';
const LAST_USER_KEY = 'ledger-app.lastUser';

/** 每片流水条数。单条约 250-320 字节，300 条约 90KB，留足余量给 1MB 上限 */
const TX_CHUNK_SIZE = 300;

type PersistMeta = Omit<LedgerData, 'txs'> & {
  txCount: number;
  txChunks: number;
};

let scope: string | null = readLastUser();

/** 分片写缓存：key 为分片序号，value 为上次写入的 JSON，用于跳过未变化的分片 */
let chunkCache: { scope: string | null; entries: Map<number, string> } = {
  scope: null,
  entries: new Map(),
};

/** 分区前缀。匿名分区带结尾点，从而不会误匹配 `ledger-app.v1.u:xxx.*` */
function partitionPrefix(target: string | null = scope): string {
  return target ? `${BASE}.u:${target}.` : `${BASE}.`;
}

function metaKey(target: string | null = scope): string {
  return `${partitionPrefix(target)}meta`;
}

function chunkKey(index: number, target: string | null = scope): string {
  return `${partitionPrefix(target)}tx.${index}`;
}

/** 旧版整份存储的 key，仅用于迁移读取 */
function legacyKey(target: string | null = scope): string {
  return target ? `${BASE}.u:${target}` : BASE;
}

/** 当前分区下的所有 key 前缀，供外部监听存储变更使用 */
export function dataKeyPrefix(target: string | null = scope): string {
  return partitionPrefix(target);
}

function readLastUser(): string | null {
  try {
    return getStorageDriver().getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

export function getScope(): string | null {
  return scope;
}

export function setScope(userId: string | null): void {
  scope = userId;
  chunkCache = { scope: null, entries: new Map() };
  try {
    const driver = getStorageDriver();
    if (userId) driver.setItem(LAST_USER_KEY, userId);
    else driver.removeItem(LAST_USER_KEY);
  } catch {
    /* 忽略 */
  }
}

export function backupKey(target: string | null = scope): string {
  return target ? `${BACKUP_BASE}.u:${target}` : BACKUP_BASE;
}

/** 备份写入时间与最近导出的时间，供界面提示「上次备份于」 */
function backupAtKey(target: string | null = scope): string {
  return `${backupKey(target)}.at`;
}

function exportAtKey(target: string | null = scope): string {
  return `${backupKey(target)}.export`;
}

/**
 * 清空分片写缓存。
 * 场景：另一个标签页/另一个上下文已经改写了同一分区，本页的分片缓存随之失效；
 * 若不清空，本页可能因"缓存内容与待写内容相同"而跳过写入，造成内存与磁盘不一致。
 */
export function invalidateWriteCache(): void {
  chunkCache.entries.clear();
}

/** 结构校验：只做必要字段体检，避免半损数据把应用打挂 */
function isValidData(value: unknown): value is LedgerData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<LedgerData>;
  return (
    Array.isArray(v.books) &&
    Array.isArray(v.categories) &&
    Array.isArray(v.accounts) &&
    Array.isArray(v.txs) &&
    !!v.settings &&
    typeof v.settings === 'object'
  );
}

function isValidMeta(value: unknown): value is PersistMeta {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PersistMeta>;
  return (
    Array.isArray(v.books) &&
    Array.isArray(v.categories) &&
    Array.isArray(v.accounts) &&
    Array.isArray(v.projects) &&
    Array.isArray(v.templates) &&
    Array.isArray(v.budgets) &&
    !!v.settings &&
    typeof v.settings === 'object' &&
    typeof v.txChunks === 'number'
  );
}

/**
 * 预设分类的历史对照表（v1 → v2）。
 *
 * 背景：v1 的预设有两个分类带金融语义（「金融保险」「理财收入」及其子项），
 * 个人主体小程序审核时属于需要资质的表述，v2 把它们换成了生活服务/补贴口径。
 * 但预设分类是**落到用户数据里的**——老安装升级后看到的仍是旧名字，
 * 只改 seed.ts 对已经存过数据的人无效。
 *
 * 迁移策略（保守）：
 * - 只按「id + 当前名字仍等于旧预设名」两个条件同时命中才改名，
 *   用户自己改过的名字一律不动；
 * - 旧版没有的新子项按 id 追加，已存在则跳过；
 * - 全程不删任何分类，历史流水的 categoryId 不会断。
 */
type PresetRename = {
  id: string;
  oldName: string;
  newName: string;
  /** 该一级分类新增的子项（id 必须沿用 `<rootId>_<序号>` 规则） */
  extraChildren: Array<{ id: string; name: string; sort: number }>;
};

const LEGACY_PRESET_RENAMES: PresetRename[] = [
  {
    id: 'cat_finance',
    oldName: '金融保险',
    newName: '生活服务',
    extraChildren: [{ id: 'cat_finance_5', name: '手续费', sort: 4 }],
  },
  {
    id: 'cat_invest',
    oldName: '理财收入',
    newName: '补贴收入',
    extraChildren: [{ id: 'cat_invest_4', name: '其他补贴', sort: 3 }],
  },
];

/** 旧子项 id → 新名字。索引与旧预设一一对应，id 不变，含义随之更新 */
const LEGACY_CHILD_RENAMES: Record<string, Array<[string, string]>> = {
  cat_finance: [
    ['保险', '快递'],
    ['手续费', '理发'],
    ['利息', '洗衣'],
    ['投资亏损', '家政'],
  ],
  cat_invest: [
    ['利息', '交通补贴'],
    ['分红', '餐补'],
    ['基金收益', '住房补贴'],
  ],
};

function applyPresetRenames(categories: Category[]): Category[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const patch = new Map<string, string>();
  const additions: Category[] = [];

  for (const preset of LEGACY_PRESET_RENAMES) {
    const root = byId.get(preset.id);
    if (!root || root.name !== preset.oldName) continue;
    patch.set(root.id, preset.newName);

    const childMap = LEGACY_CHILD_RENAMES[preset.id] ?? [];
    childMap.forEach(([oldName, newName], index) => {
      const childId = `${preset.id}_${index + 1}`;
      const child = byId.get(childId);
      if (child && child.name === oldName) patch.set(childId, newName);
    });

    for (const extra of preset.extraChildren) {
      if (byId.has(extra.id)) continue;
      additions.push({
        id: extra.id,
        bookId: null,
        parentId: preset.id,
        name: extra.name,
        type: root.type,
        icon: root.icon,
        color: root.color,
        sort: extra.sort,
        archived: false,
      });
    }
  }

  if (!patch.size && !additions.length) return categories;
  return [...categories.map((c) => (patch.has(c.id) ? { ...c, name: patch.get(c.id) as string } : c)), ...additions];
}

/** 版本迁移：新增字段在此补齐，保证老数据平滑升级 */
function migrate(data: LedgerData): LedgerData {
  const defaultSettings = {
    currency: '¥',
    monthStartDay: 1,
    lastBookId: null as string | null,
    recentCategoryIds: [] as string[],
    theme: 'light' as const,
    showArchived: false,
  };
  const next: LedgerData = {
    ...data,
    version: DATA_VERSION,
    projects: data.projects ?? [],
    templates: data.templates ?? [],
    budgets: data.budgets ?? [],
    settings: { ...defaultSettings, ...data.settings },
  };
  // 预设分类改名（v1 → v2），只动名字仍是旧预设名的项
  next.categories = applyPresetRenames(next.categories);
  // 兜底：预设分类缺失时补回（防止用户误删后分类体系塌陷导致无法记账）
  if (!next.categories.some((c) => c.parentId === null)) {
    next.categories = createPresetCategories();
  }
  return next;
}

function readChunks(count: number, target: string | null): Tx[] {
  const driver = getStorageDriver();
  const out: Tx[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = driver.getItem(chunkKey(i, target));
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...(parsed as Tx[]));
    } catch {
      /* 单个分片损坏时跳过，保住其余流水 */
    }
  }
  return out;
}

/** 读取指定分区；不存在或结构损坏时返回 null */
function readPartition(target: string | null): LedgerData | null {
  const driver = getStorageDriver();
  const raw = driver.getItem(metaKey(target));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    driver.setItem(`${metaKey(target)}.broken.${Date.now()}`, raw);
    return null;
  }
  if (!isValidMeta(parsed)) {
    driver.setItem(`${metaKey(target)}.broken.${Date.now()}`, raw);
    return null;
  }
  const meta = parsed;
  const txs = readChunks(meta.txChunks, target);
  return {
    version: meta.version,
    books: meta.books,
    categories: meta.categories,
    accounts: meta.accounts,
    projects: meta.projects,
    templates: meta.templates,
    budgets: meta.budgets,
    txs,
    settings: meta.settings,
  };
}

/** 读取旧版整份 JSON（迁移用），成功后由调用方删除旧 key */
function readLegacy(target: string | null): LedgerData | null {
  const driver = getStorageDriver();
  const raw = driver.getItem(legacyKey(target));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidData(parsed)) {
      driver.setItem(`${legacyKey(target)}.broken.${Date.now()}`, raw);
      return null;
    }
    return migrate(parsed);
  } catch {
    return null;
  }
}

/** 写入指定分区：先分片，后 meta */
function writePartition(data: LedgerData, target: string | null): SaveResult {
  const driver = getStorageDriver();
  if (chunkCache.scope !== target) {
    chunkCache = { scope: target, entries: new Map() };
  }
  const cache = chunkCache.entries;

  const chunks: Tx[][] = [];
  for (let i = 0; i < data.txs.length; i += TX_CHUNK_SIZE) {
    chunks.push(data.txs.slice(i, i + TX_CHUNK_SIZE));
  }

  const meta: PersistMeta = {
    version: data.version,
    books: data.books,
    categories: data.categories,
    accounts: data.accounts,
    projects: data.projects,
    templates: data.templates,
    budgets: data.budgets,
    settings: data.settings,
    txCount: data.txs.length,
    txChunks: chunks.length,
  };

  try {
    for (let i = 0; i < chunks.length; i += 1) {
      const payload = JSON.stringify(chunks[i]);
      if (cache.get(i) !== payload) {
        driver.setItem(chunkKey(i, target), payload);
        cache.set(i, payload);
      }
    }
    driver.setItem(metaKey(target), JSON.stringify(meta));
    // 分片数减少时清理磁盘上的尾部残留。
    // 必须枚举实际 key 而不是只看写缓存：应用重启后缓存为空，
    // 若只遍历缓存，历史分片会永久滞留在存储里（10MB 上限下是实质隐患）。
    const txPrefix = `${partitionPrefix(target)}tx.`;
    for (const key of driver.keys(txPrefix)) {
      const index = Number(key.slice(txPrefix.length));
      if (!Number.isInteger(index) || index >= chunks.length) {
        driver.removeItem(key);
        cache.delete(index);
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: classifyStorageError(error) };
  }
}

export function hasLocalData(target: string | null = scope): boolean {
  try {
    const driver = getStorageDriver();
    return Boolean(driver.getItem(metaKey(target)) ?? driver.getItem(legacyKey(target)));
  } catch {
    return false;
  }
}

export function loadData(): LedgerData {
  const existing = readPartition(scope);
  if (existing) {
    // 老数据也要过一遍迁移：预设分类改名、新增字段补齐。
    // 迁移有实际改动时立刻回写，避免「界面上是新的、磁盘上还是旧的」这类幽灵状态。
    const migrated = migrate(existing);
    if (migrated.version !== existing.version || migrated.categories !== existing.categories) {
      writePartition(migrated, scope);
    }
    return migrated;
  }

  // 新分片格式不存在时，尝试迁移旧版整份数据
  const legacy = readLegacy(scope);
  if (legacy) {
    const result = writePartition(legacy, scope);
    if (result.ok) {
      try {
        getStorageDriver().removeItem(legacyKey(scope));
      } catch {
        /* 旧 key 删除失败不影响使用，下次仍会读到 meta 优先 */
      }
    }
    return legacy;
  }

  return createInitialData();
}

/** 首次登录：把未登录时期的数据接管到账号分区（只在账号分区为空时执行一次） */
export function adoptAnonymousData(userId: string): LedgerData | null {
  if (hasLocalData(userId)) return readPartition(userId);
  const anonymous = readPartition(null) ?? readLegacy(null);
  if (!anonymous) return null;
  const result = writePartition(anonymous, userId);
  return result.ok ? anonymous : null;
}

export type SaveResult = { ok: true } | { ok: false; reason: StorageError };

export function saveData(data: LedgerData): SaveResult {
  return writePartition(data, scope);
}

/**
 * 快照备份：保存「上一次落盘成功」的完整数据，作为误操作与半损数据的回滚点。
 *
 * 两个必须守住的约束：
 * 1. 存的必须是**旧版本**。早期实现是在保存成功之后把新数据也写进备份，
 *    结果备份永远等于当前数据，回滚点形同虚设 —— 调用方必须在写盘前取旧值。
 * 2. 单 key 上限 1MB 是平台硬约束。整份 JSON 逼近上限时宁可不备份，
 *    也不能让一次备份把主数据的写入带宽挤掉。
 *
 * 只保留一份而不是多份轮转：分片存储下做多份等于把占用放大 4 倍，
 * 三年流水就会顶到 10MB 总配额；而用户真正需要的是灾难恢复，
 * 撤销单步属于交互层面的事，不该用全量快照来扛。
 */
const BACKUP_MAX_CHARS = 900_000;

export function rotateBackup(previousRaw: string): void {
  if (!previousRaw || previousRaw.length > BACKUP_MAX_CHARS) return;
  try {
    const driver = getStorageDriver();
    driver.setItem(backupKey(), previousRaw);
    driver.setItem(backupAtKey(), String(Date.now()));
  } catch {
    /* 备份失败不阻塞主流程 */
  }
}

export function readBackup(): string | null {
  try {
    return getStorageDriver().getItem(backupKey());
  } catch {
    return null;
  }
}

/** 备份生成时间（毫秒），没有备份时返回 null */
export function backupAt(): number | null {
  try {
    const value = getStorageDriver().getItem(backupAtKey());
    if (!value) return null;
    const stamp = Number(value);
    return Number.isFinite(stamp) && stamp > 0 ? stamp : null;
  } catch {
    return null;
  }
}

/** 校验并解出备份数据；备份损坏或结构不对时返回 null，不抛异常 */
export function restoreBackup(): LedgerData | null {
  const raw = readBackup();
  if (!raw) return null;
  try {
    // 备份是整份 LedgerData，与分片格式不同：这里不能走 readPartition
    const parsed = JSON.parse(raw) as unknown;
    return isValidData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 记录最近一次「导出到文件」的时间。
 * 与备份是两回事：备份在手机里，导出后的文件在手机外，
 * 前者挡不住清缓存，后者才挡得住，所以两者分开计时。
 */
export function markExported(): void {
  try {
    getStorageDriver().setItem(exportAtKey(), String(Date.now()));
  } catch {
    /* 忽略 */
  }
}

export function exportedAt(): number | null {
  try {
    const value = getStorageDriver().getItem(exportAtKey());
    if (!value) return null;
    const stamp = Number(value);
    return Number.isFinite(stamp) && stamp > 0 ? stamp : null;
  } catch {
    return null;
  }
}

/** 兼容旧调用方：返回当前分区的 meta key */
export function dataKey(target: string | null = scope): string {
  return metaKey(target);
}
