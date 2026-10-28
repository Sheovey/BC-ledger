import { useMemo } from 'react';
import { View, Text } from '@tarojs/components';
import { Icon } from '@/components/Icon';
import { TabBar } from '@/components/TabBar';
import { TxRow, EmptyState } from '@/components/TxRow';
import {
  buildCategoryMap,
  getBook,
  rangeTransactions,
  summarize,
  totalAssets,
  visibleBooks,
} from '@/store/selectors';
import { useStore } from '@/store/useStore';
import { formatMoney } from '@/utils/money';
import { resolveRange, todayStr } from '@/utils/date';
import { navigate } from '@/router';
import './index.scss';

/**
 * 首页。与 Web 版（ledger-app/src/pages/HomePage.tsx）逐段对应，三处改写：
 * 1. div/span → View/Text（小程序没有 div；Text 内不能嵌套 View，含图标的容器一律用 View）
 * 2. button → View（小程序原生 button 自带边框、居中、hover 样式，这里只需可点击容器）
 * 3. navigate/resetTo 改走 router（Web 版是自建路由栈，小程序用原生页面栈）
 */
export default function HomePage() {
  const data = useStore((s) => s.data);
  const updateSettings = useStore((s) => s.updateSettings);

  const book = getBook(data);
  const currency = data.settings.currency;

  const stats = useMemo(() => {
    if (!book) return null;
    const txs = data.txs.filter((tx) => tx.bookId === book.id);
    const monthRange = resolveRange('month', todayStr(), data.settings.monthStartDay);
    const monthTxs = rangeTransactions(txs, monthRange);
    const totals = summarize(monthTxs);
    const accounts = data.accounts.filter((a) => a.bookId === book.id && !a.archived);
    const assets = totalAssets(accounts, txs);
    const recent = [...txs]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 5);
    return { totals, assets, recent, monthLabel: monthRange.label };
  }, [data, book]);

  if (!book || !stats) {
    return (
      <View className='shell'>
        <EmptyState title='还没有账本' description='先创建一个账本开始记账' />
        <TabBar active='home' />
      </View>
    );
  }

  const books = visibleBooks(data).filter((b) => !b.archived);
  const { rootOf } = buildCategoryMap(data.categories);
  const topCategory = (() => {
    const monthRange = resolveRange('month', todayStr(), data.settings.monthStartDay);
    const expenses = rangeTransactions(
      data.txs.filter((tx) => tx.bookId === book.id),
      monthRange,
    ).filter((tx) => tx.type === 'expense');
    const buckets = new Map<string, number>();
    for (const tx of expenses) {
      const root = rootOf(tx.categoryId);
      if (!root) continue;
      buckets.set(root.name, (buckets.get(root.name) ?? 0) + tx.amount);
    }
    const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0] ? { name: sorted[0][0], amount: sorted[0][1] } : null;
  })();

  return (
    <View className='shell'>
      <View className='home-hero'>
        <View className='home-greeting'>
          {new Date().getMonth() + 1} 月 · {book.name}
        </View>
        <View className='home-total'>
          <Text className='home-total__value num'>
            {formatMoney(Math.abs(stats.assets.net), { digits: 2 })}
          </Text>
          <Text className='home-total__unit'>
            {stats.assets.net >= 0 ? '净资产（元）' : '净欠款（元）'}
          </Text>
        </View>

        <View className='home-stat-row'>
          <View className='home-stat'>
            <View className='home-stat__label'>本月支出</View>
            <View className='home-stat__value num amount-expense'>
              {formatMoney(stats.totals.expense, { digits: 2 })}
            </View>
          </View>
          <View className='home-stat'>
            <View className='home-stat__label'>本月收入</View>
            <View className='home-stat__value num amount-income'>
              {formatMoney(stats.totals.income, { digits: 2 })}
            </View>
          </View>
          <View className='home-stat'>
            <View className='home-stat__label'>本月结余</View>
            <View className='home-stat__value num'>
              {formatMoney(stats.totals.net, { digits: 2 })}
            </View>
          </View>
        </View>

        <View
          className='search-bar'
          onClick={() => navigate({ name: 'ledger' })}
          style={{ marginTop: 14, width: '100%' }}
        >
          <Icon name='search' size={17} />
          <Text className='search-bar__ph'>搜索备注、商家、分类或金额</Text>
          <Icon name='forward' size={16} />
        </View>
      </View>

      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>我的账本</Text>
          <View className='text-btn' hoverClass='text-btn--hover' onClick={() => navigate({ name: 'books' })}>
            全部账本
          </View>
        </View>
        {books.slice(0, 3).map((item) => {
          const itemTxs = data.txs.filter((tx) => tx.bookId === item.id);
          const monthRange = resolveRange('month', todayStr(), data.settings.monthStartDay);
          const totals = summarize(rangeTransactions(itemTxs, monthRange));
          const isCurrent = item.id === book.id;
          return (
            <View
              className='book-card'
              key={item.id}
              // 点卡片 = 切换到该账本（Web 版是进账本详情页）。
              // 手机上「换账本记账」是高频动作，多跳一层的代价比省下的信息更值钱；
              // 账本的重命名/归档/删除都收在「我的 → 账本管理」里。
              onClick={() => {
                if (isCurrent) return;
                updateSettings({ lastBookId: item.id });
              }}
            >
              <View className='book-card__icon' style={{ background: item.color }}>
                <Icon name={item.icon} size={21} />
              </View>
              <View className='book-card__main'>
                <View className='home-book__name-row'>
                  <Text className='book-card__name'>{item.name}</Text>
                  {isCurrent ? <Text className='badge home-book__badge'>当前</Text> : null}
                </View>
                <Text className='book-card__meta'>
                  本月支出 {formatMoney(totals.expense, { digits: 2 })} · {itemTxs.length}{' '}
                  笔记录
                </Text>
              </View>
              <Icon
                className='row__chevron'
                name={isCurrent ? 'check' : 'forward'}
                size={17}
              />
            </View>
          );
        })}
        <View
          className='btn btn--ghost btn--block'
          onClick={() => navigate({ name: 'books' })}
          style={{ marginTop: 10 }}
        >
          <Icon name='plus' size={16} />
          新建账本
        </View>
      </View>

      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>快捷入口</Text>
        </View>
        <View className='quick-grid'>
          {[
            { label: '预算', icon: 'budget', route: { name: 'budget' as const } },
            { label: '项目', icon: 'project', route: { name: 'projects' as const } },
            { label: '模板', icon: 'template', route: { name: 'templates' as const } },
            { label: '分类', icon: 'tag', route: { name: 'categories' as const } },
          ].map((item) => (
            <View
              className='card quick-cell'
              key={item.label}
              onClick={() => navigate(item.route)}
            >
              <Icon name={item.icon} size={20} style={{ color: 'var(--accent-deep)' }} />
              <Text className='quick-cell__label'>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {topCategory ? (
        <View className='section'>
          <View className='section__head'>
            <Text className='section__title'>本月最大支出</Text>
            <Text className='section__hint'>{stats.monthLabel}</Text>
          </View>
          <View className='card top-cat'>
            <View className='avatar top-cat__avatar'>
              <Icon name='chart' size={19} />
            </View>
            <View className='top-cat__main'>
              <View className='top-cat__name'>{topCategory.name}</View>
              <Text className='top-cat__meta'>
                占本月支出{' '}
                {stats.totals.expense
                  ? ((topCategory.amount / stats.totals.expense) * 100).toFixed(1)
                  : '0.0'}
                %
              </Text>
            </View>
            <View className='num top-cat__amount'>
              {currency}
              {formatMoney(topCategory.amount, { digits: 2 })}
            </View>
          </View>
        </View>
      ) : null}

      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>最近流水</Text>
          <View className='text-btn' hoverClass='text-btn--hover' onClick={() => navigate({ name: 'ledger' })}>
            查看全部
          </View>
        </View>
        {stats.recent.length ? (
          <View className='tx-list'>
            {stats.recent.map((tx) => (
              <TxRow
                data={data}
                key={tx.id}
                onClick={() => navigate({ name: 'record', txId: tx.id })}
                tx={tx}
              />
            ))}
          </View>
        ) : (
          <View className='card'>
            <EmptyState
              description='点击底部「记一笔」开始记录第一笔收支'
              icon='edit'
              title='还没有任何流水'
            />
          </View>
        )}
      </View>

      <TabBar active='home' />
    </View>
  );
}
