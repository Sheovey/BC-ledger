import type { Account, Book, Category, LedgerData, Settings } from '@/types';
import { isoNow, uid } from '@/utils/id';

export const DATA_VERSION = 2;

/** 预设一级/二级分类：id 稳定可读，便于导入导出与后续迁移 */
type PresetCategory = {
  key: string;
  name: string;
  type: 'expense' | 'income';
  icon: string;
  color: string;
  children: string[];
};

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    key: 'food',
    name: '餐饮',
    type: 'expense',
    icon: 'food',
    color: '#f97362',
    children: ['早午晚餐', '早餐', '午餐', '晚餐', '夜宵', '饮料', '零食', '外卖'],
  },
  {
    key: 'traffic',
    name: '交通',
    type: 'expense',
    icon: 'traffic',
    color: '#f5a623',
    children: ['公交地铁', '打车', '加油', '停车费', '过路费', '火车', '机票'],
  },
  {
    key: 'shopping',
    name: '购物',
    type: 'expense',
    icon: 'shopping',
    color: '#e8608c',
    children: ['日用品', '服饰', '鞋帽', '化妆品', '数码', '家居'],
  },
  {
    key: 'home',
    name: '居家物业',
    type: 'expense',
    icon: 'home',
    color: '#7b8ff7',
    children: ['房租', '物业费', '水费', '电费', '燃气费', '维修'],
  },
  {
    key: 'fun',
    name: '娱乐',
    type: 'expense',
    icon: 'fun',
    color: '#9b7bf0',
    children: ['电影', '游戏', '旅游', '运动', '会员订阅'],
  },
  {
    key: 'medical',
    name: '医疗健康',
    type: 'expense',
    icon: 'medical',
    color: '#4bb3a0',
    children: ['门诊', '药品', '体检', '保健'],
  },
  {
    key: 'edu',
    name: '学习教育',
    type: 'expense',
    icon: 'edu',
    color: '#59a5f5',
    children: ['书籍', '培训', '考试', '文具'],
  },
  {
    key: 'phone',
    name: '通讯',
    type: 'expense',
    icon: 'phone',
    color: '#5cc9a7',
    children: ['话费', '宽带', '流量'],
  },
  {
    key: 'gift',
    name: '人情往来',
    type: 'expense',
    icon: 'gift',
    color: '#ef7d9a',
    children: ['红包', '礼物', '请客', '随礼'],
  },
  {
    // id / icon 仍沿用 finance：这两者是内部标识，不参与界面展示，
    // 改名会让老数据的 categoryId 断链，代价大而好处为零。
    // 对外的分类名与子项已全部改为生活服务类目，不含需要资质审批的表述。
    key: 'finance',
    name: '生活服务',
    type: 'expense',
    icon: 'finance',
    color: '#8a94a6',
    children: ['快递', '理发', '洗衣', '家政', '手续费'],
  },
  {
    key: 'other_expense',
    name: '其他',
    type: 'expense',
    icon: 'other',
    color: '#a3aab8',
    children: ['其他支出'],
  },
  {
    key: 'salary',
    name: '职业收入',
    type: 'income',
    icon: 'salary',
    color: '#e05a4f',
    children: ['工资', '奖金', '加班费', '提成'],
  },
  {
    key: 'parttime',
    name: '兼职收入',
    type: 'income',
    icon: 'parttime',
    color: '#e8843c',
    children: ['兼职', '外包', '稿费'],
  },
  {
    // 同 finance：id / icon 保留 invest，仅替换对外文案与子项。
    key: 'invest',
    name: '补贴收入',
    type: 'income',
    icon: 'invest',
    color: '#c9723f',
    children: ['交通补贴', '餐补', '住房补贴', '其他补贴'],
  },
  {
    key: 'other_income',
    name: '其他收入',
    type: 'income',
    icon: 'income',
    color: '#b06a7a',
    children: ['红包', '报销', '退款', '礼金', '其他收入'],
  },
];

const PRESET_ACCOUNTS: Array<Omit<Account, 'id' | 'bookId' | 'sort'>> = [
  { name: '现金', type: 'cash', icon: 'cash', color: '#f0a848', initialBalance: 0, includeInTotal: true, archived: false },
  { name: '支付宝', type: 'alipay', icon: 'alipay', color: '#3d8bfd', initialBalance: 0, includeInTotal: true, archived: false },
  { name: '微信钱包', type: 'wechat', icon: 'wechat', color: '#3fb96b', initialBalance: 0, includeInTotal: true, archived: false },
  { name: '储蓄卡', type: 'debit', icon: 'card', color: '#7b8ff7', initialBalance: 0, includeInTotal: true, archived: false },
  { name: '信用卡', type: 'credit', icon: 'credit', color: '#e8608c', initialBalance: 0, includeInTotal: false, archived: false },
];

export function createPresetCategories(): Category[] {
  const list: Category[] = [];
  PRESET_CATEGORIES.forEach((preset, index) => {
    const parentId = `cat_${preset.key}`;
    list.push({
      id: parentId,
      bookId: null,
      parentId: null,
      name: preset.name,
      type: preset.type,
      icon: preset.icon,
      color: preset.color,
      sort: index,
      archived: false,
    });
    preset.children.forEach((childName, childIndex) => {
      list.push({
        id: `${parentId}_${childIndex + 1}`,
        bookId: null,
        parentId,
        name: childName,
        type: preset.type,
        icon: preset.icon,
        color: preset.color,
        sort: childIndex,
        archived: false,
      });
    });
  });
  return list;
}

export function createDefaultSettings(): Settings {
  return {
    currency: '¥',
    monthStartDay: 1,
    lastBookId: null,
    recentCategoryIds: [],
    theme: 'light',
    showArchived: false,
  };
}

export function createBook(name = '默认账本'): Book {
  return {
    id: uid('book'),
    name,
    icon: 'wallet',
    color: '#f0993e',
    createdAt: isoNow(),
    sort: 0,
    archived: false,
  };
}

export function createAccountsForBook(bookId: string): Account[] {
  return PRESET_ACCOUNTS.map((account, index) => ({
    ...account,
    id: uid('acc'),
    bookId,
    sort: index,
  }));
}

/** 首次启动的空账本数据集（不含任何虚构流水） */
export function createInitialData(): LedgerData {
  const book = createBook();
  return {
    version: DATA_VERSION,
    books: [book],
    categories: createPresetCategories(),
    accounts: createAccountsForBook(book.id),
    projects: [],
    templates: [],
    budgets: [],
    txs: [],
    settings: { ...createDefaultSettings(), lastBookId: book.id },
  };
}
