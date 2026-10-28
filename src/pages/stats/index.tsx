import { useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import type { DateRange, RangeKind, StatDimension } from '@/types';
import { useStore } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { TabBar } from '@/components/TabBar';
import { DonutChart } from '@/components/DonutChart';
import { EmptyState, TxRow } from '@/components/TxRow';
import { useNavMetrics } from '@/hooks/useNavMetrics';
import { useProgressiveList } from '@/hooks/useProgressiveList';
import {
  getBook,
  groupByDimension,
  monthlySeries,
  rangeTransactions,
  sortTxsDesc,
  summarize,
  txsOfGroup,
} from '@/store/selectors';
import { resolveRange, shiftRange, todayStr } from '@/utils/date';
import { formatMoney, formatPercent } from '@/utils/money';
import { navigate } from '@/router';
import './index.scss';

/**
 * 统计图表页（小程序版）。对应 Web 版 StatsPage.tsx。
 *
 * 改写点：
 * 1. 环形图换实现（DonutChart 从 SVG 改 Canvas），这是唯一必须重写的可视化。
 * 2. 顶部自绘导航栏：Web 版有副标题「账本 · 区间」和右侧饼图/条形图切换按钮。
 * 3. div/span/button → View/Text；内联 style 尽量抽成类，
 *    减少小程序 setData 里的样式对象比较开销。
 * 4. chip-row 换行布局：Web 版是横向滚动，小程序横向滚动容器手感差。
 */

const DIMENSIONS: Array<{ key: StatDimension; label: string }> = [
  { key: 'category', label: '分类' },
  { key: 'account', label: '账户' },
  { key: 'project', label: '项目' },
  { key: 'merchant', label: '商家' },
];

const RANGE_TABS: Array<{ key: RangeKind; label: string }> = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
];

export default function StatsPage() {
  const data = useStore((s) => s.data);
  const nav = useNavMetrics();
  const book = getBook(data);

  const [dimension, setDimension] = useState<StatDimension>('category');
  const [flow, setFlow] = useState<'expense' | 'income'>('expense');
  const [rangeKind, setRangeKind] = useState<RangeKind>('month');
  const [range, setRange] = useState<DateRange>(() =>
    resolveRange('month', todayStr(), data.settings.monthStartDay),
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [view, setView] = useState<'pie' | 'bar'>('pie');
  /** 明细面板是否展开。再点一次已选中的行可以折叠，避免页面被撑得太长 */
  const [detailOpen, setDetailOpen] = useState(true);

  const { items, total, totals, series, flowTxs } = useMemo(() => {
    // 先排序：明细面板要按时间倒序展示，groupByDimension 本身不关心顺序
    const bookTxs = sortTxsDesc(data.txs.filter((tx) => tx.bookId === book?.id));
    const inRange = rangeTransactions(bookTxs, range);
    const flowTxs = inRange.filter((tx) => tx.type === flow);
    const grouped = groupByDimension(flowTxs, dimension, data, 10);
    return {
      items: grouped,
      total: flowTxs.reduce((acc, tx) => acc + tx.amount, 0),
      totals: summarize(inRange),
      series: monthlySeries(bookTxs, 6, data.settings),
      // 暴露出去给明细用：原来是 memo 内部局部变量，外面拿不到
      flowTxs,
    };
  }, [data, book, range, flow, dimension]);

  const active = items.find((item) => item.key === activeKey) ?? items[0];

  /** 选中分组下的全部流水。`__rest__` 靠 restKeys 才能筛出来 */
  const detailTxs = useMemo(
    () =>
      active && detailOpen
        ? txsOfGroup(flowTxs, dimension, data, active.key, active.restKeys)
        : [],
    [flowTxs, dimension, data, active, detailOpen],
  );

  const detail = useProgressiveList(
    detailTxs.length,
    10,
    `${active?.key ?? ''}|${range.start}|${range.end}|${dimension}|${flow}|${detailOpen ? 1 : 0}`,
  );

  /** 点分组：换分组就自动展开；点的还是当前分组，则折叠/展开面板 */
  const selectItem = (key: string) => {
    if (key === active?.key) {
      setDetailOpen((open) => !open);
      return;
    }
    setActiveKey(key);
    setDetailOpen(true);
  };

  /**
   * 换视角（维度 / 收支 / 区间 / 翻页）时复位选中。
   * 必须连 detailOpen 一起复位：只清 activeKey 的话 active 会回落到 items[0]，
   * 于是第一行顶着「展开中」的样式却没有明细面板 —— 又是一种高亮与内容脱节的错位。
   */
  const resetSelection = () => {
    setActiveKey(null);
    setDetailOpen(true);
  };
  const currency = data.settings.currency;
  const maxAmount = items.reduce((acc, item) => Math.max(acc, item.amount), 0);
  const maxMonth = series.reduce((acc, item) => Math.max(acc, item.income, item.expense), 0);

  const changeRangeKind = (kind: RangeKind) => {
    setRangeKind(kind);
    setRange(resolveRange(kind, todayStr(), data.settings.monthStartDay));
    resetSelection();
  };

  const move = (direction: -1 | 1) => {
    setRange((prev) => shiftRange(prev, direction, data.settings.monthStartDay));
    resetSelection();
  };

  if (!book) {
    return (
      <View className='shell'>
        <EmptyState description='请先创建账本' title='暂无数据' />
        <TabBar active='stats' />
      </View>
    );
  }

  const dimensionLabel = DIMENSIONS.find((d) => d.key === dimension)?.label ?? '分类';

  return (
    <View className='shell'>
      <View style={{ height: `${nav.statusBar}px` }} />
      <View className='stats-head' style={{ paddingRight: `${nav.rightInset}px` }}>
        <View className='stats-head__main'>
          <Text className='stats-head__title'>统计图表</Text>
          <Text className='stats-head__sub'>
            {book.name} · {range.label}
          </Text>
        </View>
        <View className='icon-btn' hoverClass='icon-btn--hover' onClick={() => setView(view === 'pie' ? 'bar' : 'pie')}>
          <Icon name={view === 'pie' ? 'chart' : 'pie'} size={19} />
        </View>
      </View>

      <View className='stats-filters'>
        <View className='chip-row stats-chip-row'>
          {DIMENSIONS.map((item) => (
            <View
              className={`chip ${dimension === item.key ? 'chip--active' : ''}`}
              key={item.key}
              onClick={() => {
                setDimension(item.key);
                resetSelection();
              }}
            >
              {item.label}
            </View>
          ))}
        </View>

        <View className='segmented stats-segmented'>
          <View
            className={`segmented__item ${flow === 'expense' ? 'segmented__item--active' : ''}`}
            onClick={() => {
              setFlow('expense');
              resetSelection();
            }}
          >
            支出
          </View>
          <View
            className={`segmented__item ${flow === 'income' ? 'segmented__item--active' : ''}`}
            onClick={() => {
              setFlow('income');
              resetSelection();
            }}
          >
            收入
          </View>
        </View>
      </View>

      <View className='stats-range'>
        <View className='stats-range__arrow' onClick={() => move(-1)}>
          <Icon name='back' size={16} />
        </View>
        <View className='stats-range__mid'>
          <View className='stats-range__label'>{range.label}</View>
          <View className='stats-range__tabs'>
            {RANGE_TABS.map((tab) => (
              <View
                className={`chip chip--sm ${rangeKind === tab.key ? 'chip--active' : ''}`}
                key={tab.key}
                onClick={() => changeRangeKind(tab.key)}
              >
                {tab.label}
              </View>
            ))}
          </View>
        </View>
        <View className='stats-range__arrow' onClick={() => move(1)}>
          <Icon name='forward' size={16} />
        </View>
      </View>

      {total > 0 ? (
        <View>
          {view === 'pie' ? (
            <View className='donut-wrap'>
              <DonutChart
                activeKey={active?.key ?? null}
                centerLabel={flow === 'expense' ? '总支出' : '总收入'}
                currency={currency}
                items={items}
                onSelect={(key) => {
                  // 圆环只切换选中，不折叠：点圆环的意图是「看这个分类」，
                  // 结果把面板收起会很莫名其妙。折叠留给再点一次排行行。
                  setActiveKey(key);
                  setDetailOpen(true);
                }}
                total={total}
              />
              {active ? (
                <View className='donut-caption'>
                  <View className='donut-caption__row'>
                    <Text className='donut-caption__name'>{active.name}</Text>
                    <Text className='donut-caption__amount num'>
                      {currency}
                      {formatMoney(active.amount, { digits: 2 })}
                    </Text>
                    <Text className='donut-caption__percent'>({formatPercent(active.percent, 1)})</Text>
                  </View>
                  <View className='donut-caption__hint'>
                    共 {active.count} 笔 · 点圆环换分类，点排行看明细
                  </View>
                </View>
              ) : null}
            </View>
          ) : (
            <View className='bar-list'>
              {items.map((item) => (
                <View className='bar-item' key={item.key}>
                  <View className='bar-item__head'>
                    <View className='bar-item__name'>
                      <Text>{item.name}</Text>
                      <Text className='bar-item__percent'>{formatPercent(item.percent, 1)}</Text>
                    </View>
                    <Text className='bar-item__value num'>
                      {currency}
                      {formatMoney(item.amount, { digits: 2 })}
                    </Text>
                  </View>
                  <View className='bar-track'>
                    <View
                      className='bar-fill'
                      style={{
                        background: item.color,
                        width: `${maxAmount ? (item.amount / maxAmount) * 100 : 0}%`,
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          <View className='section'>
            <View className='section__head'>
              <Text className='section__title'>{dimensionLabel}排行</Text>
              <Text className='section__hint'>
                共 {currency}
                {formatMoney(total, { digits: 2 })}
              </Text>
            </View>
            <View className='card card--clip'>
              {items.map((item, index) => (
                <View className='rank-group' key={item.key}>
                  <View
                    className={`rank-row ${
                      active?.key === item.key && detailOpen ? 'rank-row--open' : ''
                    }`}
                    hoverClass='rank-row--hover'
                    onClick={() => selectItem(item.key)}
                  >
                    <Text className='rank-index num'>{index + 1}</Text>
                    <View className='legend-dot' style={{ background: item.color }} />
                    <View className='legend-name'>
                      <Text>{item.name}</Text>
                      <Text className='legend-name__count'>{item.count} 笔</Text>
                    </View>
                    <Text className='legend-percent'>{formatPercent(item.percent, 1)}</Text>
                    <Text className='legend-amount num'>{formatMoney(item.amount, { digits: 2 })}</Text>
                  </View>

                  {/* 明细面板：类名刻意避开 .rank-row / .rank-row--open，
                      否则排行行数断言与「展开态唯一」断言都会失准 */}
                  {active?.key === item.key && detailOpen && detailTxs.length ? (
                    <View className='rank-detail'>
                      {detailTxs.slice(0, detail.count).map((tx) => (
                        <TxRow
                          data={data}
                          key={tx.id}
                          onClick={() => navigate({ name: 'record', txId: tx.id })}
                          showDate
                          tx={tx}
                        />
                      ))}
                      {detail.hasMore ? (
                        <View
                          className='rank-detail__more'
                          hoverClass='rank-detail__more--hover'
                          onClick={detail.loadMore}
                        >
                          展开更多（还有 {detailTxs.length - detail.count} 笔）
                        </View>
                      ) : (
                        <View className='rank-detail__end'>已显示全部 {detailTxs.length} 笔</View>
                      )}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : (
        <View className='card stats-empty-card'>
          <EmptyState
            description={`${range.label}没有${flow === 'expense' ? '支出' : '收入'}记录`}
            icon='chart'
            title='暂无统计数据'
          />
        </View>
      )}

      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>近 6 个月趋势</Text>
          <View className='section__hint stats-legend'>
            <Text className='amount-expense'>■</Text>
            <Text className='stats-legend__label'>支出</Text>
            <Text className='amount-income'>■</Text>
            <Text className='stats-legend__label'>收入</Text>
          </View>
        </View>
        <View className='chart-card'>
          <View className='month-bars'>
            {series.map((item) => (
              <View className='month-bar' key={item.month}>
                <View className='month-bar__col'>
                  <View
                    className='month-bar__fill'
                    style={{
                      background: 'var(--expense)',
                      height: `${maxMonth ? (item.expense / maxMonth) * 100 : 0}%`,
                    }}
                  />
                  <View
                    className='month-bar__fill'
                    style={{
                      background: 'var(--income)',
                      height: `${maxMonth ? (item.income / maxMonth) * 100 : 0}%`,
                    }}
                  />
                </View>
                <Text className='month-bar__label'>{item.label}</Text>
              </View>
            ))}
          </View>
          <View className='month-bars__foot'>
            合计支出 {currency}
            {formatMoney(totals.expense, { digits: 2 })} · 收入 {currency}
            {formatMoney(totals.income, { digits: 2 })}
          </View>
        </View>
      </View>

      <TabBar active='stats' />
    </View>
  );
}
