import { useDeferredValue, useMemo, useState } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import { useReachBottom } from '@tarojs/taro';
import type { Tx, TxType } from '@/types';
import { useStore } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { TabBar } from '@/components/TabBar';
import { TxRow, EmptyState } from '@/components/TxRow';
import { Sheet } from '@/components/Sheet';
import { useNavMetrics } from '@/hooks/useNavMetrics';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import {
  getBook,
  searchTransactions,
  sortTxsDesc,
  summarize,
  visibleBooks,
} from '@/store/selectors';
import {
  addMonths,
  formatDayGroup,
  formatMonthShort,
  monthKey,
  monthRangeSpanText,
  resolveMonthRange,
  resolveRange,
  shiftMonth,
  todayStr,
  withinRange,
} from '@/utils/date';
import { formatMoney, sumFen } from '@/utils/money';
import { navigate } from '@/router';
import './index.scss';

/**
 * 流水页（小程序版）。对应 Web 版 LedgerPage.tsx。
 *
 * 改写点：
 * 1. 顶部栏自绘：Web 版 TopBar 有副标题「N 笔记录」和右侧加号，
 *    系统导航栏放不下，所以 navigationStyle=custom，用 useNavMetrics 补偿状态栏与胶囊。
 * 2. 搜索框 <input> → Taro <Input>，事件从 onChange 改成 onInput（取 e.detail.value）。
 * 3. 账本切换、类型筛选的 button → View（原生 button 自带边框与居中，样式反而要重置）。
 * 4. 时间轴内联在页面里而不是单独组件：小程序跨页复用组件要额外注册，
 *    这层结构只有本页用，内联更省事，逻辑与 Web 版 TxTimeline 完全一致。
 * 5. 分页加载：每次 30 条，触底自动追加。合计与笔数始终按全量算。
 */

const TYPE_FILTERS: Array<{ key: TxType | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' },
  { key: 'balance', label: '余额' },
];

type MonthFilter = 'all' | 'current' | 'prev' | 'range';

const MONTH_FILTERS: Array<{ key: MonthFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'current', label: '本月' },
  { key: 'prev', label: '上月' },
  { key: 'range', label: '区间' },
];

/** 每次加载的条数。30 条约 1.5-2 屏，滑动连贯且首屏渲染快。 */
const PAGE_SIZE = 30;

interface DayGroup {
  day: string;
  items: Tx[];
}

interface MonthGroup {
  month: string;
  days: DayGroup[];
}

/** 按月 → 按日分组。与 Web 版 TxTimeline 同一套算法，抽成纯函数便于复用。 */
function groupByMonthDay(txs: Tx[]): MonthGroup[] {
  const sorted = [...txs].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const groups: MonthGroup[] = [];

  for (const tx of sorted) {
    const month = monthKey(tx.occurredAt);
    const day = tx.occurredAt.slice(0, 10);

    let monthGroup = groups[groups.length - 1];
    if (!monthGroup || monthGroup.month !== month) {
      monthGroup = { month, days: [] };
      groups.push(monthGroup);
    }

    let dayGroup = monthGroup.days[monthGroup.days.length - 1];
    if (!dayGroup || dayGroup.day !== day) {
      dayGroup = { day, items: [] };
      monthGroup.days.push(dayGroup);
    }
    dayGroup.items.push(tx);
  }

  return groups;
}

export default function LedgerPage() {
  const data = useStore((s) => s.data);
  const updateSettings = useStore((s) => s.updateSettings);
  const nav = useNavMetrics();

  const book = getBook(data);
  const [bookId, setBookId] = useState(book?.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<TxType | 'all'>('all');
  const [monthFilter, setMonthFilter] = useState<MonthFilter>('all');
  const [bookSheet, setBookSheet] = useState(false);
  /** 已确认的月份区间（`YYYY-MM`）；切到别的筛选再切回来能直接回填，不用重选 */
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  /** 区间弹层草稿，null = 关闭。用 null 当开关，避免「布尔 + 数据」两份状态不同步 */
  const [rangeDraft, setRangeDraft] = useState<{ from: string; to: string } | null>(null);

  /** 账本可能被删/被切走，取不到就回落到默认账本，避免筛出空列表还找不到原因 */
  const currentBook = data.books.find((b) => b.id === bookId) ?? book;
  const activeBookId = currentBook?.id ?? '';

  /**
   * 当前账本全部流水，时间倒序。
   * 必须先排序再切片：store 里新增流水是往数组头部插的，原始顺序既非时间序也不稳定，
   * 直接 slice 会出现重复或漏项。
   */
  const bookTxs = useMemo(
    () => sortTxsDesc(data.txs.filter((tx) => tx.bookId === activeBookId)),
    [data.txs, activeBookId],
  );

  const customDateRange = useMemo(
    () =>
      customRange
        ? resolveMonthRange(customRange.from, customRange.to, data.settings.monthStartDay)
        : null,
    [customRange, data.settings.monthStartDay],
  );

  /** 输入框必须即时（受控延迟会吞字），过滤用 deferred 值，避免每敲一个字都重排长列表 */
  const deferredKeyword = useDeferredValue(keyword);

  const filtered = useMemo(() => {
    let list = bookTxs;

    if (monthFilter === 'current' || monthFilter === 'prev') {
      const anchor = monthFilter === 'current' ? todayStr() : addMonths(todayStr(), -1);
      const range = resolveRange('month', anchor, data.settings.monthStartDay);
      list = list.filter((tx) => withinRange(tx.occurredAt, range));
    } else if (monthFilter === 'range' && customDateRange) {
      list = list.filter((tx) => withinRange(tx.occurredAt, customDateRange));
    }

    if (typeFilter !== 'all') list = list.filter((tx) => tx.type === typeFilter);

    return searchTransactions(list, deferredKeyword, data.categories);
  }, [
    bookTxs,
    monthFilter,
    customDateRange,
    typeFilter,
    deferredKeyword,
    data.settings.monthStartDay,
    data.categories,
  ]);

  /** 合计与笔数始终基于全量 filtered，不随加载深度变化 */
  const totals = useMemo(() => summarize(filtered), [filtered]);

  const resetKey = [
    activeBookId,
    monthFilter,
    customRange?.from ?? '',
    customRange?.to ?? '',
    typeFilter,
    deferredKeyword,
  ].join('|');
  const page = useProgressiveList(filtered.length, PAGE_SIZE, resetKey);

  /**
   * 切到「整天边界」再渲染。
   * 硬切 30 条会出现「某个日组只显示半天、日合计比实际少」，加载更多后
   * 同一日期下面的数字还会跳变。数组已按时间倒序，同日必然连续，
   * 往后补齐到天尾即可，代价是某天超过 30 笔时这一屏会多出几条。
   */
  const visible = useMemo(() => {
    if (page.count >= filtered.length) return filtered;
    const dayAt = (index: number) => filtered[index]?.occurredAt.slice(0, 10);
    let end = page.count;
    while (end < filtered.length && dayAt(end) === dayAt(end - 1)) end += 1;
    return filtered.slice(0, end);
  }, [filtered, page.count]);

  const remaining = filtered.length - visible.length;
  const hasMore = remaining > 0;

  const groups = useMemo(() => groupByMonthDay(visible), [visible]);
  const books = visibleBooks(data);
  const hasFilter = Boolean(keyword) || typeFilter !== 'all' || monthFilter !== 'all';

  useReachBottom(() => {
    if (hasMore) page.loadMore();
  });

  const clearFilters = () => {
    setKeyword('');
    setTypeFilter('all');
    setMonthFilter('all');
  };

  const openRangeSheet = () => {
    const thisMonth = monthKey(todayStr());
    // 没选过就默认近 6 个账期，多数人想看的区间都落在里面
    setRangeDraft(customRange ?? { from: shiftMonth(thisMonth, -5), to: thisMonth });
  };

  const confirmRange = () => {
    if (!rangeDraft) return;
    const swapped = rangeDraft.from > rangeDraft.to;
    setCustomRange({
      from: swapped ? rangeDraft.to : rangeDraft.from,
      to: swapped ? rangeDraft.from : rangeDraft.to,
    });
    setMonthFilter('range');
    setRangeDraft(null);
  };

  /** 最早一笔流水所在月，作为区间选择器下界 */
  const minMonth = useMemo(() => {
    const earliest = bookTxs[bookTxs.length - 1];
    return earliest ? monthKey(earliest.occurredAt) : monthKey(todayStr());
  }, [bookTxs]);

  const rangeLabel =
    monthFilter === 'range' && customRange
      ? `${formatMonthShort(customRange.from)}-${formatMonthShort(customRange.to)}`
      : '区间';

  return (
    <View className='shell'>
      {/* 状态栏垫高：custom 导航下页面从屏幕最顶画，不让出这块会被时间/电量盖住 */}
      <View style={{ height: `${nav.statusBar}px` }} />

      <View className='ledger-head' style={{ paddingRight: `${nav.rightInset}px` }}>
        <View className='ledger-head__main'>
          <Text className='ledger-head__title'>流水</Text>
          <Text className='ledger-head__sub'>{filtered.length} 笔记录</Text>
        </View>
        <View className='icon-btn' hoverClass='icon-btn--hover' onClick={() => navigate({ name: 'record' })}>
          <Icon name='plus' size={20} />
        </View>
      </View>

      <View className='ledger-filters'>
        <View className='search-bar'>
          <Icon name='search' size={17} />
          <Input
            className='search-bar__input'
            onInput={(event) => setKeyword(event.detail.value)}
            placeholder='搜索备注、商家、分类或金额'
            placeholderClass='search-ph'
            value={keyword}
          />
          {keyword ? (
            <View
              className='icon-btn icon-btn--plain'
              hoverClass='icon-btn--hover'
              onClick={() => setKeyword('')}
            >
              <Icon name='close' size={15} />
            </View>
          ) : null}
        </View>

        <View className='ledger-row'>
          <View className='chip' onClick={() => setBookSheet(true)}>
            <Icon name='book' size={13} />
            <Text className='ledger-row__book'>{currentBook?.name ?? '选择账本'}</Text>
            <Icon name='down' size={12} />
          </View>
        </View>

        {/* 月份分段独占一行：和账本 chip 挤同一条线上时，4 段每段只剩约 50px，
            选中区间后要显示的「25.11-26.02」根本放不下 */}
        <View className='segmented ledger-month-seg'>
          {MONTH_FILTERS.map((item) => (
            <View
              className={`segmented__item ${monthFilter === item.key ? 'segmented__item--active' : ''} ${
                item.key === 'range' ? 'segmented__item--range' : ''
              }`}
              key={item.key}
              onClick={() => (item.key === 'range' ? openRangeSheet() : setMonthFilter(item.key))}
            >
              {item.key === 'range' ? rangeLabel : item.label}
            </View>
          ))}
        </View>

        <View className='chip-row ledger-chip-row'>
          {TYPE_FILTERS.map((item) => (
            <View
              className={`chip ${typeFilter === item.key ? 'chip--active' : ''}`}
              key={item.key}
              onClick={() => setTypeFilter(item.key)}
            >
              {item.label}
            </View>
          ))}
        </View>

        <View className='card ledger-totals'>
          <Text className='ledger-totals__label'>筛选合计</Text>
          <Text className='amount-expense num ledger-totals__num'>
            支 {formatMoney(totals.expense, { digits: 2 })}
          </Text>
          <Text className='amount-income num ledger-totals__num'>
            收 {formatMoney(totals.income, { digits: 2 })}
          </Text>
          <Text className='num ledger-totals__net'>结余 {formatMoney(totals.net, { digits: 2 })}</Text>
        </View>
      </View>

      {filtered.length ? (
        <View className='timeline'>
          {groups.map((monthGroup) => {
            const [year, monthNumber] = monthGroup.month.split('-');
            return (
              <View key={monthGroup.month}>
                <View className='timeline__month'>
                  {year}年{Number(monthNumber)}月
                </View>
                {monthGroup.days.map((dayGroup) => {
                  const income = sumFen(
                    dayGroup.items.filter((t) => t.type === 'income').map((t) => t.amount),
                  );
                  const expense = sumFen(
                    dayGroup.items.filter((t) => t.type === 'expense').map((t) => t.amount),
                  );
                  const label = formatDayGroup(dayGroup.day);
                  return (
                    <View className='day-group' key={dayGroup.day}>
                      <View className='day-head'>
                        <Text className='day-head__day'>{label.day}</Text>
                        <Text>{label.weekday}</Text>
                        <View className='day-head__sum'>
                          {income ? (
                            <Text className='amount-income day-head__sum__item'>
                              收 {formatMoney(income, { digits: 2 })}
                            </Text>
                          ) : null}
                          {expense ? (
                            <Text className='amount-expense day-head__sum__item'>
                              支 {formatMoney(expense, { digits: 2 })}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      <View className='tx-list'>
                        {dayGroup.items.map((tx) => (
                          <TxRow
                            data={data}
                            key={tx.id}
                            onClick={() => navigate({ name: 'record', txId: tx.id })}
                            tx={tx}
                          />
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          action={
            hasFilter ? (
              <View className='btn btn--ghost' onClick={clearFilters}>
                清除筛选条件
              </View>
            ) : (
              <View className='btn btn--primary' onClick={() => navigate({ name: 'record' })}>
                记一笔
              </View>
            )
          }
          description={keyword ? '换个关键词试试' : '当前条件下没有记录'}
          icon='search'
          title='没有找到流水'
        />
      )}

      {filtered.length ? (
        <View
          className='load-more'
          hoverClass={hasMore ? 'load-more--hover' : undefined}
          onClick={hasMore ? page.loadMore : undefined}
        >
          {hasMore ? `上拉加载更多 · 还有 ${remaining} 笔` : `已显示全部 ${filtered.length} 笔`}
        </View>
      ) : null}

      <TabBar active='ledger' />

      {bookSheet ? (
        <Sheet onClose={() => setBookSheet(false)} title='切换账本'>
          <View className='settings-group' style={{ margin: '12px' }}>
            {books.map((item) => (
              <View
                className='settings-row'
                hoverClass='settings-row--hover'
                key={item.id}
                onClick={() => {
                  setBookId(item.id);
                  updateSettings({ lastBookId: item.id });
                  setBookSheet(false);
                }}
              >
                <View className='avatar avatar--sm' style={{ background: item.color }}>
                  <Icon name={item.icon} size={15} />
                </View>
                <View className='settings-row__label'>
                  <Text>{item.name}</Text>
                  {item.archived ? <Text className='badge'>已归档</Text> : null}
                </View>
                {item.id === bookId ? (
                  <Icon name='check' size={16} style={{ color: 'var(--accent-deep)' }} />
                ) : null}
              </View>
            ))}
          </View>
        </Sheet>
      ) : null}

      {rangeDraft ? (
        <Sheet onClose={() => setRangeDraft(null)} title='选择月份区间'>
          <View className='range-sheet'>
            <View className='range-row'>
              <Text className='range-row__label'>起始月份</Text>
              <Picker
                className='range-row__picker'
                end={todayStr()}
                fields='month'
                mode='date'
                onChange={(event) => {
                  const next = String(event.detail.value).slice(0, 7);
                  setRangeDraft({ from: next, to: next > rangeDraft.to ? next : rangeDraft.to });
                }}
                start={`${minMonth}-01`}
                value={`${rangeDraft.from}-01`}
              >
                <View className='range-row__value'>{rangeDraft.from}</View>
              </Picker>
            </View>

            <View className='range-row'>
              <Text className='range-row__label'>结束月份</Text>
              <Picker
                className='range-row__picker'
                end={todayStr()}
                fields='month'
                mode='date'
                onChange={(event) => {
                  const next = String(event.detail.value).slice(0, 7);
                  setRangeDraft({ from: next < rangeDraft.from ? next : rangeDraft.from, to: next });
                }}
                start={`${minMonth}-01`}
                value={`${rangeDraft.to}-01`}
              >
                <View className='range-row__value'>{rangeDraft.to}</View>
              </Picker>
            </View>

            <View className='range-sheet__span'>
              实际包含{' '}
              {monthRangeSpanText(
                resolveMonthRange(rangeDraft.from, rangeDraft.to, data.settings.monthStartDay),
              )}
            </View>

            <View className='range-sheet__actions'>
              <View className='btn btn--ghost' onClick={() => setRangeDraft(null)}>
                取消
              </View>
              <View className='btn btn--primary' onClick={confirmRange}>
                确定
              </View>
            </View>
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}
