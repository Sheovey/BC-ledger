import { View, Text } from '@tarojs/components';
import type { LedgerData, Tx } from '@/types';
import { Icon } from './Icon';
import { buildCategoryMap } from '@/store/selectors';
import { formatMoney } from '@/utils/money';
import { pad2, parseDateStr } from '@/utils/date';

/**
 * 流水行。与 Web 版逻辑完全一致，仅替换渲染原语：
 * div/span → View/Text，button → View（小程序原生 button 带默认边框与居中样式，
 * 这里只把它当可点击容器用，用 View + onClick 更可控）。
 */

interface TxRowProps {
  tx: Tx;
  data: LedgerData;
  onClick?: () => void;
  /**
   * 显示日期。流水页按日分组，日期在组标题上，行内只需时间；
   * 统计页的明细跨天混排，只显示 HH:mm 会分不清是哪天，所以要开这个开关。
   */
  showDate?: boolean;
}

export function TxRow({ tx, data, onClick, showDate = false }: TxRowProps) {
  const { byId, rootOf } = buildCategoryMap(data.categories);
  const root = rootOf(tx.categoryId);
  const category = tx.categoryId ? byId.get(tx.categoryId) : undefined;
  const account = data.accounts.find((a) => a.id === tx.accountId);
  const target = data.accounts.find((a) => a.id === tx.toAccountId);
  const time = parseDateStr(tx.occurredAt);

  let title = category?.name ?? '未分类';
  let icon = root?.icon ?? 'other';
  let color = root?.color ?? '#c3c7d1';
  let amountClass = 'amount-expense';
  let prefix = '-';

  if (tx.type === 'income') {
    title = category?.name ?? '收入';
    amountClass = 'amount-income';
    prefix = '+';
  } else if (tx.type === 'transfer') {
    title = '转账';
    icon = 'forward';
    color = '#8a94a6';
    amountClass = '';
    prefix = '';
  } else if (tx.type === 'balance') {
    title = '余额调整';
    icon = 'wallet';
    color = '#8a94a6';
    amountClass = '';
    prefix = tx.amount >= 0 ? '+' : '';
  }

  const metaParts: string[] = [];
  if (tx.type === 'transfer') {
    metaParts.push(`${account?.name ?? '未知'} → ${target?.name ?? '未知'}`);
  } else if (account) {
    metaParts.push(account.name);
  }
  if (tx.merchant) metaParts.push(tx.merchant);
  if (tx.note) metaParts.push(tx.note);

  const stamp = `${showDate ? `${pad2(time.getMonth() + 1)}-${pad2(time.getDate())} ` : ''}${pad2(
    time.getHours(),
  )}:${pad2(time.getMinutes())}`;

  return (
    <View className='tx-row' hoverClass={onClick ? 'tx-row--hover' : undefined} onClick={onClick}>
      <View className='avatar' style={{ background: color }}>
        <Icon name={icon} size={19} />
      </View>
      <View className='tx-row__body'>
        <Text className='tx-row__name'>{title}</Text>
        <Text className='tx-row__note'>
          {metaParts.length ? metaParts.join(' · ') : '无备注'}
        </Text>
      </View>
      <View className='tx-row__side'>
        <Text className={`tx-row__amount ${amountClass}`}>
          {prefix}
          {formatMoney(Math.abs(tx.amount), { digits: 2 })}
        </Text>
        <Text className='tx-row__time'>{stamp}</Text>
      </View>
    </View>
  );
}

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon = 'list', title, description, action }: EmptyStateProps) {
  return (
    <View className='empty'>
      <View className='empty__icon'>
        <Icon name={icon} size={24} />
      </View>
      <View className='empty__title'>{title}</View>
      {description ? <View className='empty__desc'>{description}</View> : null}
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}
