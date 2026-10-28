/**
 * 本机自动存档：把账本导出成 Excel 落到手机文件区。
 *
 * 边界必须说清（否则会产生虚假安全感）：本地用户文件「只有在代码包被清理时
 * 才被清理」（官方《文件系统》清理策略），而微信清理缓存、删除小程序都会清
 * 代码包。所以这里的存档能防的是——手滑点「清空所有数据」、写入 bug、系统
 * 杀进程导致 250ms 防抖未落盘；**防不了清缓存与换手机**。真要带走数据只有
 * `wx.shareFileMessage` 一条路，而它限制「仅在点击行为时调用」，无法自动。
 *
 * 另一个前提：文件区（USER_DATA_PATH）和 wx.setStorageSync 是两套配额，
 * 存档不会挤掉主数据。主数据始终以 storage 为唯一权威源，这里的文件是派生
 * 产物，切换账本**不读文件**。
 *
 * 本模块绝不 import useStore（避免 useStore → persist → archive 的反向边），
 * 数据由 app.tsx 通过 initArchive 注入。
 */
import Taro from '@tarojs/taro';
import type { LedgerData } from '@/types';
import { getBook } from '@/store/selectors';
import { getStorageDriver } from './storage';
import { parseBackupText } from './dataIO';
import { buildBookWorkbook } from './xlsx-book';
import { buildXlsx } from './xlsx';

export type ArchiveReason = 'persist' | 'launch' | 'show' | 'hide' | 'manual';
export type ArchiveKind = 'xlsx' | 'json';

export interface ArchiveEntry {
  name: string;
  path: string;
  kind: ArchiveKind;
  size: number;
  /** 文件修改时间（毫秒） */
  mtime: number;
}

export type ArchiveFailure = 'no-data' | 'locked' | 'too-large' | 'fs-error' | 'skipped' | 'no-api';

export interface ArchiveResult {
  ok: boolean;
  kind?: ArchiveKind;
  name?: string;
  bytes?: number;
  /** 失败原因只用于状态行与日志，绝不弹窗、绝不 toast */
  reason?: ArchiveFailure;
}

export interface ArchiveStatus {
  /** 最近一次成功写入的时间戳（任意类型） */
  lastAt: number | null;
  lastKind: ArchiveKind | null;
  files: number;
  bytes: number;
  lastError: string | null;
}

interface ArchiveApi {
  getData: () => LedgerData;
}

const DIR_NAME = 'archive';
const SNAPSHOT_PREFIX = 'snap-';
const SNAPSHOT_KEEP = 3;
/** 单份 JSON 超过这个长度就不写了：onHide 里赌不起 */
const SNAPSHOT_MAX_CHARS = 2_000_000;
const DEFAULT_BUDGET_BYTES = 8 * 1024 * 1024;
const XLSX_MIN_GAP = 60_000;
const SNAPSHOT_MIN_GAP = 12 * 60 * 60 * 1000;
const IDLE_DELAY = 4000;
const AT_KEY = 'ledger-app.archive.v1.at';
const KIND_KEY = 'ledger-app.archive.v1.kind';
const NAMES_KEY = 'ledger-app.archive.v1.names';
/** 和「导出完整备份」分开记：两者都是把文件送到聊天，但入口不同，混用一个时间会误导 */
const SHARE_KEY = 'ledger-app.archive.v1.share';

let api: ArchiveApi | null = null;
let lock = false;
let budgetBytes = DEFAULT_BUDGET_BYTES;
let idleTimer: number | undefined;
let retryTimer: number | undefined;
let lastXlsxAt = 0;
let lastJsonAt = 0;
let lastJsonSig = '';
let lastError: string | null = null;
const archivedSig = new Map<string, string>();
let listCache: { at: number; entries: ArchiveEntry[] } | null = null;

/* ------------------------------------------------------------------ 基础 */

export function initArchive(next: ArchiveApi): void {
  api = next;
}

function fs() {
  return Taro.getFileSystemManager();
}

export function archiveDirPath(): string {
  return `${Taro.env.USER_DATA_PATH}/${DIR_NAME}`;
}

function entryPath(name: string): string {
  return `${archiveDirPath()}/${name}`;
}

function guard<T>(fn: () => T, fallback: T, label: string): T {
  try {
    return fn();
  } catch (error) {
    lastError = `${label}: ${error instanceof Error ? error.message : String(error)}`;
    return fallback;
  }
}

/** 建目录。已存在会抛错，必须吞掉。 */
function ensureDir(): boolean {
  try {
    fs().mkdirSync(archiveDirPath(), true);
    return true;
  } catch {
    // 已存在或创建失败，用 readdir 确认到底有没有
    try {
      fs().readdirSync(archiveDirPath());
      return true;
    } catch {
      return false;
    }
  }
}

/* ---------------------------------------------------------------- 文件枚举 */

function statOf(path: string): { size: number; mtime: number } {
  try {
    const stat = fs().statSync(path) as unknown as { size?: number; lastModifiedTime?: number; mtime?: number };
    const mtimeRaw = stat.lastModifiedTime ?? stat.mtime ?? 0;
    // 小程序 Stats 的时间字段是秒，个别实现给毫秒，按量级判断
    const mtime = mtimeRaw > 1e12 ? mtimeRaw : mtimeRaw * 1000;
    return { size: stat.size ?? 0, mtime };
  } catch {
    return { size: 0, mtime: 0 };
  }
}

export function listArchives(force = false): ArchiveEntry[] {
  const now = Date.now();
  if (!force && listCache && now - listCache.at < 2000) return listCache.entries;

  const entries = guard<ArchiveEntry[]>(
    () => {
      const names = fs().readdirSync(archiveDirPath()) as string[];
      const out: ArchiveEntry[] = [];
      for (const name of names) {
        if (!name || name.endsWith('.tmp') || name.endsWith('.bak')) continue;
        const path = entryPath(name);
        const { size, mtime } = statOf(path);
        out.push({
          name,
          path,
          kind: name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'json',
          size,
          mtime,
        });
      }
      return out;
    },
    [],
    '列目录',
  );

  entries.sort((a, b) => b.mtime - a.mtime);
  listCache = { at: now, entries };
  return entries;
}

function invalidateList(): void {
  listCache = null;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------------------------------------------------------------- 命名 */

const NAME_BAD = /[\\/:*?"<>|\u0000-\u001f]/g;

function sanitizeName(raw: string): string {
  const cleaned = (raw || '').replace(NAME_BAD, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '账本';
  return cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned;
}

function readNameMap(): Record<string, string> {
  return guard<Record<string, string>>(
    () => {
      const raw = getStorageDriver().getItem(NAMES_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    },
    {},
    '读文件名映射',
  );
}

function writeNameMap(map: Record<string, string>): void {
  guard(() => getStorageDriver().setItem(NAMES_KEY, JSON.stringify(map)), undefined, '写文件名映射');
}

/**
 * 账本 → 文件名。同名账本追加 bookId 末四位避免互相覆盖；账本改名时把旧文件
 * 一起改名，用户不会看到两个名字的同一本书。
 */
function resolveFileName(bookId: string, bookName: string): string {
  const stored = readNameMap();
  const data = api?.getData();
  // 账本删掉后要连文件名记录一起清掉。否则「默认账本.xlsx」会被一个已经不存在的
  // 账本长期占着，新建的同名账本只能被迫叫「默认账本-3f9a.xlsx」。
  const liveIds = new Set((data?.books ?? []).map((book) => book.id));
  const map: Record<string, string> = {};
  for (const [id, name] of Object.entries(stored)) {
    if (liveIds.has(id) || id === bookId) map[id] = name;
  }

  const used = new Set(Object.entries(map).filter(([id]) => id !== bookId).map(([, name]) => name));
  const next = `${sanitizeName(bookName)}.xlsx`;
  const target = used.has(next) ? `${sanitizeName(bookName)}-${bookId.slice(-4)}.xlsx` : next;

  const previous = map[bookId];
  if (previous && previous !== target) {
    // 旧文件改名失败不影响后续覆盖写
    guard(() => fs().renameSync(entryPath(previous), entryPath(target)), undefined, '重命名存档');
    delete map[bookId];
  }
  const pruned = Object.keys(map).length !== Object.keys(stored).length;
  if (map[bookId] !== target || pruned) {
    map[bookId] = target;
    writeNameMap(map);
    invalidateList();
  }
  return target;
}

/* ---------------------------------------------------------------- 写入 */

function signatureOf(data: LedgerData, bookId: string): string {
  let count = 0;
  let maxStamp = '';
  for (const tx of data.txs) {
    if (tx.bookId !== bookId) continue;
    count += 1;
    const stamp = tx.updatedAt || tx.createdAt || '';
    if (stamp > maxStamp) maxStamp = stamp;
  }
  return `${count}:${maxStamp}`;
}

function writeFileAtomic(path: string, buffer: ArrayBuffer): void {
  const tmp = `${path}.tmp`;
  fs().writeFileSync(tmp, buffer);
  // POSIX 上 rename 覆盖是原子的；个别平台不允许覆盖，退一步先删再改名。
  try {
    fs().renameSync(tmp, path);
  } catch {
    guard(() => fs().unlinkSync(path), undefined, '删旧档');
    fs().renameSync(tmp, path);
  }
}

export function writeBookXlsx(bookId?: string): ArchiveResult {
  const data = api?.getData();
  if (!data) return { ok: false, reason: 'no-api' };

  const book = getBook(data, bookId);
  if (!book) return { ok: false, reason: 'no-data' };

  // 空账本不覆盖已有存档：用户点「清空所有数据」后，旧档是唯一的救命稻草
  const txCount = data.txs.reduce((acc, tx) => acc + (tx.bookId === book.id ? 1 : 0), 0);
  if (txCount === 0) return { ok: false, reason: 'no-data' };

  if (!ensureDir()) return { ok: false, reason: 'fs-error' };

  try {
    const workbook = buildBookWorkbook(data, book.id);
    const buffer = buildXlsx(workbook.sheets);
    const name = resolveFileName(book.id, book.name);
    writeFileAtomic(entryPath(name), buffer);
    archivedSig.set(book.id, signatureOf(data, book.id));
    invalidateList();
    markWritten('xlsx');
    return { ok: true, kind: 'xlsx', name, bytes: buffer.byteLength };
  } catch (error) {
    lastError = `写表格: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, reason: 'fs-error' };
  }
}

export function writeSnapshotJson(force = false): ArchiveResult {
  const data = api?.getData();
  if (!data) return { ok: false, reason: 'no-api' };
  if (data.txs.length === 0) return { ok: false, reason: 'no-data' };

  // 数据没变就不写第二份：否则「最近 3 代」会被同一份内容的副本占满，
  // 真正能回滚的时间跨度被挤成几分钟。签名非空才信任它——空串代表本进程
  // 还没成功写过任何一份。
  const sig = allSignature(data);
  if (!force && lastJsonSig && sig === lastJsonSig) return { ok: true, reason: 'skipped' };

  if (!ensureDir()) return { ok: false, reason: 'fs-error' };

  let raw = '';
  try {
    raw = JSON.stringify(data);
  } catch {
    return { ok: false, reason: 'fs-error' };
  }
  if (raw.length > SNAPSHOT_MAX_CHARS) return { ok: false, reason: 'too-large' };

  try {
    const name = `${SNAPSHOT_PREFIX}${stampName()}.json`;
    fs().writeFileSync(entryPath(name), raw, 'utf8');
    pruneSnapshots();
    invalidateList();
    markWritten('json');
    lastJsonAt = Date.now();
    lastJsonSig = sig;
    return { ok: true, kind: 'json', name, bytes: raw.length };
  } catch (error) {
    lastError = `写快照: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, reason: 'fs-error' };
  }
}

function stampName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function allSignature(data: LedgerData): string {
  let maxStamp = '';
  for (const tx of data.txs) {
    const stamp = tx.updatedAt || tx.createdAt || '';
    if (stamp > maxStamp) maxStamp = stamp;
  }
  return `${data.txs.length}:${maxStamp}:${data.books.length}`;
}

function markWritten(kind: ArchiveKind): void {
  const driver = getStorageDriver();
  guard(() => driver.setItem(AT_KEY, String(Date.now())), undefined, '写存档时间');
  guard(() => driver.setItem(KIND_KEY, kind), undefined, '写存档类型');
}

/* ---------------------------------------------------------------- 清理 */

function removeFile(name: string): boolean {
  const ok = guard(
    () => {
      fs().unlinkSync(entryPath(name));
      return true;
    },
    false,
    '删存档',
  );
  if (ok) invalidateList();
  return ok;
}

/** 快照只留最新 N 份 */
function pruneSnapshots(): void {
  const snapshots = listArchives(true)
    .filter((entry) => entry.kind === 'json' && entry.name.startsWith(SNAPSHOT_PREFIX))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of snapshots.slice(SNAPSHOT_KEEP)) removeFile(stale.name);
}

/**
 * 预算守卫。顺序刻意如此：先牺牲旧快照（价值最低），再清已不存在账本的表格，
 * 最后才动其他账本的表格。**永远不删当前账本的表格**。
 */
export function pruneArchives(): void {
  const entries = listArchives(true);
  const total = entries.reduce((acc, entry) => acc + entry.size, 0);
  if (total <= budgetBytes) return;

  const data = api?.getData();
  const currentName = data ? readNameMap()[getBook(data)?.id ?? ''] : undefined;
  const liveBookNames = new Set(
    data
      ? data.books.map((book) => readNameMap()[book.id]).filter((name): name is string => Boolean(name))
      : [],
  );

  let bytes = total;
  const drop = (entry: ArchiveEntry) => {
    if (removeFile(entry.name)) bytes -= entry.size;
  };

  // 1. 旧快照，保留最新 1 份
  const snapshots = entries
    .filter((entry) => entry.kind === 'json' && entry.name.startsWith(SNAPSHOT_PREFIX))
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of snapshots.slice(1)) {
    if (bytes <= budgetBytes) return;
    drop(entry);
  }

  // 2. 已删除账本留下的表格
  for (const entry of entries) {
    if (bytes <= budgetBytes) return;
    if (entry.kind !== 'xlsx' || entry.name === currentName) continue;
    if (liveBookNames.has(entry.name)) continue;
    drop(entry);
  }

  // 3. 其他账本的旧表格（按修改时间从旧到新），仍不碰当前账本
  const otherBooks = entries
    .filter((entry) => entry.kind === 'xlsx' && entry.name !== currentName)
    .sort((a, b) => a.mtime - b.mtime);
  for (const entry of otherBooks) {
    if (bytes <= budgetBytes) return;
    drop(entry);
  }
}

/** 仅供验收脚本注入小预算用 */
export function setArchiveBudget(bytes: number): void {
  budgetBytes = bytes > 0 ? bytes : DEFAULT_BUDGET_BYTES;
}

/* ---------------------------------------------------------------- 调度 */

function dirtyBooks(data: LedgerData): string[] {
  const out: string[] = [];
  for (const book of data.books) {
    const count = data.txs.reduce((acc, tx) => acc + (tx.bookId === book.id ? 1 : 0), 0);
    if (count === 0) continue;
    if (archivedSig.get(book.id) === signatureOf(data, book.id)) continue;
    out.push(book.id);
  }
  return out;
}

function run(): void {
  idleTimer = undefined;
  if (retryTimer) {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  if (lock) return;
  lock = true;
  try {
    const data = api?.getData();
    if (!data || data.txs.length === 0) return;

    const dirty = dirtyBooks(data);
    if (dirty.length) {
      const current = getBook(data);
      // 当前账本优先，其余账本排队，每次只写一个，避免一次拼好几份表格卡主线程
      const target = current && dirty.includes(current.id) ? current.id : dirty[0];
      const wait = XLSX_MIN_GAP - (Date.now() - lastXlsxAt);
      if (wait > 0) {
        // 门限未到就约一次补写。否则用户停手后这本账可能一直等不到下一次触发。
        retryTimer = window.setTimeout(run, wait + 500);
      } else {
        writeBookXlsx(target);
        lastXlsxAt = Date.now();
      }
    }

    if (Date.now() - lastJsonAt >= SNAPSHOT_MIN_GAP) writeSnapshotJson();
    pruneArchives();
  } catch (error) {
    lastError = `调度: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    lock = false;
  }
}

/** 写入链路尾部调用。永不抛错、永不阻塞。 */
export function scheduleArchive(reason: ArchiveReason = 'persist'): void {
  try {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(run, reason === 'persist' ? IDLE_DELAY : 0);
  } catch {
    /* 定时器失败也不能影响记账 */
  }
}

/**
 * onHide 专用：同步、只写 JSON。
 * 大库里生成 xlsx 可能上百毫秒，而切后台没有可执行时长承诺，所以这里绝不碰表格。
 */
export function archiveOnHide(): ArchiveResult {
  if (lock) return { ok: false, reason: 'locked' };
  const data = api?.getData();
  if (!data) return { ok: false, reason: 'no-api' };
  if (data.txs.length === 0) return { ok: false, reason: 'no-data' };
  lock = true;
  try {
    // 数据没变时 writeSnapshotJson 内部会按签名短路，常态开销就是一次字符串比较
    return writeSnapshotJson();
  } finally {
    lock = false;
  }
}

/** 手动「立即存档」：绕过 60s 门限，表格 + 快照都写。 */
export async function archiveNow(): Promise<ArchiveResult[]> {
  const data = api?.getData();
  if (!data) return [{ ok: false, reason: 'no-api' }];
  if (data.txs.length === 0) return [{ ok: false, reason: 'no-data' }];
  if (lock) return [{ ok: false, reason: 'locked' }];

  lock = true;
  const results: ArchiveResult[] = [];
  try {
    const xlsx = writeBookXlsx();
    if (xlsx.ok) lastXlsxAt = Date.now();
    results.push(xlsx);
    results.push(writeSnapshotJson());
    pruneArchives();
  } finally {
    lock = false;
  }
  return results;
}

/* ---------------------------------------------------------------- 状态 / UI */

export function archiveStatus(): ArchiveStatus {
  const entries = listArchives();
  const driver = getStorageDriver();
  const atRaw = guard(() => driver.getItem(AT_KEY), null, '读存档时间');
  const kindRaw = guard(() => driver.getItem(KIND_KEY), null, '读存档类型');
  const at = atRaw ? Number(atRaw) : NaN;
  const lastAt = Number.isFinite(at) && at > 0 ? at : entries[0]?.mtime ?? null;
  const lastKind = (kindRaw === 'xlsx' || kindRaw === 'json' ? kindRaw : entries[0]?.kind) ?? null;
  return {
    lastAt,
    lastKind: lastAt ? lastKind : null,
    files: entries.length,
    bytes: entries.reduce((acc, entry) => acc + entry.size, 0),
    lastError,
  };
}

export function latestArchive(): ArchiveEntry | null {
  return listArchives()[0] ?? null;
}

export function latestBookArchive(bookId?: string): ArchiveEntry | null {
  const data = api?.getData();
  if (!data) return null;
  const name = readNameMap()[getBook(data, bookId)?.id ?? ''];
  if (!name) return null;
  return listArchives().find((entry) => entry.name === name) ?? null;
}

export function getArchiveFilePath(name: string): string {
  return entryPath(name);
}

/** 从存档文件读回数据。校验复用 dataIO，导入后仍需调用方走 importData 落盘。 */
export function readArchiveJson(name: string): { ok: boolean; data?: LedgerData; message: string } {
  try {
    const text = fs().readFileSync(entryPath(name), 'utf8');
    return parseBackupText(typeof text === 'string' ? text : String(text));
  } catch {
    return { ok: false, message: '存档文件读取失败' };
  }
}

/** 微信内预览表格。showMenu 必须显式传 true，否则右上角菜单不显示、无法转存。 */
export async function openArchive(name: string): Promise<boolean> {
  try {
    await Taro.openDocument({ filePath: entryPath(name), fileType: 'xlsx', showMenu: true });
    return true;
  } catch {
    return false;
  }
}

/** 转发到聊天。shareFileMessage 限制「仅在点击行为时调用」，不能先 await 别的操作。 */
export async function shareArchive(name: string): Promise<boolean> {
  try {
    await Taro.shareFileMessage({ filePath: entryPath(name), fileName: name });
    return true;
  } catch {
    return false;
  }
}

/** 记录「已把存档发到聊天」。只在 shareFileMessage 真的成功时调用。 */
export function markShared(): void {
  guard(() => getStorageDriver().setItem(SHARE_KEY, String(Date.now())), undefined, '写发送时间');
}

export function sharedAt(): number | null {
  const raw = guard(() => getStorageDriver().getItem(SHARE_KEY), null, '读发送时间');
  const stamp = raw ? Number(raw) : NaN;
  return Number.isFinite(stamp) && stamp > 0 ? stamp : null;
}

/** 清空目录（仅验收脚本使用） */
export function clearArchives(): void {
  for (const entry of listArchives(true)) removeFile(entry.name);
  archivedSig.clear();
  // 内存里的签名与门限必须一起归零。否则文件已经没了，签名守卫还在，
  // 后续会一直认为「已经写过」而拒绝重建。
  lastJsonSig = '';
  lastJsonAt = 0;
  lastXlsxAt = 0;
  invalidateList();
}
