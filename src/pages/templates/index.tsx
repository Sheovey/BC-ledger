import { useMemo, useState } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import type { TxType } from '@/types';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { EmptyState } from '@/components/TxRow';
import { CategoryPicker } from '@/components/CategoryPicker';
import { categoryLabel, getBook } from '@/store/selectors';
import { fenToYuanString, formatMoney, parseAmountToFen } from '@/utils/money';
import './index.scss';

/**
 * 记账模板（小程序版）。对应 Web 版 TemplatesPage.tsx。
 *
 * 平台改写：
 * 1. 账户选择：Web 版是原生 <select>，小程序没有 select，改用 Picker（mode=selector），
 *    触发区做成一行「账户 / 当前值 / 右箭头」，和页面其它行保持一致的手感。
 * 2. 分类选择：沿用记账页同一个 CategoryPicker，放在二级弹层里。
 *    注意小程序弹层是 fixed 全屏，二级弹层直接叠在上一层之上即可，
 *    不要试图把两层合成一个（会丢掉返回上一层的路径）。
 * 3. 模板只服务「快速填一笔」，因此不存商家与项目；这两项在记账页再补。
 */

const TEMPLATE_TYPES: Array<{ key: TxType; label: string }> = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
];

export default function TemplatesPage() {
  const data = useStore((s) => s.data);
  const addTemplate = useStore((s) => s.addTemplate);
  const updateTemplate = useStore((s) => s.updateTemplate);
  const deleteTemplate = useStore((s) => s.deleteTemplate);

  const book = getBook(data);
  const bookId = book?.id ?? '';

  const templates = useMemo(
    () => data.templates.filter((t) => t.bookId === bookId).sort((a, b) => a.sort - b.sort),
    [data.templates, bookId],
  );
  const accounts = useMemo(
    () => data.accounts.filter((a) => a.bookId === bookId && !a.archived),
    [data.accounts, bookId],
  );

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<TxType>('expense');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [categorySheet, setCategorySheet] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const byId = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const openNew = () => {
    setEditing('new');
    setName('');
    setType('expense');
    setAmountText('');
    setCategoryId(null);
    setAccountId(accounts[0]?.id ?? null);
    setNote('');
  };

  const openEdit = (id: string) => {
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    setEditing(id);
    setName(template.name);
    setType(template.type);
    setAmountText(template.amount ? fenToYuanString(template.amount) : '');
    setCategoryId(template.categoryId);
    setAccountId(template.accountId ?? accounts[0]?.id ?? null);
    setNote(template.note);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入模板名称', 'warn');
      return;
    }
    const fen = parseAmountToFen(amountText || '0') ?? 0;
    const payload = {
      bookId,
      name: trimmed,
      type,
      amount: fen,
      categoryId,
      accountId,
      projectId: null,
      merchant: '',
      note: note.trim(),
    };
    if (editing === 'new') {
      addTemplate(payload);
      toast('模板已创建');
    } else if (editing) {
      updateTemplate(editing, payload);
      toast('模板已更新');
    }
    setEditing(null);
  };

  const accountIndex = Math.max(
    0,
    accounts.findIndex((a) => a.id === accountId),
  );
  const accountName = accounts[accountIndex]?.name ?? '未选择';

  return (
    <View className='shell shell--plain'>
      <PageHead
        right={
          <View className='icon-btn' hoverClass='icon-btn--hover' onClick={openNew}>
            <Icon name='plus' size={20} />
          </View>
        }
        subtitle='记账页可一键套用'
        title='模板'
      />

      <View className='section tpl-section'>
        {templates.length === 0 ? (
          <EmptyState
            description='把「早餐 12 元」这类高频记账存成模板，记账时少点几下'
            icon='template'
            title='还没有模板'
          />
        ) : (
          <View className='tx-list'>
            {templates.map((template) => (
              <View className='row' hoverClass='row--hover' key={template.id} onClick={() => openEdit(template.id)}>
                <View className='avatar avatar--sm tpl-avatar'>
                  <Icon name='template' size={16} />
                </View>
                <View className='row__main'>
                  <Text className='row__title'>{template.name}</Text>
                  <Text className='row__meta'>
                    {template.type === 'expense' ? '支出' : '收入'} ·{' '}
                    {categoryLabel(byId, template.categoryId)}
                    {template.note ? ` · ${template.note}` : ''}
                  </Text>
                </View>
                <Text className='row__value num'>{formatMoney(template.amount, { digits: 2 })}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View className='section'>
        <View className='btn btn--primary btn--block' onClick={openNew}>
          <Icon name='plus' size={17} />
          新建模板
        </View>
      </View>

      {editing ? (
        <Sheet onClose={() => setEditing(null)} title={editing === 'new' ? '新建模板' : '编辑模板'}>
          <View className='tpl-form'>
            <View className='settings-group__title tpl-form__label'>名称</View>
            <Input
              className='input'
              onInput={(event) => setName(event.detail.value)}
              placeholder='模板名称，如「早餐」'
              placeholderClass='tpl-ph'
              value={name}
            />

            <View className='settings-group__title tpl-form__label tpl-form__label--gap'>类型</View>
            <View className='segmented'>
              {TEMPLATE_TYPES.map((item) => (
                <View
                  className={`segmented__item ${type === item.key ? 'segmented__item--active' : ''}`}
                  key={item.key}
                  onClick={() => {
                    setType(item.key);
                    setCategoryId(null);
                  }}
                >
                  {item.label}
                </View>
              ))}
            </View>

            <View className='settings-group__title tpl-form__label tpl-form__label--gap'>默认金额</View>
            <Input
              className='input'
              onInput={(event) => setAmountText(event.detail.value)}
              placeholder='0.00'
              placeholderClass='tpl-ph'
              type='digit'
              value={amountText}
            />

            <View className='settings-group__title tpl-form__label tpl-form__label--gap'>分类与账户</View>
            <View className='tpl-picker-row'>
              <View className='chip tpl-chip' onClick={() => setCategorySheet(true)}>
                <Icon name='tag' size={13} />
                <Text>{categoryId ? categoryLabel(byId, categoryId) : '选择分类'}</Text>
              </View>

              <Picker
                mode='selector'
                onChange={(event) => {
                  const picked = accounts[Number(event.detail.value)];
                  if (picked) setAccountId(picked.id);
                }}
                range={accounts.map((a) => a.name)}
                value={accountIndex}
              >
                <View className='chip tpl-chip'>
                  <Icon name='wallet' size={13} />
                  <Text>{accountName}</Text>
                </View>
              </Picker>
            </View>

            <View className='settings-group__title tpl-form__label tpl-form__label--gap'>备注</View>
            <Input
              className='input'
              onInput={(event) => setNote(event.detail.value)}
              placeholder='选填'
              placeholderClass='tpl-ph'
              value={note}
            />

            <View className='btn btn--primary btn--block tpl-submit' onClick={submit}>
              保存
            </View>

            {editing !== 'new' ? (
              <View className='btn btn--danger btn--block tpl-delete' onClick={() => setPendingDelete(editing)}>
                删除模板
              </View>
            ) : null}
          </View>
        </Sheet>
      ) : null}

      {categorySheet ? (
        <Sheet onClose={() => setCategorySheet(false)} title='选择分类'>
          <CategoryPicker
            data={data}
            onSelect={(id) => {
              setCategoryId(id);
              setCategorySheet(false);
            }}
            selectedId={categoryId}
            type={type === 'income' ? 'income' : 'expense'}
          />
        </Sheet>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          description='删除模板不影响已记录的流水。'
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteTemplate(pendingDelete);
            toast('模板已删除');
            setPendingDelete(null);
            setEditing(null);
          }}
          title='删除模板？'
          tone='danger'
        />
      ) : null}
    </View>
  );
}
