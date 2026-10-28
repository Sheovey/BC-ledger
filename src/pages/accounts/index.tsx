import { useMemo, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import type { Account, AccountType } from '@/types';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { EmptyState } from '@/components/TxRow';
import { useNavMetrics } from '@/hooks/useNavMetrics';
import { accountBalance, getBook, totalAssets } from '@/store/selectors';
import { fenToYuanString, formatMoney, parseAmountToFen } from '@/utils/money';
import { back } from '@/router';
import './index.scss';

/**
 * 账户页（小程序版）。对应 Web 版 AccountsPage.tsx。
 *
 * 改写点：
 * 1. 顶部自绘导航栏：返回键 + 「账户」+ 账本名副标题 + 右侧加号，
 *    右侧要让开胶囊按钮（useNavMetrics.rightInset）。
 * 2. <input> → Taro <Input>（onChange 取 e.target.value 改成 onInput 取 e.detail.value）。
 * 3. 「计入总资产」开关原先用 button + 内联 style 画，改成 .switch 类（见 styles/mp-extras.scss）。
 * 4. 账户行的 archived 淡化也用内联 style，这里改成类，避免每次渲染传样式对象。
 *
 * 文案调整（合规，非风格选择）：
 * 账户类型里原来的第 6 项（invest）已改名为「资产账户」：原词属于需要资质审批的
 * 表述，个人主体记账工具在备案和审核阶段容易被要求补充材料，去掉不影响功能。
 */

const ACCOUNT_TYPES: Array<{ key: AccountType; label: string; icon: string; color: string }> = [
  { key: 'cash', label: '现金', icon: 'cash', color: '#f0a848' },
  { key: 'debit', label: '储蓄卡', icon: 'card', color: '#7b8ff7' },
  { key: 'credit', label: '信用卡', icon: 'credit', color: '#e8608c' },
  { key: 'alipay', label: '支付宝', icon: 'alipay', color: '#3d8bfd' },
  { key: 'wechat', label: '微信钱包', icon: 'wechat', color: '#3fb96b' },
  { key: 'invest', label: '资产账户', icon: 'invest', color: '#c9723f' },
  { key: 'other', label: '其他', icon: 'wallet', color: '#8a94a6' },
];

export default function AccountsPage() {
  const data = useStore((s) => s.data);
  const addAccount = useStore((s) => s.addAccount);
  const updateAccount = useStore((s) => s.updateAccount);
  const deleteAccount = useStore((s) => s.deleteAccount);
  const nav = useNavMetrics();

  const book = getBook(data);
  const bookId = book?.id ?? '';
  const accounts = useMemo(
    () => data.accounts.filter((a) => a.bookId === bookId).sort((a, b) => a.sort - b.sort),
    [data.accounts, bookId],
  );
  const assets = useMemo(
    () => totalAssets(accounts.filter((a) => !a.archived), data.txs),
    [accounts, data.txs],
  );

  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('debit');
  const [balanceText, setBalanceText] = useState('');
  const [includeInTotal, setIncludeInTotal] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const openNew = () => {
    setEditing('new');
    setName('');
    setType('debit');
    setBalanceText('');
    setIncludeInTotal(true);
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    setName(account.name);
    setType(account.type);
    setBalanceText(fenToYuanString(account.initialBalance));
    setIncludeInTotal(account.includeInTotal);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入账户名称', 'warn');
      return;
    }
    const fen = parseAmountToFen(balanceText || '0');
    if (fen === null) {
      toast('初始余额格式不正确', 'warn');
      return;
    }
    const preset = ACCOUNT_TYPES.find((item) => item.key === type) ?? ACCOUNT_TYPES[0];
    if (editing === 'new') {
      addAccount({
        bookId,
        name: trimmed,
        type,
        icon: preset.icon,
        color: preset.color,
        initialBalance: fen,
        includeInTotal,
      });
      toast('账户已创建');
    } else if (editing) {
      updateAccount(editing.id, {
        name: trimmed,
        type,
        icon: preset.icon,
        color: preset.color,
        initialBalance: fen,
        includeInTotal,
      });
      toast('账户已更新');
    }
    setEditing(null);
  };

  return (
    <View className='shell shell--plain'>
      <View style={{ height: `${nav.statusBar}px` }} />
      <View className='acc-head' style={{ paddingRight: `${nav.rightInset}px` }}>
        <View className='icon-btn' hoverClass='icon-btn--hover' onClick={() => back()}>
          <Icon name='back' size={20} />
        </View>
        <View className='acc-head__main'>
          <Text className='acc-head__title'>账户</Text>
          {book?.name ? <Text className='acc-head__sub'>{book.name}</Text> : null}
        </View>
        <View className='icon-btn' hoverClass='icon-btn--hover' onClick={openNew}>
          <Icon name='plus' size={20} />
        </View>
      </View>

      <View className='book-hero acc-hero'>
        <View className='book-hero__label'>净资产</View>
        <View className='book-hero__amount num'>
          {data.settings.currency}
          {formatMoney(assets.net, { digits: 2 })}
        </View>
        <View className='book-hero__foot'>
          <Text>
            资产 <Text className='num acc-hero__strong'>{formatMoney(assets.assets, { digits: 2 })}</Text>
          </Text>
          <Text>
            负债 <Text className='num acc-hero__strong'>{formatMoney(assets.liabilities, { digits: 2 })}</Text>
          </Text>
        </View>
      </View>

      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>账户列表</Text>
          <Text className='section__hint'>{accounts.length} 个</Text>
        </View>
        {accounts.length === 0 ? (
          <EmptyState description='添加现金、储蓄卡或第三方支付账户' icon='wallet' title='还没有账户' />
        ) : (
          <View className='tx-list'>
            {accounts.map((account) => {
              const balance = accountBalance(account, data.txs);
              const count = data.txs.filter(
                (tx) => tx.accountId === account.id || tx.toAccountId === account.id,
              ).length;
              const typeLabel = ACCOUNT_TYPES.find((t) => t.key === account.type)?.label ?? '其他';
              return (
                <View
                  className={`row ${account.archived ? 'row--dim' : ''}`} hoverClass='row--hover'
                  key={account.id}
                  onClick={() => openEdit(account)}
                >
                  <View className='avatar' style={{ background: account.color }}>
                    <Icon name={account.icon} size={19} />
                  </View>
                  <View className='row__main'>
                    <View className='row__title'>
                      <Text>{account.name}</Text>
                      {account.archived ? <Text className='badge acc-badge'>已停用</Text> : null}
                    </View>
                    <Text className='row__meta'>
                      {typeLabel} · {count} 笔
                      {account.includeInTotal ? '' : ' · 不计入总资产'}
                    </Text>
                  </View>
                  <Text className={`row__value num ${balance < 0 ? 'amount-income' : ''}`}>
                    {formatMoney(balance, { digits: 2 })}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View className='section'>
        <View className='btn btn--primary btn--block' onClick={openNew}>
          <Icon name='plus' size={17} />
          新增账户
        </View>
      </View>

      {editing ? (
        <Sheet onClose={() => setEditing(null)} title={editing === 'new' ? '新增账户' : '账户设置'}>
          <View className='acc-form'>
            <View className='settings-group__title acc-form__label'>名称</View>
            <Input
              className='input'
              onInput={(event) => setName(event.detail.value)}
              placeholder='例如：工资卡'
              placeholderClass='acc-ph'
              value={name}
            />

            <View className='settings-group__title acc-form__label acc-form__label--gap'>类型</View>
            <View className='acc-types'>
              {ACCOUNT_TYPES.map((item) => (
                <View
                  className={`chip ${type === item.key ? 'chip--active' : ''}`}
                  key={item.key}
                  onClick={() => setType(item.key)}
                >
                  <Icon name={item.icon} size={13} />
                  <Text>{item.label}</Text>
                </View>
              ))}
            </View>

            <View className='settings-group__title acc-form__label acc-form__label--gap'>初始余额</View>
            <Input
              className='input'
              onInput={(event) => setBalanceText(event.detail.value)}
              placeholder='0.00（信用卡欠款填负数）'
              placeholderClass='acc-ph'
              type='digit'
              value={balanceText}
            />

            <View className='acc-toggle-row'>
              <Text className='acc-toggle-row__label'>计入总资产</Text>
              <View
                className={`switch ${includeInTotal ? 'switch--on' : ''}`}
                onClick={() => setIncludeInTotal(!includeInTotal)}
              >
                <View className='switch__knob' />
              </View>
            </View>

            <View className='btn btn--primary btn--block acc-submit' onClick={submit}>
              保存
            </View>

            {editing !== 'new' ? (
              <View className='settings-group acc-danger'>
                <View
                  className='settings-row' hoverClass='settings-row--hover'
                  onClick={() => {
                    updateAccount(editing.id, { archived: !editing.archived });
                    toast(editing.archived ? '账户已启用' : '账户已停用');
                    setEditing(null);
                  }}
                >
                  <Icon name='eye' size={18} />
                  <Text className='settings-row__label'>{editing.archived ? '启用账户' : '停用账户'}</Text>
                </View>
                <View className='settings-row' hoverClass='settings-row--hover' onClick={() => setPendingDelete(editing.id)}>
                  <Icon name='trash' size={18} />
                  <Text className='settings-row__label danger-text'>删除账户</Text>
                </View>
              </View>
            ) : null}
          </View>
        </Sheet>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          description='删除为软删除：历史流水仍保留，但账户不再出现在选择列表。'
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteAccount(pendingDelete);
            toast('账户已删除');
            setPendingDelete(null);
            setEditing(null);
          }}
          title='删除账户？'
          tone='danger'
        />
      ) : null}
    </View>
  );
}
