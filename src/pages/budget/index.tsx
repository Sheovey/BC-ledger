import { useMemo, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { Sheet } from '@/components/Sheet';
import { EmptyState } from '@/components/TxRow';
import { analyzeBudget, categoryTree, getBook, rangeTransactions } from '@/store/selectors';
import { fenToYuanString, formatMoney, parseAmountToFen } from '@/utils/money';
import { monthKey, resolveRange, todayStr } from '@/utils/date';
import './index.scss';

/**
 * 预算（小程序版）。对应 Web 版 BudgetPage.tsx。
 *
 * 改动点：
 * 1. 预算一律按月通用（month = '*'），不提供单月预算的编辑入口——
 *    Web 版也只写入 '*'，单月预算只有演示数据在用，没必要在手机上摆一排月份切换。
 * 2. 统计口径为「当前账单月的实际支出」，月起始日跟随设置页。
 * 3. 分类预算只允许挂在一级分类上：二级分类各自设限，月底对账时口径会碎掉。
 */

export default function BudgetPage() {
  const data = useStore((s) => s.data);
  const upsertBudget = useStore((s) => s.upsertBudget);
  const deleteBudget = useStore((s) => s.deleteBudget);

  const book = getBook(data);
  const bookId = book?.id ?? '';
  const currency = data.settings.currency;

  const tree = useMemo(() => categoryTree(data.categories, 'expense'), [data.categories]);

  const budget = useMemo(() => {
    if (!book) return null;
    const range = resolveRange('month', todayStr(), data.settings.monthStartDay);
    const monthTxs = rangeTransactions(
      data.txs.filter((tx) => tx.bookId === book.id),
      range,
    );
    return analyzeBudget(data, book.id, monthTxs, monthKey(todayStr()));
  }, [data, book]);

  const [sheet, setSheet] = useState<'total' | 'category' | null>(null);
  const [totalText, setTotalText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categoryText, setCategoryText] = useState('');

  const openTotal = () => {
    setTotalText(budget?.totalBudget ? fenToYuanString(budget.totalBudget) : '');
    setSheet('total');
  };

  const saveTotal = () => {
    const fen = parseAmountToFen(totalText || '0');
    if (fen === null || fen < 0) {
      toast('请输入正确的预算金额', 'warn');
      return;
    }
    upsertBudget({ bookId, month: '*', categoryId: null, amount: fen });
    toast(fen === 0 ? '已取消总预算' : '总预算已保存');
    setSheet(null);
  };

  const saveCategory = () => {
    if (!categoryId) {
      toast('请选择分类', 'warn');
      return;
    }
    const fen = parseAmountToFen(categoryText || '0');
    if (fen === null || fen <= 0) {
      toast('请输入预算金额', 'warn');
      return;
    }
    upsertBudget({ bookId, month: '*', categoryId, amount: fen });
    toast('分类预算已保存');
    setSheet(null);
    setCategoryId('');
    setCategoryText('');
  };

  if (!book || !budget) {
    return (
      <View className='shell shell--plain'>
        <PageHead title='预算' />
        <EmptyState description='请先在「我的 → 账本管理」里创建账本' title='暂无账本' />
      </View>
    );
  }

  const over = budget.over > 0;
  const usage = budget.totalBudget ? Math.min(budget.usage, 100) : 0;
  const remaining = budget.totalBudget - budget.totalSpent;

  return (
    <View className='shell shell--plain'>
      <PageHead title='预算' subtitle={book.name} />

      <View className='section budget-top'>
        <View className='card budget-total'>
          <View className='budget-total__head'>
            <Text className='budget-total__label'>月度总预算</Text>
            <View className='text-btn' hoverClass='text-btn--hover' onClick={openTotal}>
              {budget.totalBudget ? '修改' : '设置'}
            </View>
          </View>
          <View className='num budget-total__amount'>
            {budget.totalBudget
              ? `${currency}${formatMoney(budget.totalBudget, { digits: 2 })}`
              : '未设置'}
          </View>

          {budget.totalBudget ? (
            <View>
              <View className='progress budget-progress'>
                <View
                  className={`progress__fill ${over ? 'progress__fill--over' : ''}`}
                  style={{ width: `${usage}%` }}
                />
              </View>
              <View className='budget-total__foot'>
                <Text>
                  已支出 {currency}
                  {formatMoney(budget.totalSpent, { digits: 2 })}
                </Text>
                <Text className={over ? 'amount-expense' : 'budget-muted'}>
                  {over
                    ? `超支 ${formatMoney(budget.over, { digits: 2 })}`
                    : `剩余 ${formatMoney(remaining, { digits: 2 })}`}
                </Text>
              </View>
            </View>
          ) : (
            <Text className='budget-hint'>
              设置后会在本月超出预算时提醒。预算按月通用，不区分具体月份。
            </Text>
          )}
        </View>
      </View>

      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>分类预算</Text>
          <View className='text-btn' hoverClass='text-btn--hover' onClick={() => setSheet('category')}>
            添加
          </View>
        </View>

        {budget.categoryRows.length === 0 ? (
          <EmptyState description='为餐饮、购物等分类单独设定上限' icon='budget' title='还没有分类预算' />
        ) : (
          budget.categoryRows.map((row) => {
            const rowOver = row.over > 0;
            return (
              <View className='card budget-row' key={row.id}>
                <View className='budget-row__head'>
                  <View className='legend-dot' style={{ background: row.color }} />
                  <Text className='budget-row__name'>{row.categoryName}</Text>
                  <Text className='num budget-row__value'>
                    {formatMoney(row.spent, { digits: 2 })} / {formatMoney(row.budget, { digits: 2 })}
                  </Text>
                  <View
                    className='icon-btn icon-btn--plain budget-row__del' hoverClass='icon-btn--hover'
                    onClick={() => {
                      const target = data.budgets.find(
                        (b) => b.bookId === bookId && b.categoryId === row.id,
                      );
                      if (target) {
                        deleteBudget(target.id);
                        toast('已删除该分类预算');
                      }
                    }}
                  >
                    <Icon name='trash' size={15} />
                  </View>
                </View>
                <View className='progress budget-progress'>
                  <View
                    className={`progress__fill ${rowOver ? 'progress__fill--over' : ''}`}
                    style={{ width: `${Math.min(row.usage, 100)}%`, background: rowOver ? undefined : row.color }}
                  />
                </View>
                <Text className={`budget-row__foot ${rowOver ? 'amount-expense' : 'budget-muted'}`}>
                  {rowOver
                    ? `超支 ${formatMoney(row.over, { digits: 2 })}（${row.usage.toFixed(0)}%）`
                    : `剩余 ${formatMoney(row.budget - row.spent, { digits: 2 })}（已用 ${row.usage.toFixed(0)}%）`}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {sheet === 'total' ? (
        <Sheet onClose={() => setSheet(null)} title='月度总预算'>
          <View className='budget-form'>
            <View className='settings-group__title budget-form__label'>金额</View>
            <Input
              className='input'
              onInput={(event) => setTotalText(event.detail.value)}
              placeholder='0.00，填 0 表示取消预算'
              placeholderClass='budget-ph'
              type='digit'
              value={totalText}
            />
            <Text className='budget-form__hint'>
              按月通用，不区分具体月份；统计口径为当前账单月的支出合计。
            </Text>
            <View className='btn btn--primary btn--block budget-submit' onClick={saveTotal}>
              保存
            </View>
          </View>
        </Sheet>
      ) : null}

      {sheet === 'category' ? (
        <Sheet onClose={() => setSheet(null)} title='添加分类预算'>
          <View className='budget-form'>
            <View className='settings-group__title budget-form__label'>选择分类</View>
            <View className='budget-cats'>
              {tree.map((category) => (
                <View
                  className={`chip budget-chip ${categoryId === category.id ? 'chip--active' : ''}`}
                  key={category.id}
                  onClick={() => setCategoryId(category.id)}
                >
                  <View className='legend-dot' style={{ background: category.color }} />
                  <Text>{category.name}</Text>
                </View>
              ))}
            </View>

            <View className='settings-group__title budget-form__label budget-form__label--gap'>预算金额</View>
            <Input
              className='input'
              onInput={(event) => setCategoryText(event.detail.value)}
              placeholder='0.00'
              placeholderClass='budget-ph'
              type='digit'
              value={categoryText}
            />
            <Text className='budget-form__hint'>
              同一分类已有预算时会直接覆盖，不会新增一条。
            </Text>
            <View className='btn btn--primary btn--block budget-submit' onClick={saveCategory}>
              保存
            </View>
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}
