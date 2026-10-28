/**
 * 领域模型定义（单一事实来源）
 *
 * 设计约定：
 * 1. 所有金额字段以「分」为单位的整数存储，避免 IEEE754 浮点误差（0.1 + 0.2 !== 0.3）。
 * 2. 所有时间字段以本地时间字符串 `YYYY-MM-DDTHH:mm` 存储，不转 UTC，
 *    避免跨时区/夏令时导致「23 日记的账跑到 22 日」。
 * 3. 所有实体都带 bookId（除分类为全局共享外），删除采用软删除（archived），
 *    保证历史流水不会因删除账户/分类而失去引用。
 */

/** 记录类型：支出 / 收入 / 转账 / 余额调整 */
export type TxType = 'expense' | 'income' | 'transfer' | 'balance';

/** 账户类型（仅用于图标与默认行为，不参与计算分支） */
export type AccountType =
  | 'cash'
  | 'debit'
  | 'credit'
  | 'alipay'
  | 'wechat'
  | 'invest'
  | 'other';

/** 账本 */
export interface Book {
  id: string;
  name: string;
  /** 图标标识，对应内置图标映射 */
  icon: string;
  color: string;
  /** 创建时间，ISO 时间戳 */
  createdAt: string;
  /** 排序权重，升序 */
  sort: number;
  /** 软删除标记，归档账本不参与统计但仍可恢复 */
  archived: boolean;
  /** 服务端最后修改时间，由云端回填；本地新建时可缺省 */
  updatedAt?: string;
}

/**
 * 分类：一级分类 parentId = null；二级分类 parentId 指向一级分类。
 * 全局共享（bookId = null）时所有账本可用，便于预设分类复用；
 * 用户可在任意账本内新建自定义分类。
 */
export interface Category {
  id: string;
  /** null 表示全局分类 */
  bookId: string | null;
  parentId: string | null;
  name: string;
  /** 所属收支方向，二级分类必须与父级一致 */
  type: 'expense' | 'income';
  icon: string;
  color: string;
  sort: number;
  archived: boolean;
  updatedAt?: string;
}

/** 账户：资金容器，余额由初始余额 + 流水推导，不单独存当前余额 */
export interface Account {
  id: string;
  bookId: string;
  name: string;
  type: AccountType;
  icon: string;
  color: string;
  /** 初始余额（分），可为负（信用卡欠款） */
  initialBalance: number;
  /** 是否计入总资产 */
  includeInTotal: boolean;
  sort: number;
  archived: boolean;
  updatedAt?: string;
}

/** 项目：跨分类的横切维度（装修、旅行、某次报销等） */
export interface Project {
  id: string;
  bookId: string;
  name: string;
  color: string;
  archived: boolean;
  updatedAt?: string;
}

/** 记账模板：把常用的一套字段存下来，一键填入 */
export interface Template {
  id: string;
  bookId: string;
  name: string;
  type: TxType;
  amount: number;
  categoryId: string | null;
  accountId: string | null;
  projectId: string | null;
  merchant: string;
  note: string;
  sort: number;
  updatedAt?: string;
}

/** 预算：month 为 `YYYY-MM` 时是单月预算，为 `*` 时是每月通用预算 */
export interface Budget {
  id: string;
  bookId: string;
  month: string;
  /** null 表示总预算，否则为分类预算 */
  categoryId: string | null;
  /** 预算金额（分） */
  amount: number;
  updatedAt?: string;
}

/** 流水记录 */
export interface Tx {
  id: string;
  bookId: string;
  type: TxType;
  /** 金额（分，恒为正数；方向由 type 决定；balance 类型下为差额，可为负） */
  amount: number;
  /** 支出/收入分类 */
  categoryId: string | null;
  /** 资金账户；转账时为转出账户 */
  accountId: string | null;
  /** 转账目标账户 */
  toAccountId: string | null;
  projectId: string | null;
  /** 商家文本（不做独立主数据，避免维护成本） */
  merchant: string;
  note: string;
  /** 记账时间 `YYYY-MM-DDTHH:mm` */
  occurredAt: string;
  /** 创建/最后修改时间，ISO */
  createdAt: string;
  updatedAt: string;
}

/** 全局设置 */
export interface Settings {
  currency: string;
  /** 月起始日 1-28，用于自定义账单周期 */
  monthStartDay: number;
  /** 最近一次使用的账本 */
  lastBookId: string | null;
  /** 最近使用过的分类 id，倒序，最多 20 个 */
  recentCategoryIds: string[];
  /** 主题 */
  theme: 'light' | 'dark';
  /** 首页/流水页是否显示已归档账本 */
  showArchived: boolean;
}

/** 持久化数据根节点 */
export interface LedgerData {
  version: number;
  books: Book[];
  categories: Category[];
  accounts: Account[];
  projects: Project[];
  templates: Template[];
  budgets: Budget[];
  txs: Tx[];
  settings: Settings;
}

/** 统计维度 */
export type StatDimension = 'category' | 'account' | 'project' | 'merchant';

/** 时间范围类型 */
export type RangeKind = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface DateRange {
  kind: RangeKind;
  /** `YYYY-MM-DD` 闭区间 */
  start: string;
  end: string;
  label: string;
}

/** 导航路由（栈式，支持浏览器返回） */
export type Route =
  | { name: 'home' }
  | { name: 'books' }
  | { name: 'book'; bookId: string }
  | { name: 'record'; txId?: string; presetType?: TxType }
  | { name: 'ledger'; bookId?: string }
  | { name: 'stats'; bookId?: string }
  | { name: 'accounts'; bookId?: string }
  | { name: 'budget'; bookId?: string }
  | { name: 'projects'; bookId?: string }
  | { name: 'templates'; bookId?: string }
  | { name: 'categories' }
  | { name: 'settings' };
