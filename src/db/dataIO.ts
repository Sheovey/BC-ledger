import Taro from '@tarojs/taro';
import type { LedgerData, Tx } from '@/types';
import { buildCategoryMap } from '@/store/selectors';
import { fenToYuanString } from '@/utils/money';

/**
 * 数据导入导出（小程序版）。
 *
 * Web 版是 `Blob + <a download>` 触发浏览器下载，小程序没有这两样：
 * - 导出 → 写到 USER_DATA_PATH，然后 shareFileMessage 让用户转发给「文件传输助手」
 * - 导入 → chooseMessageFile 从聊天记录里选文件，用 FileSystemManager 读
 *
 * 关键约束：
 * 1. shareFileMessage 必须在用户点击的回调里同步触发（不能 await 别的东西之后再调），
 *    否则会报「非用户手势」。所以「先写文件、再分享」两步之间不加额外 await。
 * 2. 开发者工具不支持 shareFileMessage，必须降级到剪贴板，否则这个功能在调试期完全不可用。
 * 3. 文本生成和落盘分开：生成是纯函数，方便验收脚本直接比对内容，
 *    也方便以后加「微信云备份」时复用同一份 JSON。
 */

const TYPE_LABEL: Record<Tx['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  balance: '余额调整',
};

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 生成完整备份文本（纯函数，不做 IO） */
export function buildJsonText(data: LedgerData): string {
  return JSON.stringify(data, null, 2);
}

/** 生成单个账本的 CSV 文本（带 BOM，Excel 双击不乱码） */
export function buildCsvText(data: LedgerData, bookId: string): string {
  const { byId, rootOf } = buildCategoryMap(data.categories);
  const accountName = (id: string | null) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const projectName = (id: string | null) => data.projects.find((p) => p.id === id)?.name ?? '';

  const rows = data.txs
    .filter((tx) => tx.bookId === bookId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((tx) => {
      const category = tx.categoryId ? byId.get(tx.categoryId) : undefined;
      const root = rootOf(tx.categoryId);
      return [
        tx.occurredAt.replace('T', ' '),
        TYPE_LABEL[tx.type],
        root?.name ?? '',
        category?.name ?? '',
        fenToYuanString(tx.amount),
        accountName(tx.accountId),
        tx.type === 'transfer' ? accountName(tx.toAccountId) : '',
        projectName(tx.projectId),
        tx.merchant,
        tx.note,
      ]
        .map((cell) => csvCell(cell))
        .join(',');
    });

  const header = '时间,类型,一级分类,二级分类,金额,账户,转入账户,项目,商家,备注';
  return `\ufeff${[header, ...rows].join('\r\n')}`;
}

export type SaveOutcome = 'shared' | 'copied' | 'failed';

/**
 * 把文本写成文件并交给用户。
 * 优先微信的「转发文件」；不可用时退回剪贴板，至少数据能带走。
 */
export async function saveTextFile(filename: string, content: string): Promise<SaveOutcome> {
  try {
    const fs = Taro.getFileSystemManager();
    const filePath = `${Taro.env.USER_DATA_PATH}/${filename}`;
    fs.writeFileSync(filePath, content, 'utf8');

    try {
      await Taro.shareFileMessage({ filePath, fileName: filename });
      return 'shared';
    } catch {
      // 开发者工具 / 非微信环境不支持转发文件，退回剪贴板
      await Taro.setClipboardData({ data: content });
      return 'copied';
    }
  } catch {
    try {
      await Taro.setClipboardData({ data: content });
      return 'copied';
    } catch {
      return 'failed';
    }
  }
}

export async function exportJson(data: LedgerData): Promise<SaveOutcome> {
  return saveTextFile(`ledger-backup-${stamp()}.json`, buildJsonText(data));
}

export async function exportCsv(data: LedgerData, bookId: string): Promise<SaveOutcome> {
  return saveTextFile(`ledger-${stamp()}.csv`, buildCsvText(data, bookId));
}

export interface ImportResult {
  ok: boolean;
  message: string;
  data?: LedgerData;
}

/** 校验并补全备份结构；只接受本应用导出的格式 */
export function parseBackupText(text: string): ImportResult {
  try {
    const parsed = JSON.parse(text) as Partial<LedgerData>;
    if (!parsed || !Array.isArray(parsed.books) || !Array.isArray(parsed.txs)) {
      return { ok: false, message: '不是有效的账本备份文件' };
    }
    const data: LedgerData = {
      version: parsed.version ?? 1,
      books: parsed.books,
      categories: parsed.categories ?? [],
      accounts: parsed.accounts ?? [],
      projects: parsed.projects ?? [],
      templates: parsed.templates ?? [],
      budgets: parsed.budgets ?? [],
      txs: parsed.txs,
      settings: {
        currency: '¥',
        monthStartDay: 1,
        lastBookId: parsed.books[0]?.id ?? null,
        recentCategoryIds: [],
        theme: 'light',
        showArchived: false,
        ...parsed.settings,
      },
    };
    return { ok: true, message: `已读取 ${data.txs.length} 条流水`, data };
  } catch {
    return { ok: false, message: '文件格式错误，无法解析' };
  }
}

/**
 * 从聊天记录里选一个备份文件并解析。
 * 返回值里的 message 直接用于 toast，调用方不用再加工。
 */
export async function pickAndParseBackup(): Promise<ImportResult> {
  let filePath = '';
  try {
    const res = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['json'] });
    filePath = res.tempFiles?.[0]?.path ?? '';
  } catch (error) {
    // 用户主动取消不算错误，别弹「失败」吓人
    const msg = error instanceof Error ? error.message : String(error ?? '');
    if (/cancel/i.test(msg)) return { ok: false, message: '已取消' };
    return { ok: false, message: '无法打开文件选择器' };
  }
  if (!filePath) return { ok: false, message: '已取消' };

  try {
    const text = Taro.getFileSystemManager().readFileSync(filePath, 'utf8');
    return parseBackupText(typeof text === 'string' ? text : String(text));
  } catch {
    return { ok: false, message: '文件读取失败' };
  }
}
