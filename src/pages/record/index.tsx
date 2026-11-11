import { useMemo, useState } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import type { Tx, TxType } from '@/types';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { Keypad } from '@/components/Keypad';
import { CategoryPicker } from '@/components/CategoryPicker';
import { useAmountInput } from '@/hooks/useAmountInput';
import { useNavMetrics } from '@/hooks/useNavMetrics';
import { accountBalance, categoryLabel, getBook } from '@/store/selectors';
import { fenToYuanString, formatMoney } from '@/utils/money';
import { formatDateTime, nowStr, parseDateStr, toDateTimeStr } from '@/utils/date';
import { back, navigate, useQuery } from '@/router';
import './index.scss';

/**
 * 记账页（小程序版）。与 Web 版 RecordPage.tsx 逻辑一一对应，改写点：
 *
 * 1. 参数：Web 版由路由栈传 props，这里从页面 query 取 presetType / txId。
 * 2. 弹层里的时间选择：Web 版用 <input type="datetime-local">，
 *    小程序没有这个控件，换成 Picker(mode=date) + Picker(mode=time) 两个原生选择器。
 * 3. 输入框：<input onChange={e => e.target.value}> → <Input onInput={e => e.detail.value}>。
 * 4. 返回：Web 版靠自建栈的 depth 判断，这里用原生页面栈（router.back 内部已处理兜底）。
 * 5. 自定义导航栏：为了让顶部「保存」与返回按钮和 Web 版完全一致，
 *    page 配置 navigationStyle=custom，状态栏高度从 Taro.getWindowInfo 读取后补偿。
 */

type SheetKind = 'category' | 'account' | 'toAccount' | 'project' | 'time' | 'template' | null;

const TYPE_TABS: Array<{ key: TxType; label: string }> = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' },
  { key: 'balance', label: '余额' },
];

export default function RecordPage() {
  const query = useQuery();
  const presetType = (query.presetType as TxType | undefined) || undefined;
  const txId = query.txId || undefined;

  const data = useStore((s) => s.data);
  const addTx = useStore((s) => s.addTx);
  const updateTx = useStore((s) => s.updateTx);
  const deleteTx = useStore((s) => s.deleteTx);

  // 状态栏高度与胶囊右边界，自绘导航栏必须让出这块地盘（详见 hook 内注释）
  const nav = useNavMetrics();

  const existing = useMemo(() => data.txs.find((tx) => tx.id === txId), [data.txs, txId]);
  const book = getBook(data, existing?.bookId);
  const bookId = book?.id ?? '';

  const accounts = useMemo(
    () => data.accounts.filter((a) => a.bookId === bookId && !a.archived).sort((a, b) => a.sort - b.sort),
    [data.accounts, bookId],
  );
  const projects = useMemo(
    () => data.projects.filter((p) => p.bookId === bookId && !p.archived),
    [data.projects, bookId],
  );
  const templates = useMemo(
    () => data.templates.filter((t) => t.bookId === bookId).sort((a, b) => a.sort - b.sort),
    [data.templates, bookId],
  );

  const [type, setType] = useState<TxType>(existing?.type ?? presetType ?? 'expense');
  /**
   * 选中的分类集合。第一个是主分类（金额只记在它身上，分类统计也只看它），
   * 其余是「这笔钱还涉及哪些细项」的标签，不参与金额分摊。
   * 老数据只有单个 categoryId，回填成单元素数组。
   */
  const [categoryIds, setCategoryIds] = useState<string[]>(() => {
    if (existing?.categoryIds?.length) return existing.categoryIds;
    return existing?.categoryId ? [existing.categoryId] : [];
  });
  const categoryId = categoryIds[0] ?? null;
  const [accountId, setAccountId] = useState<string | null>(existing?.accountId ?? accounts[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(
    existing?.toAccountId ?? accounts[1]?.id ?? null,
  );
  const [projectId, setProjectId] = useState<string | null>(existing?.projectId ?? null);
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [occurredAt, setOccurredAt] = useState(existing?.occurredAt ?? nowStr());
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * 键盘是否展开。
   *
   * 键盘是自绘的、铺在页面 flex 底部，不会像系统输入法那样自动弹收，
   * 一直占着屏幕下半部分。给一个把手能收起来，方便核对上半部分的表单内容。
   * 收起后功能不缺：类型切换在页面上方还有一排，保存按钮在导航栏，
   * 底部另有一条「继续输入」随时能展开。
   */
  const [keypadOpen, setKeypadOpen] = useState(true);

  /**
   * 金额是否「正在被输入」。
   *
   * 光标是自绘的，没有系统输入框那样的焦点机制，只能用一个状态描述它。
   * 键盘展开期间如果无条件显示光标，用户点进备注时金额上的光标仍留在原处，
   * 屏幕上出现两个插入点的暗示，分不清字符会落到哪 —— 这正是「只展开键盘
   * 就等于正在输金额」这个假设不成立的地方。
   *
   * 判据绑定「最后一次与金额有关的操作」：点金额区、按自绘键盘任意键 → 亮；
   * 点进备注或商家输入框 → 灭。灭掉只是隐藏光标，键盘与已输入内容都不动。
   */
  const [amountActive, setAmountActive] = useState(true);

  const amount = useAmountInput({
    initial: existing ? fenToYuanString(existing.amount) : '',
  });

  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const categoryMap = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const categoryName = categoryId ? categoryLabel(categoryMap, categoryId) : null;
  /** 主分类之外还勾了几个细项，界面上显示成「+2」 */
  const extraCategoryCount = Math.max(0, categoryIds.length - 1);

  const switchType = (next: TxType) => {
    setType(next);
    if (next === 'transfer' || next === 'balance') {
      setCategoryIds([]);
    }
  };

  /** 余额模式：输入的是「调整后的目标余额」，保存时换算成差额 */
  const targetBalanceFen = Math.round(amount.resolveFen() || 0);

  const finish = () => {
    back();
  };

  const save = () => {
    const rawFen = amount.resolveFen();
    const txType = type;

    if (txType === 'balance') {
      if (!accountId) {
        toast('请选择要调整的账户', 'warn');
        return;
      }
      const current = account ? accountBalance(account, data.txs) : 0;
      const delta = targetBalanceFen - current;
      if (delta === 0) {
        toast('余额没有变化', 'warn');
        return;
      }
      const payload = {
        bookId,
        type: txType,
        amount: delta,
        categoryId: null,
        categoryIds: [] as string[],
        accountId,
        toAccountId: null,
        projectId: null,
        merchant: '',
        note: note.trim() || '余额调整',
        occurredAt,
      };
      if (existing) updateTx(existing.id, payload);
      else addTx(payload);
      finish();
      return;
    }

    if (!rawFen || rawFen <= 0) {
      toast('请输入金额', 'warn');
      return;
    }
    if (txType !== 'transfer' && !categoryId) {
      toast('请选择分类', 'warn');
      return;
    }
    if (!accountId) {
      toast('请选择账户', 'warn');
      return;
    }
    if (txType === 'transfer') {
      if (!toAccountId) {
        toast('请选择转入账户', 'warn');
        return;
      }
      if (toAccountId === accountId) {
        toast('转出与转入账户不能相同', 'warn');
        return;
      }
    }

    const payload: Omit<Tx, 'id' | 'createdAt' | 'updatedAt'> = {
      bookId,
      type: txType,
      amount: Math.round(rawFen),
      categoryId: txType === 'transfer' ? null : categoryId,
      // 多选的二级分类（含主分类）。金额不分摊，这里只是标签；
      // 单选也写一份，免得下游出现「有的记录读 categoryId、有的读 categoryIds」两套读法。
      categoryIds: txType === 'transfer' ? [] : categoryIds,
      accountId,
      toAccountId: txType === 'transfer' ? toAccountId : null,
      projectId: txType === 'transfer' ? null : projectId,
      merchant: merchant.trim(),
      note: note.trim(),
      occurredAt,
    };

    if (existing) {
      updateTx(existing.id, payload);
      toast('已更新');
    } else {
      addTx(payload);
      toast('已记账');
    }
    finish();
  };

  if (!book) {
    return (
      <View className='record'>
        <View className='record__nav' style={{ paddingTop: `${nav.statusBar}px` }}>
          <View className='record__head' style={{ paddingRight: `${nav.rightInset}px` }}>
            <View className='icon-btn' hoverClass='icon-btn--hover' onClick={finish}>
              <Icon name='back' size={20} />
            </View>
            <View className='record__title'>记一笔</View>
          </View>
        </View>
        <View className='empty'>请先创建账本</View>
      </View>
    );
  }

  const balanceHint =
    type === 'balance' && account
      ? `当前余额 ${formatMoney(accountBalance(account, data.txs), { digits: 2 })}`
      : '';

  const datePart = occurredAt.slice(0, 10);
  const timePart = occurredAt.slice(11, 16) || '00:00';

  return (
    <View className='record'>
      <View className='record__nav' style={{ paddingTop: `${nav.statusBar}px` }}>
        <View className='record__head' style={{ paddingRight: `${nav.rightInset}px` }}>
          <View className='icon-btn' hoverClass='icon-btn--hover' onClick={finish}>
            <Icon name='back' size={20} />
          </View>
          <View
            className={`record__save ${amount.resolveFen() > 0 || type === 'balance' ? 'record__save--active' : ''}`}
            onClick={save}
          >
            {existing ? '更新' : '保存'}
          </View>
          {/* 标题绝对定位在整屏正中，不参与 flex 排布，因此不会被右侧留白挤偏 */}
          <View className='record__title'>{existing ? '编辑记录' : '记一笔'}</View>
        </View>
      </View>

      <View className='record__types'>
        {templates.length > 0 && !existing ? (
          <View className='record__type' onClick={() => setSheet('template')}>
            模板
          </View>
        ) : null}
        {TYPE_TABS.map((tab) => (
          <View
            className={`record__type ${type === tab.key ? 'record__type--active' : ''}`}
            key={tab.key}
            onClick={() => switchType(tab.key)}
          >
            {tab.label}
          </View>
        ))}
      </View>

      <View className='record__scroll'>
        <View
          className='record__amount-box'
          onClick={() => {
            setKeypadOpen(true);
            setAmountActive(true);
          }}
        >
          <Text className='record__currency'>{data.settings.currency}</Text>
          <View className='record__amount-line'>
            {/* 光标只在「键盘展开且金额是当前输入目标」时出现，让「现在正在往这里输入」
                这件事看得见；点进备注后必须收起，否则会出现两个插入点。
                完全空白时贴着最左（占位 0.00 的左侧），一旦有数字或已进入算式就贴到末尾——
                与真实输入框一致；否则光标会停在占位符 0.00 后面，看着像已经输了 4 个字符。 */}
            {keypadOpen && amountActive && !amount.text && !amount.expression ? (
              <View className='record__amount-caret' />
            ) : null}
            <Text className={`record__amount ${amount.placeholder ? 'record__amount--placeholder' : ''}`}>
              {amount.display}
            </Text>
            {keypadOpen && amountActive && (amount.text || amount.expression) ? (
              <View className='record__amount-caret' />
            ) : null}
          </View>
        </View>
        {amount.expression ? <View className='record__hint'>{amount.expression}</View> : null}
        {balanceHint ? (
          <View className='record__hint'>{balanceHint}，保存时按目标余额自动计算差额</View>
        ) : null}

        {type !== 'transfer' && type !== 'balance' ? (
          <View className='record__field' onClick={() => setSheet('category')}>
            <Icon className='record__field-icon' name='shopping' size={18} />
            <Text className='record__field-label'>分类</Text>
            <Text className={`record__field-value ${categoryName ? '' : 'record__field-value--muted'}`}>
              {categoryName ?? '选择分类'}
              {extraCategoryCount ? (
                <Text className='record__field-extra'>{` +${extraCategoryCount}`}</Text>
              ) : null}
            </Text>
            <Icon className='row__chevron' name='forward' size={16} />
          </View>
        ) : null}

        <View className='record__field' onClick={() => setSheet('time')}>
          <Icon className='record__field-icon' name='calendar' size={18} />
          <Text className='record__field-label'>时间</Text>
          <Text className='record__field-value'>{formatDateTime(occurredAt)}</Text>
          <Icon className='row__chevron' name='forward' size={16} />
        </View>

        <View className='record__field' onClick={() => setAmountActive(false)}>
          <Icon className='record__field-icon' name='edit' size={18} />
          <Text className='record__field-label'>备注</Text>
          <Input
            className='record__note-input'
            onFocus={() => setAmountActive(false)}
            onInput={(event) => setNote(event.detail.value)}
            placeholder='点击填写备注'
            placeholderClass='record__note-ph'
            value={note}
          />
        </View>

        <View className='record__field' onClick={() => setSheet('account')}>
          <Icon className='record__field-icon' name='wallet' size={18} />
          <Text className='record__field-label'>{type === 'transfer' ? '转出' : '账户'}</Text>
          <Text className={`record__field-value ${account ? '' : 'record__field-value--muted'}`}>
            {account?.name ?? '选择账户'}
          </Text>
          <Icon className='row__chevron' name='forward' size={16} />
        </View>

        {type === 'transfer' ? (
          <View className='record__field' onClick={() => setSheet('toAccount')}>
            <Icon className='record__field-icon' name='income' size={18} />
            <Text className='record__field-label'>转入</Text>
            <Text className={`record__field-value ${toAccount ? '' : 'record__field-value--muted'}`}>
              {toAccount?.name ?? '选择转入账户'}
            </Text>
            <Icon className='row__chevron' name='forward' size={16} />
          </View>
        ) : null}

        {type === 'expense' || type === 'income' ? (
          <View className='record__field' onClick={() => setSheet('project')}>
            <Icon className='record__field-icon' name='project' size={18} />
            <Text className='record__field-label'>项目</Text>
            <Text className={`record__field-value ${projectId ? '' : 'record__field-value--muted'}`}>
              {projects.find((p) => p.id === projectId)?.name ?? '不指定'}
            </Text>
            <Icon className='row__chevron' name='forward' size={16} />
          </View>
        ) : null}

        <View className='record__field' onClick={() => setAmountActive(false)}>
          <Icon className='record__field-icon' name='merchant' size={18} />
          <Text className='record__field-label'>商家</Text>
          <Input
            className='record__note-input'
            onFocus={() => setAmountActive(false)}
            onInput={(event) => setMerchant(event.detail.value)}
            placeholder='选填'
            placeholderClass='record__note-ph'
            value={merchant}
          />
        </View>

        {existing ? (
          <View
            className='btn btn--danger btn--block record__delete'
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name='trash' size={16} />
            <Text className='record__delete-label'>删除这条记录</Text>
          </View>
        ) : null}
        <View className='record__tail' />
      </View>

      {keypadOpen ? (
        <Keypad
          confirmDisabled={type !== 'balance' && amount.resolveFen() <= 0}
          onConfirm={save}
          onPress={(key) => {
            // 按键盘任意键即视为回到金额输入，光标随之回来
            setAmountActive(true);
            amount.press(key);
          }}
          onTypeChange={switchType}
          onCollapse={() => setKeypadOpen(false)}
          type={type}
        />
      ) : (
        <View
          className='keypad-reopen'
          hoverClass='keypad-reopen--hover'
          onClick={() => setKeypadOpen(true)}
        >
          <Icon name='edit' size={15} />
          <Text className='keypad-reopen__label'>继续输入</Text>
        </View>
      )}

      {sheet === 'category' && (type === 'expense' || type === 'income') ? (
        <Sheet
          footer={
            /* 「完成」放 Sheet 的 footer：宫格 + 子分类常常要滚一段才到底，
               放在内容末尾会看不见，用户勾完找不到怎么收尾。 */
            <View className='sheet__foot'>
              <View
                className={`btn btn--block ${categoryIds.length ? 'btn--primary' : 'btn--muted'}`}
                hoverClass='btn--hover'
                onClick={() => {
                  if (categoryIds.length) setSheet(null);
                }}
              >
                {categoryIds.length
                  ? `完成${extraCategoryCount ? ` · 已选 ${categoryIds.length} 项` : ''}`
                  : '请选择分类'}
              </View>
            </View>
          }
          onClose={() => setSheet(null)}
          title='选择分类'
        >
          <CategoryPicker
            data={data}
            multiple
            onChange={setCategoryIds}
            onManage={() => {
              setSheet(null);
              navigate({ name: 'categories' });
            }}
            selectedIds={categoryIds}
            type={type}
          />
        </Sheet>
      ) : null}

      {sheet === 'account' || sheet === 'toAccount' ? (
        <Sheet onClose={() => setSheet(null)} title={sheet === 'account' ? '选择账户' : '选择转入账户'}>
          <View className='settings-group sheet__group'>
            {accounts.map((item) => {
              const activeId = sheet === 'account' ? accountId : toAccountId;
              return (
                <View
                  className='settings-row' hoverClass='settings-row--hover'
                  key={item.id}
                  onClick={() => {
                    if (sheet === 'account') setAccountId(item.id);
                    else setToAccountId(item.id);
                    setSheet(null);
                  }}
                >
                  <View className='avatar avatar--sm' style={{ background: item.color }}>
                    <Icon name={item.icon} size={15} />
                  </View>
                  <Text className='settings-row__label'>{item.name}</Text>
                  <Text className='settings-row__value num'>
                    {formatMoney(accountBalance(item, data.txs), { digits: 2 })}
                  </Text>
                  {activeId === item.id ? (
                    <Icon name='check' size={16} style={{ color: 'var(--accent-deep)' }} />
                  ) : null}
                </View>
              );
            })}
          </View>
          <View
            className='text-btn sheet__manage' hoverClass='text-btn--hover'
            onClick={() => {
              setSheet(null);
              navigate({ name: 'accounts' });
            }}
          >
            管理账户
          </View>
        </Sheet>
      ) : null}

      {sheet === 'project' ? (
        <Sheet onClose={() => setSheet(null)} title='选择项目'>
          <View className='settings-group sheet__group'>
            <View
              className='settings-row' hoverClass='settings-row--hover'
              onClick={() => {
                setProjectId(null);
                setSheet(null);
              }}
            >
              <Text className='settings-row__label'>不指定项目</Text>
              {projectId === null ? (
                <Icon name='check' size={16} style={{ color: 'var(--accent-deep)' }} />
              ) : null}
            </View>
            {projects.map((project) => (
              <View
                className='settings-row' hoverClass='settings-row--hover'
                key={project.id}
                onClick={() => {
                  setProjectId(project.id);
                  setSheet(null);
                }}
              >
                <View className='legend-dot' style={{ background: project.color }} />
                <Text className='settings-row__label'>{project.name}</Text>
                {projectId === project.id ? (
                  <Icon name='check' size={16} style={{ color: 'var(--accent-deep)' }} />
                ) : null}
              </View>
            ))}
          </View>
          <View
            className='text-btn sheet__manage' hoverClass='text-btn--hover'
            onClick={() => {
              setSheet(null);
              navigate({ name: 'projects' });
            }}
          >
            管理项目
          </View>
        </Sheet>
      ) : null}

      {sheet === 'template' ? (
        <Sheet onClose={() => setSheet(null)} title='选择模板'>
          {templates.map((template) => (
            <View
              className='row' hoverClass='row--hover'
              key={template.id}
              onClick={() => {
                switchType(template.type);
                // 模板只存主分类，带不出多选的细项标签
                setCategoryIds(template.categoryId ? [template.categoryId] : []);
                setAccountId(template.accountId);
                setProjectId(template.projectId);
                setMerchant(template.merchant);
                setNote(template.note);
                amount.setValue(template.amount ? fenToYuanString(template.amount) : '');
                setSheet(null);
              }}
            >
              <View className='avatar avatar--sm avatar--tint'>
                <Icon name='template' size={15} />
              </View>
              <View className='row__main'>
                <Text className='row__title'>{template.name}</Text>
                <Text className='row__meta'>
                  {categoryLabel(new Map(data.categories.map((c) => [c.id, c])), template.categoryId)}
                </Text>
              </View>
              <Text className='row__value num'>{formatMoney(template.amount, { digits: 2 })}</Text>
            </View>
          ))}
        </Sheet>
      ) : null}

      {sheet === 'time' ? (
        <Sheet onClose={() => setSheet(null)} title='选择时间'>
          <View className='time-sheet'>
            <View className='time-sheet__row'>
              <Picker
                mode='date'
                onChange={(event) => setOccurredAt(`${event.detail.value}T${timePart}`)}
                value={datePart}
              >
                <View className='input time-sheet__cell'>{datePart}</View>
              </Picker>
              <Picker
                mode='time'
                onChange={(event) => setOccurredAt(`${datePart}T${event.detail.value}`)}
                value={timePart}
              >
                <View className='input time-sheet__cell'>{timePart}</View>
              </Picker>
            </View>
            <View className='record__chips'>
              <View
                className='chip'
                onClick={() => {
                  setOccurredAt(nowStr());
                  setSheet(null);
                }}
              >
                现在
              </View>
              <View
                className='chip'
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  setOccurredAt(toDateTimeStr(d));
                }}
              >
                昨天
              </View>
              <View
                className='chip'
                onClick={() => {
                  const d = parseDateStr(occurredAt);
                  d.setDate(d.getDate() - 1);
                  setOccurredAt(toDateTimeStr(d));
                }}
              >
                前一天
              </View>
              <View
                className='chip'
                onClick={() => {
                  const d = parseDateStr(occurredAt);
                  d.setDate(d.getDate() + 1);
                  setOccurredAt(toDateTimeStr(d));
                }}
              >
                后一天
              </View>
              <View className='chip' onClick={() => setSheet(null)}>
                完成
              </View>
            </View>
          </View>
        </Sheet>
      ) : null}

      {confirmDelete && existing ? (
        <ConfirmDialog
          description='删除后不可恢复，账户余额会同步回滚。'
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            deleteTx(existing.id);
            toast('已删除');
            setConfirmDelete(false);
            finish();
          }}
          title='删除这条记录？'
          tone='danger'
        />
      ) : null}
    </View>
  );
}
