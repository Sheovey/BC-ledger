import { create } from 'zustand';
import Taro from '@tarojs/taro';
import type {
  Account,
  Book,
  Budget,
  Category,
  LedgerData,
  Project,
  Route,
  Settings,
  Template,
  Tx,
} from '@/types';
import { isoNow, uid } from '@/utils/id';
import { loadData, saveData, rotateBackup, dataKeyPrefix, invalidateWriteCache } from '@/db/persist';
import { syncAfterWrite } from '@/db/sync';
import { createAccountsForBook, createBook, createInitialData, createPresetCategories } from '@/db/seed';
import { buildDemoData } from '@/db/demo';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

interface LedgerState {
  data: LedgerData;
  route: Route[];
  toast: Toast | null;
  storageError: string | null;

  // 导航
  navigate: (route: Route) => void;
  back: () => void;
  resetTo: (route: Route) => void;

  // 流水
  addTx: (input: Omit<Tx, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTx: (id: string, patch: Partial<Tx>) => void;
  deleteTx: (id: string) => void;

  // 账本
  addBook: (name: string, icon?: string, color?: string) => string;
  updateBook: (id: string, patch: Partial<Book>) => void;
  archiveBook: (id: string, archived: boolean) => void;
  deleteBook: (id: string) => { ok: boolean; message: string };

  // 分类
  addCategory: (input: Omit<Category, 'id' | 'sort' | 'archived'>) => string;
  updateCategory: (id: string, patch: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  // 账户 / 项目 / 模板 / 预算
  addAccount: (input: Omit<Account, 'id' | 'sort' | 'archived'>) => string;
  updateAccount: (id: string, patch: Partial<Account>) => void;
  deleteAccount: (id: string) => void;

  addProject: (input: Omit<Project, 'id' | 'archived'>) => string;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  addTemplate: (input: Omit<Template, 'id' | 'sort'>) => string;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
  deleteTemplate: (id: string) => void;

  upsertBudget: (input: Omit<Budget, 'id'> & { id?: string }) => void;
  deleteBudget: (id: string) => void;

  // 设置与数据
  /** 切换账号或恢复登录态时整体替换数据（不产生同步变更） */
  hydrate: (data: LedgerData) => void;
  /** 应用服务端拉取结果 */
  applyRemote: (data: LedgerData) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  importData: (data: LedgerData) => void;
  resetAll: () => void;
  loadDemo: () => void;
  dismissToast: () => void;
}

/** 数据落盘后的回调，由同步层注册；不注册时应用为纯本地模式 */
let persistHook: ((data: LedgerData) => void) | null = null;

export function setPersistHook(fn: ((data: LedgerData) => void) | null): void {
  persistHook = fn;
}

let toastSeq = 0;

const initialData = loadData();

/** 节流写入：高频操作（如连续记账）只落盘一次，降低主线程阻塞 */
let writeTimer: number | undefined;
/** 上一次成功落盘的完整数据。初值取启动时读到的磁盘状态，
 *  这样「启动后的第一次修改」也能把修改前的样子存进备份。 */
let lastWrittenRaw = JSON.stringify(initialData);
/** 防抖窗口里待落盘的数据。切后台时靠它做同步 flush，否则窗口内被杀进程会丢最后一笔。 */
let pendingData: LedgerData | null = null;

function doPersist(data: LedgerData) {
  const raw = JSON.stringify(data);
  if (raw === lastWrittenRaw) return;
  const previousRaw = lastWrittenRaw;
  const result = saveData(data);
  if (result.ok) {
    // 顺序不能反：先把旧版本收进备份，再承认新版本已落盘。
    // 反了就会变成「备份 = 当前数据」，回滚点什么也救不回来。
    rotateBackup(previousRaw);
    lastWrittenRaw = raw;
  } else {
    useStore.setState({
      storageError:
        result.reason === 'quota'
          ? '本地存储空间已满，最新改动未能保存。请先导出备份后清理旧数据。'
          : '本地存储写入失败，请检查微信是否清理了存储空间。',
    });
  }
  persistHook?.(data);
  // 云同步未启用时内部直接返回，只有一次 storage 读的开销
  syncAfterWrite(data);
}

function schedulePersist(data: LedgerData) {
  pendingData = data;
  if (writeTimer) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = undefined;
    const next = pendingData;
    pendingData = null;
    if (next) doPersist(next);
  }, 250);
}

/**
 * 立刻把在途的防抖写入落地。切后台/退出前必须调用：
 * 250ms 窗口内被系统杀进程，这笔修改就没了。
 */
export function flushPersist(): void {
  if (writeTimer) {
    window.clearTimeout(writeTimer);
    writeTimer = undefined;
  }
  const next = pendingData;
  pendingData = null;
  if (next) doPersist(next);
}

function touch(data: LedgerData): LedgerData {
  schedulePersist(data);
  return data;
}

export const useStore = create<LedgerState>()((set, get) => ({
  data: initialData,
  route: [{ name: 'home' }],
  toast: null,
  storageError: null,

  navigate: (route) =>
    set((state) => ({
      route: [...state.route, route].slice(-20),
    })),

  back: () =>
    set((state) => ({
      route: state.route.length > 1 ? state.route.slice(0, -1) : state.route,
    })),

  resetTo: (route) => set({ route: [route] }),

  addTx: (input) => {
    const now = isoNow();
    const tx: Tx = { ...input, id: uid('tx'), createdAt: now, updatedAt: now };
    set((state) => {
      const data = touch({ ...state.data, txs: [tx, ...state.data.txs] });
      // 记录最近使用分类，记账页「最近使用」组即取自此列表
      if (tx.categoryId) {
        const recent = [tx.categoryId, ...data.settings.recentCategoryIds.filter((id) => id !== tx.categoryId)].slice(0, 20);
        data.settings = { ...data.settings, recentCategoryIds: recent };
      }
      return { data: { ...data } };
    });
    return tx.id;
  },

  updateTx: (id, patch) =>
    set((state) => {
      const txs = state.data.txs.map((tx) =>
        tx.id === id ? { ...tx, ...patch, id: tx.id, updatedAt: isoNow() } : tx,
      );
      return { data: touch({ ...state.data, txs }) };
    }),

  deleteTx: (id) =>
    set((state) => ({
      data: touch({ ...state.data, txs: state.data.txs.filter((tx) => tx.id !== id) }),
    })),

  addBook: (name, icon = 'wallet', color = '#f0993e') => {
    const book = { ...createBook(name), icon, color, sort: get().data.books.length };
    set((state) => ({
      data: touch({
        ...state.data,
        books: [...state.data.books, book],
        accounts: [...state.data.accounts, ...createAccountsForBook(book.id)],
        settings: { ...state.data.settings, lastBookId: book.id },
      }),
    }));
    return book.id;
  },

  updateBook: (id, patch) =>
    set((state) => ({
      data: touch({
        ...state.data,
        books: state.data.books.map((b) => (b.id === id ? { ...b, ...patch, id } : b)),
      }),
    })),

  archiveBook: (id, archived) =>
    set((state) => ({
      data: touch({
        ...state.data,
        books: state.data.books.map((b) => (b.id === id ? { ...b, archived } : b)),
      }),
    })),

  deleteBook: (id) => {
    const { data } = get();
    const count = data.txs.filter((tx) => tx.bookId === id).length;
    if (count > 0) {
      return { ok: false, message: `该账本下还有 ${count} 条流水，请先清空或改为归档。` };
    }
    if (data.books.filter((b) => !b.archived).length <= 1) {
      return { ok: false, message: '至少保留一个可用账本。' };
    }
    set((state) => ({
      data: touch({
        ...state.data,
        books: state.data.books.filter((b) => b.id !== id),
        accounts: state.data.accounts.filter((a) => a.bookId !== id),
        projects: state.data.projects.filter((p) => p.bookId !== id),
        templates: state.data.templates.filter((t) => t.bookId !== id),
        budgets: state.data.budgets.filter((b) => b.bookId !== id),
        settings: {
          ...state.data.settings,
          lastBookId: state.data.settings.lastBookId === id ? null : state.data.settings.lastBookId,
        },
      }),
    }));
    return { ok: true, message: '账本已删除' };
  },

  addCategory: (input) => {
    const siblings = get().data.categories.filter((c) => c.parentId === input.parentId);
    const category: Category = {
      ...input,
      id: uid('cat'),
      sort: siblings.length,
      archived: false,
    };
    set((state) => ({
      data: touch({ ...state.data, categories: [...state.data.categories, category] }),
    }));
    return category.id;
  },

  updateCategory: (id, patch) =>
    set((state) => ({
      data: touch({
        ...state.data,
        categories: state.data.categories.map((c) => (c.id === id ? { ...c, ...patch, id } : c)),
      }),
    })),

  /** 软删除：历史流水仍能解析出分类名，只是不再出现在选择器里 */
  deleteCategory: (id) =>
    set((state) => {
      const ids = new Set([id, ...state.data.categories.filter((c) => c.parentId === id).map((c) => c.id)]);
      return {
        data: touch({
          ...state.data,
          categories: state.data.categories.map((c) => (ids.has(c.id) ? { ...c, archived: true } : c)),
        }),
      };
    }),

  addAccount: (input) => {
    const account: Account = {
      ...input,
      id: uid('acc'),
      sort: get().data.accounts.filter((a) => a.bookId === input.bookId).length,
      archived: false,
    };
    set((state) => ({ data: touch({ ...state.data, accounts: [...state.data.accounts, account] }) }));
    return account.id;
  },

  updateAccount: (id, patch) =>
    set((state) => ({
      data: touch({
        ...state.data,
        accounts: state.data.accounts.map((a) => (a.id === id ? { ...a, ...patch, id } : a)),
      }),
    })),

  deleteAccount: (id) =>
    set((state) => ({
      data: touch({
        ...state.data,
        accounts: state.data.accounts.map((a) => (a.id === id ? { ...a, archived: true } : a)),
      }),
    })),

  addProject: (input) => {
    const project: Project = { ...input, id: uid('prj'), archived: false };
    set((state) => ({ data: touch({ ...state.data, projects: [...state.data.projects, project] }) }));
    return project.id;
  },

  updateProject: (id, patch) =>
    set((state) => ({
      data: touch({
        ...state.data,
        projects: state.data.projects.map((p) => (p.id === id ? { ...p, ...patch, id } : p)),
      }),
    })),

  deleteProject: (id) =>
    set((state) => ({
      data: touch({
        ...state.data,
        projects: state.data.projects.map((p) => (p.id === id ? { ...p, archived: true } : p)),
      }),
    })),

  addTemplate: (input) => {
    const template: Template = {
      ...input,
      id: uid('tpl'),
      sort: get().data.templates.filter((t) => t.bookId === input.bookId).length,
    };
    set((state) => ({ data: touch({ ...state.data, templates: [...state.data.templates, template] }) }));
    return template.id;
  },

  updateTemplate: (id, patch) =>
    set((state) => ({
      data: touch({
        ...state.data,
        templates: state.data.templates.map((t) => (t.id === id ? { ...t, ...patch, id } : t)),
      }),
    })),

  deleteTemplate: (id) =>
    set((state) => ({
      data: touch({ ...state.data, templates: state.data.templates.filter((t) => t.id !== id) }),
    })),

  upsertBudget: (input) =>
    set((state) => {
      const existing = input.id
        ? state.data.budgets.find((b) => b.id === input.id)
        : state.data.budgets.find(
            (b) => b.bookId === input.bookId && b.month === input.month && b.categoryId === input.categoryId,
          );
      const budgets = existing
        ? state.data.budgets.map((b) => (b.id === existing.id ? { ...b, amount: input.amount } : b))
        : [...state.data.budgets, { ...input, id: uid('budget') }];
      return { data: touch({ ...state.data, budgets }) };
    }),

  deleteBudget: (id) =>
    set((state) => ({
      data: touch({ ...state.data, budgets: state.data.budgets.filter((b) => b.id !== id) }),
    })),

  updateSettings: (patch) =>
    set((state) => ({
      data: touch({ ...state.data, settings: { ...state.data.settings, ...patch } }),
    })),

  importData: (data) =>
    set(() => {
      const merged: LedgerData = {
        ...data,
        categories: data.categories.length ? data.categories : createPresetCategories(),
      };
      schedulePersist(merged);
      return { data: merged, storageError: null };
    }),

  resetAll: () =>
    set(() => {
      const fresh = createInitialData();
      schedulePersist(fresh);
      return { data: fresh, route: [{ name: 'home' }] };
    }),

  loadDemo: () =>
    set((state) => {
      const demo = buildDemoData(state.data);
      schedulePersist(demo);
      return { data: demo };
    }),

  hydrate: (data) => {
    // 切换数据分区前必须取消在途写入，否则会把旧账号的数据写进新账号
    if (writeTimer) window.clearTimeout(writeTimer);
    writeTimer = undefined;
    pendingData = null;
    // 立即落盘到新分区：新账号首次登录生成的是全新 id，
    // 若不写盘，下次启动会重新生成一套 id，云端就会多出一份重复账本
    saveData(data);
    lastWrittenRaw = JSON.stringify(data);
    set({ data, storageError: null, route: [{ name: 'home' }], toast: null });
  },

  applyRemote: (data) => {
    set({ data });
    // 服务端拉下来的数据必须落盘，否则刷新即丢
    schedulePersist(data);
  },

  dismissToast: () => set({ toast: null }),
}));

/**
 * 统一的轻提示入口。
 *
 * Web 版是往 store 写一条 toast 记录，再由顶层渲染的 <Toast> 组件画出来。
 * 小程序这边没有那层常驻容器（Taro 的 app.tsx 只能返回 children，包不了壳），
 * 如果照搬就会出现「写了 state 但没人渲染」——提示完全看不见，
 * 而调用点还以为用户收到了反馈。所以这里直接走微信原生轻提示。
 *
 * 顺带的好处：页面切换时提示不会被卸载掉。
 */
export function toast(text: string, tone: 'info' | 'warn' = 'info') {
  // 原生轻提示最长两行，超长的先截断，避免被微信自己截在半个字上
  const title = text.length > 42 ? `${text.slice(0, 41)}…` : text;
  Taro.showToast({
    title,
    icon: 'none',
    duration: tone === 'warn' ? 2600 : 2000,
  });
}

/**
 * 监听外部标签页写入，避免两个标签页互相覆盖。
 *
 * 仅浏览器有意义：小程序单实例运行，不存在多标签页竞争。
 * 但 Taro 的运行期垫片会让 typeof window === 'object' 成立，
 * 因此这里逐个能力探测，缺了就直接跳过，不能让模块初始化抛错（会整页白屏）。
 */
const win = typeof window !== 'undefined' ? (window as Window) : null;
if (win && typeof win.addEventListener === 'function') {
  let pending: ReturnType<typeof setTimeout> | null = null;
  win.addEventListener('storage', (event) => {
    const key = (event as StorageEvent).key;
    // 分片后一次保存会连写多个分片与 meta，只认本分区前缀，并合并成一次重载
    if (!key || !key.startsWith(dataKeyPrefix())) return;
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      try {
        invalidateWriteCache();
        const next = loadData();
        if (next && Array.isArray(next.txs)) {
          lastWrittenRaw = JSON.stringify(next);
          useStore.setState({ data: next });
        }
      } catch {
        /* 忽略其他标签页的半成品写入 */
      }
    }, 60);
  });
  // 首次加载立即落盘一次，确保 lastWrittenRaw 有基线
  lastWrittenRaw = JSON.stringify(useStore.getState().data);
}
