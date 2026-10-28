import { useMemo, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { EmptyState } from '@/components/TxRow';
import { rangeTransactions, summarize } from '@/store/selectors';
import { resolveRange, todayStr } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import './index.scss';

/**
 * 账本管理（小程序版）。对应 Web 版 BooksPage.tsx + BookDetailPage.tsx 的管理职责。
 *
 * 与 Web 版的关键差异：Web 版点账本卡片进「账本详情页」（本月支出大卡 + 流水时间线
 * + 编辑入口），这里改成**点卡片即切换当前账本**，编辑/归档/删除收进右侧「⋯」。
 *
 * 理由：Web 版详情页的内容有七成是首页已有的（本月收支、预算、流水），
 * 在手机上多跳一层只会让「换个账本记账」这个高频动作变慢。
 * 切换后首页的总览、底栏各页的账本上下文一起变，反馈是即时的，
 * 所以详情页在当前阶段不再单独迁移；真需要看某个账本的流水，
 * 首页已经按账本过滤，流水页也跟随当前账本。
 */

const ICON_CHOICES = ['wallet', 'book', 'home', 'shopping', 'food', 'fun', 'card', 'invest'];
const COLOR_CHOICES = ['#f0993e', '#e05a4f', '#7b8ff7', '#4bb3a0', '#e8608c', '#8a94a6'];

type SheetState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }
  | { mode: 'actions'; id: string }
  | null;

export default function BooksPage() {
  const data = useStore((s) => s.data);
  const addBook = useStore((s) => s.addBook);
  const updateBook = useStore((s) => s.updateBook);
  const archiveBook = useStore((s) => s.archiveBook);
  const deleteBook = useStore((s) => s.deleteBook);
  const updateSettings = useStore((s) => s.updateSettings);

  const [sheet, setSheet] = useState<SheetState>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(ICON_CHOICES[0]);
  const [color, setColor] = useState(COLOR_CHOICES[0]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const books = useMemo(() => [...data.books].sort((a, b) => a.sort - b.sort), [data.books]);
  const currentId = data.settings.lastBookId ?? books[0]?.id ?? null;

  const rows = useMemo(() => {
    const range = resolveRange('month', todayStr(), data.settings.monthStartDay);
    return books.map((book) => {
      const txs = data.txs.filter((tx) => tx.bookId === book.id);
      const totals = summarize(rangeTransactions(txs, range));
      return { book, count: txs.length, expense: totals.expense };
    });
  }, [books, data.txs, data.settings.monthStartDay]);

  const openCreate = () => {
    setName('');
    setIcon(ICON_CHOICES[0]);
    setColor(COLOR_CHOICES[0]);
    setSheet({ mode: 'create' });
  };

  const openEdit = (id: string) => {
    const book = data.books.find((b) => b.id === id);
    if (!book) return;
    setName(book.name);
    setIcon(book.icon);
    setColor(book.color);
    setSheet({ mode: 'edit', id });
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入账本名称', 'warn');
      return;
    }
    if (sheet?.mode === 'edit') {
      updateBook(sheet.id, { name: trimmed, icon, color });
      toast('账本已更新');
    } else {
      const id = addBook(trimmed, icon, color);
      // 新建后直接切过去：用户刚建完账本，接下来多半就要在这个账本里记账
      updateSettings({ lastBookId: id });
      toast('账本已创建');
    }
    setSheet(null);
  };

  const switchTo = (id: string, archived: boolean) => {
    if (archived) {
      toast('该账本已归档，点右侧「⋯」可恢复', 'warn');
      return;
    }
    if (id === currentId) {
      setSheet({ mode: 'actions', id });
      return;
    }
    updateSettings({ lastBookId: id });
    const target = data.books.find((b) => b.id === id);
    toast(`已切换到「${target?.name ?? ''}」`);
  };

  const actionBook = sheet?.mode === 'actions' ? data.books.find((b) => b.id === sheet.id) : null;

  return (
    <View className='shell shell--plain'>
      <PageHead
        right={
          <View className='icon-btn' hoverClass='icon-btn--hover' onClick={openCreate}>
            <Icon name='plus' size={20} />
          </View>
        }
        subtitle={`${books.length} 个账本 · 点卡片切换`}
        title='我的账本'
      />

      <View className='section books-section'>
        {rows.length === 0 ? (
          <EmptyState description='创建第一个账本，开始记录收支' icon='book' title='还没有账本' />
        ) : (
          rows.map(({ book, count, expense }) => {
            const isCurrent = book.id === currentId;
            return (
              <View
                className={`book-card books-card ${book.archived ? 'books-card--dim' : ''}`}
                key={book.id}
                onClick={() => switchTo(book.id, book.archived)}
              >
                <View className='book-card__icon' style={{ background: book.color }}>
                  <Icon name={book.icon} size={21} />
                </View>
                <View className='book-card__main'>
                  <View className='books-card__name-row'>
                    <Text className='book-card__name'>{book.name}</Text>
                    {isCurrent ? <Text className='badge books-badge'>当前</Text> : null}
                    {book.archived ? <Text className='badge books-badge'>已归档</Text> : null}
                  </View>
                  <Text className='book-card__meta'>
                    {count} 笔 · 本月支出 {formatMoney(expense, { digits: 2 })}
                  </Text>
                </View>
                {isCurrent && !book.archived ? (
                  <Icon className='books-check' name='check' size={17} />
                ) : null}
                <View
                  className='icon-btn icon-btn--plain' hoverClass='icon-btn--hover'
                  onClick={(event) => {
                    event.stopPropagation();
                    setSheet({ mode: 'actions', id: book.id });
                  }}
                >
                  <Icon name='more' size={17} />
                </View>
              </View>
            );
          })
        )}

        <View className='btn btn--primary btn--block books-new' onClick={openCreate}>
          <Icon name='plus' size={17} />
          新建账本
        </View>
        <Text className='books-note'>
          归档的账本不再出现在首页，数据完整保留；删除账本会连同其账户、预算与模板一起移除，
          若账本下还有流水则不允许删除。
        </Text>
      </View>

      {sheet?.mode === 'create' || sheet?.mode === 'edit' ? (
        <Sheet onClose={() => setSheet(null)} title={sheet.mode === 'create' ? '新建账本' : '账本设置'}>
          <View className='books-form'>
            <View className='settings-group__title books-form__label'>名称</View>
            <Input
              className='input'
              onInput={(event) => setName(event.detail.value)}
              placeholder='例如：日常、旅行、家庭'
              placeholderClass='books-ph'
              value={name}
            />

            <View className='settings-group__title books-form__label books-form__label--gap'>图标</View>
            <View className='books-icons'>
              {ICON_CHOICES.map((item) => (
                <View
                  className='icon-btn books-icon' hoverClass='icon-btn--hover'
                  key={item}
                  onClick={() => setIcon(item)}
                  style={{
                    background: icon === item ? color : undefined,
                    color: icon === item ? '#fff' : undefined,
                  }}
                >
                  <Icon name={item} size={18} />
                </View>
              ))}
            </View>

            <View className='settings-group__title books-form__label books-form__label--gap'>颜色</View>
            <View className='books-colors'>
              {COLOR_CHOICES.map((item) => (
                <View
                  className='books-color'
                  key={item}
                  onClick={() => setColor(item)}
                  style={{
                    background: item,
                    boxShadow:
                      color === item ? `0 0 0 2px var(--surface), 0 0 0 4px ${item}` : undefined,
                  }}
                />
              ))}
            </View>

            <View className='btn btn--primary btn--block books-submit' onClick={submit}>
              {sheet.mode === 'create' ? '创建' : '保存'}
            </View>
          </View>
        </Sheet>
      ) : null}

      {actionBook ? (
        <Sheet onClose={() => setSheet(null)} title={actionBook.name}>
          <View className='settings-group books-actions'>
            <View className='settings-row' hoverClass='settings-row--hover' onClick={() => openEdit(actionBook.id)}>
              <Icon name='edit' size={18} />
              <Text className='settings-row__label'>重命名与外观</Text>
            </View>
            <View
              className='settings-row' hoverClass='settings-row--hover'
              onClick={() => {
                archiveBook(actionBook.id, !actionBook.archived);
                toast(actionBook.archived ? '已恢复账本' : '已归档账本');
                setSheet(null);
              }}
            >
              <Icon name='eye' size={18} />
              <Text className='settings-row__label'>{actionBook.archived ? '恢复账本' : '归档账本'}</Text>
              <Text className='settings-row__value'>{actionBook.archived ? '恢复显示' : '从首页隐藏'}</Text>
            </View>
            <View
              className='settings-row' hoverClass='settings-row--hover'
              onClick={() => {
                setPendingDelete(actionBook.id);
                setSheet(null);
              }}
            >
              <Icon name='trash' size={18} />
              <Text className='settings-row__label danger-text'>删除账本</Text>
            </View>
          </View>
        </Sheet>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          description='删除后该账本的账户、预算与模板会一并移除；若账本下仍有流水，需要先清空或改为归档。'
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const result = deleteBook(pendingDelete);
            toast(result.message, result.ok ? 'info' : 'warn');
            setPendingDelete(null);
          }}
          title='删除账本？'
          tone='danger'
        />
      ) : null}
    </View>
  );
}
