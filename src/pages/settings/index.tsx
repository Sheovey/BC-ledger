import { useMemo, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useStore, toast } from '@/store/useStore';
import { useUiStore } from '@/store/ui';
import { Icon } from '@/components/Icon';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { useNavMetrics } from '@/hooks/useNavMetrics';
import { getBook, summarize } from '@/store/selectors';
import { buildJsonText, exportCsv, exportJson, pickAndParseBackup, type ImportResult } from '@/db/dataIO';
import { backupAt, exportedAt, markExported, restoreBackup } from '@/db/persist';
import {
  archiveNow,
  archiveStatus,
  formatBytes,
  listArchives,
  markShared,
  openArchive,
  readArchiveJson,
  shareArchive,
  sharedAt,
  writeBookXlsx,
  type ArchiveEntry,
} from '@/db/archive';
import { formatMoney } from '@/utils/money';
import { resolveRange, todayStr, withinRange } from '@/utils/date';
import { navigate } from '@/router';
import { flushPendingUpdatePrompt } from '@/utils/update';
import { confirmShareDone } from '@/utils/confirmShare';
import { requestBackupPrompt } from '@/utils/backupPrompt';
import { BackupPrompt } from '@/components/BackupPrompt';
import { APP_VERSION } from '@/config/version';
import './index.scss';

/**
 * 设置页（小程序版）。对应 Web 版 SettingsPage.tsx。
 *
 * 与 Web 版的差异（都是平台能力差异，不是取舍）：
 *
 * 1. 去掉「账号与同步」整组：云端同步层还没接，摆一个点了没反应的入口更糟。
 * 2. 去掉「安装到桌面」：那是 PWA 能力，小程序本身就是入口。
 * 3. 去掉「深色模式」开关：Web 版靠 [data-theme] 属性选择器，WXSS 不支持，
 *    目前暗色变量被整块删掉了。留着开关只会让用户点了没变化，
 *    等改成 .theme-dark 类选择器之后再放回来（已在待办里）。
 * 4. 导入导出换成小程序文件 API（见 db/dataIO.ts）。
 * 5. 「本地数据占用」用 getStorageInfoSync，而不是 new Blob 量 JSON 字节数——
 *    小程序没有 Blob，而且用户关心的是占用存储额度，不是 JSON 文本长度。
 * 6. 关于文案重写：小程序的数据存在本地存储里，微信清理缓存会一并清掉，
 *    这一点必须明说，否则用户会以为和浏览器一样清缓存没事。
 */

/**
 * 版本号已抽到 src/config/version.ts：备份提醒的「升级判定」也要用它，
 * 两处各写一份迟早对不上，而版本号对不上会让升级判定静默失效。
 */
const CURRENCIES = ['¥', '$', '€', '£'];
const MONTH_DAYS = [1, 5, 10, 15, 20, 25];

/**
 * 两个时间阈值，都以「最近一次把备份发出去」为基准。
 *
 * 只认 exportedAt（导出发到聊天），不认 backupAt（本机自动备份）——
 * 后者每次记账都在更新，永远是「今天」，拿它做提醒等于永久沉默。
 * 本机存档和微信缓存同生共死，本来就不该被当成备份。
 */
/** 超过这个天数没导出，在「数据」分组顶部提醒一次 */
const BACKUP_REMIND_DAYS = 14;
/** 清空所有数据前，超过这个天数没导出就要求过一道额外确认 */
const RESET_GUARD_DAYS = 30;

/**
 * 把时间戳说成人话。
 * 这里刻意不用「从未备份 → 请立即备份」这种命令式文案：
 * 用户可能是刚装完就来设置页，催促只会制造焦虑。
 */
function relativeDay(stamp: number | null): string {
  if (!stamp) return '从未';
  const days = Math.floor((Date.now() - stamp) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} 个月前` : `${Math.floor(months / 12)} 年前`;
}

/** 账本与科目的二级入口，均已迁移完成 */
const MANAGE_ROWS: Array<{ label: string; icon: string; route: Parameters<typeof navigate>[0] }> = [
  { label: '账户', icon: 'wallet', route: { name: 'accounts' } },
  { label: '分类管理', icon: 'tag', route: { name: 'categories' } },
  { label: '项目', icon: 'project', route: { name: 'projects' } },
  { label: '记账模板', icon: 'template', route: { name: 'templates' } },
  { label: '预算', icon: 'budget', route: { name: 'budget' } },
];

export default function SettingsPage() {
  const data = useStore((s) => s.data);
  const updateSettings = useStore((s) => s.updateSettings);
  const importData = useStore((s) => s.importData);
  const resetAll = useStore((s) => s.resetAll);
  const loadDemo = useStore((s) => s.loadDemo);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const nav = useNavMetrics();

  // 告知底部导航当前是我的页（导航由框架渲染，见 src/custom-tab-bar）
  useDidShow(() => {
    setActiveTab('settings');
    if (!flushPendingUpdatePrompt()) requestBackupPrompt();
  });

  const book = getBook(data);
  const [sheet, setSheet] = useState<'currency' | 'monthDay' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 已解析但还没确认落地的备份：恢复要覆盖全量数据，必须先让人看清是哪一份 */
  const [pendingImport, setPendingImport] = useState<ImportResult | null>(null);
  /** 无备份时「清空所有数据」的前置拦截层，通过后才进原来的二次确认 */
  const [resetGate, setResetGate] = useState(false);
  /** 导出/备份时间戳存在 storage 里，不随 store 变化，用 tick 手动触发重算 */
  const [stampTick, setStampTick] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTick, setArchiveTick] = useState(0);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  /**
   * 最近一次「导出到聊天」的时间。
   * 与 backupAt 严格区分：backupAt 是落盘前留的上一版，活在手机里，
   * 清缓存就没了；只有导出去的才跨得了设备。
   */
  const lastExport = useMemo(() => exportedAt(), [data, stampTick]);
  const exportLabel = useMemo(() => relativeDay(lastExport), [lastExport]);
  const backupLabel = useMemo(() => relativeDay(backupAt()), [data, stampTick]);

  /** 备份超期判定：null 不需要提醒 / { days: null } 从未导出 / { days: N } 已 N 天 */
  const staleExport = useMemo<{ days: number | null } | null>(() => {
    // 还没有流水时不催：刚装完就来设置页的用户没有可丢的东西，催只会制造焦虑
    if (data.txs.length === 0) return null;
    if (!lastExport) return { days: null };
    const days = Math.floor((Date.now() - lastExport) / 86_400_000);
    return days >= BACKUP_REMIND_DAYS ? { days } : null;
  }, [lastExport, data.txs.length]);
  const sharedLabel = useMemo(() => relativeDay(sharedAt()), [data, archiveTick]);
  const archiveInfo = useMemo(() => archiveStatus(), [data, archiveTick]);
  const archives = useMemo(() => listArchives(), [archiveTick]);

  const monthTotals = useMemo(() => {
    if (!book) return { expense: 0, income: 0, count: 0 };
    const range = resolveRange('month', todayStr(), data.settings.monthStartDay);
    const txs = data.txs.filter((tx) => tx.bookId === book.id && withinRange(tx.occurredAt, range));
    const s = summarize(txs);
    return { ...s, count: txs.length };
  }, [data, book]);

  /** 存储占用：小程序存储额度以 KB 计，这里直接读官方口径 */
  const usage = useMemo(() => {
    try {
      const info = Taro.getStorageInfoSync();
      const kb = info.currentSize ?? 0;
      const keys = (info.keys ?? []).length;
      return `${kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`} · ${keys} 个键`;
    } catch {
      return '未知';
    }
  }, [data]);

  /**
   * 导出备份。
   *
   * 「已发出」不能由 shareFileMessage 的返回值推断——用户在转发面板直接返回、
   * 未选任何聊天，也会走 success（2026-11-18 实机确认）。所以面板调起后再问一次：
   * 确认发出才记备份时间；说没发出的转存剪贴板兜底，且不记时间。
   */
  const doExportJson = async () => {
    if (busy) return;
    setBusy(true);
    const outcome = await exportJson(data);
    if (outcome !== 'shared') {
      setBusy(false);
      if (outcome === 'copied') toast('已复制备份全文到剪贴板');
      else toast('导出失败', 'warn');
      return;
    }
    const done = await confirmShareDone();
    setBusy(false);
    if (done) {
      // 确认发出才记时间与条数：误记会让备份提醒在之后的 14 天里彻底沉默
      markExported(data.txs.length);
      setStampTick((t) => t + 1);
      toast('已记录备份时间');
      return;
    }
    try {
      await Taro.setClipboardData({ data: buildJsonText(data) });
      toast('已复制备份全文到剪贴板');
    } catch {
      toast('导出失败', 'warn');
    }
  };

  const doExportCsv = async () => {
    if (!book || busy) return;
    setBusy(true);
    const outcome = await exportCsv(data, book.id);
    setBusy(false);
    if (outcome === 'shared') toast('已打开转发面板，确认聊天里收到即可');
    else if (outcome === 'copied') toast('已复制 CSV 全文到剪贴板');
    else toast('导出失败', 'warn');
  };

  /**
   * 选文件 → 解析 → 弹确认，不再「解析完就覆盖」。
   *
   * 旧实现点一下就把整份数据换掉。手机上同时躺着几份备份时，
   * 文件名带时间戳也不等于人能认出里面是哪天的账，
   * 而恢复选错的代价是当前数据被顶掉（虽可再回滚，但已经吓一跳）。
   */
  const doImport = async () => {
    if (busy) return;
    setBusy(true);
    const result = await pickAndParseBackup();
    setBusy(false);
    if (!result.ok || !result.data) {
      // 用户取消不必提示错误
      if (result.message !== '已取消') toast(result.message, 'warn');
      return;
    }
    setPendingImport(result);
  };

  const doConfirmImport = () => {
    const target = pendingImport;
    setPendingImport(null);
    if (!target?.data) return;
    importData(target.data);
    setStampTick((t) => t + 1);
    toast(target.message);
  };

  /**
   * 清空是最不可逆的入口，按「最近导出」分级：
   * 30 天内把备份发出去过的，走原来的确认即可；否则先过一道拦截。
   * 依据很直接——手机丢数据的真实路径就是清缓存 / 删小程序 / 换手机，
   * 这三种里只有导出的文件活得下来。
   */
  const requestReset = () => {
    const days = lastExport ? Math.floor((Date.now() - lastExport) / 86_400_000) : null;
    const noRecentBackup = days === null || days >= RESET_GUARD_DAYS;
    if (data.txs.length > 0 && noRecentBackup) {
      setResetGate(true);
      return;
    }
    setConfirmReset(true);
  };

  /** 回到本机自动保留的上一版：用于撤销「删错了」「改错了」这类误操作 */
  const doRestore = () => {
    setConfirmRestore(false);
    const restored = restoreBackup();
    if (!restored) {
      toast('没有可回滚的上一版', 'warn');
      return;
    }
    importData(restored);
    setStampTick((t) => t + 1);
    toast(`已回到上一版，共 ${restored.txs.length} 条流水`);
  };

  /** 立即存档：绕过调度门限，表格与快照一起写 */
  const doArchiveNow = async () => {
    if (busy) return;
    setBusy(true);
    const results = await archiveNow();
    setBusy(false);
    setArchiveTick((t) => t + 1);
    const wrote = results.filter((item) => item.ok && item.kind);
    if (wrote.length) {
      const status = archiveStatus();
      toast(`已存档 · ${status.files} 个文件 ${formatBytes(status.bytes)}`);
      return;
    }
    if (results.every((item) => item.ok)) {
      toast('内容没变，没有重复写一份');
      return;
    }
    const reason = results.find((item) => !item.ok)?.reason;
    toast(reason === 'no-data' ? '还没有流水，暂不需要存档' : '存档失败，稍后再试', 'warn');
  };

  /**
   * 发送存档到聊天。这是唯一能扛住清缓存与换手机的手段。
   * 注意：shareFileMessage 限制「仅在点击行为时调用」，所以写文件必须在
   * share 之前**同步**完成——writeBookXlsx 正好是同步的，中间不能插 await。
   */
  const doShareArchive = async () => {
    if (busy) return;
    setBusy(true);
    writeBookXlsx();
    const latest = listArchives().find((entry) => entry.kind === 'xlsx');
    if (!latest) {
      setBusy(false);
      toast('还没有可发送的存档','warn');
      return;
    }
    const ok = await shareArchive(latest.name);
    setBusy(false);
    if (ok) {
      markShared();
      setArchiveTick((t) => t + 1);
      toast('已打开转发面板，确认聊天里收到即可');
    } else {
      toast('发送失败，可到「查看本机存档」打开后手动转发', 'warn');
    }
  };

  const onArchiveTap = async (entry: ArchiveEntry) => {
    if (entry.kind === 'xlsx') {
      const ok = await openArchive(entry.name);
      if (!ok) toast('微信打不开这个文件，可先发送到聊天再用电脑打开', 'warn');
      return;
    }
    setArchiveOpen(false);
    setConfirmArchive(entry.name);
  };

  const doRestoreArchive = () => {
    const name = confirmArchive;
    setConfirmArchive(null);
    if (!name) return;
    const result = readArchiveJson(name);
    if (!result.ok || !result.data) {
      toast(result.message || '存档读取失败', 'warn');
      return;
    }
    importData(result.data);
    setArchiveTick((t) => t + 1);
    setStampTick((t) => t + 1);
    toast(`已从存档恢复 ${result.data.txs.length} 条流水`);
  };

  return (
    <View className='shell'>
      <View style={{ height: `${nav.statusBar}px` }} />
      <View className='settings-head' style={{ paddingRight: `${nav.rightInset}px` }}>
        <Text className='settings-head__title'>我的</Text>
      </View>

      <View className='settings-body'>
        <View className='book-card' onClick={() => navigate({ name: 'books' })}>
          <View className='book-card__icon' style={{ background: book?.color ?? '#f0993e' }}>
            <Icon name={book?.icon ?? 'wallet'} size={21} />
          </View>
          <View className='book-card__main'>
            <Text className='book-card__name'>{book?.name ?? '未选择账本'}</Text>
            <Text className='book-card__meta'>
              本月支出 {formatMoney(monthTotals.expense, { digits: 2 })} · {monthTotals.count} 笔
            </Text>
          </View>
          <Icon className='row__chevron' name='forward' size={17} />
        </View>
      </View>

      <View className='settings-group'>
        <View className='settings-group__title'>账本与科目</View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={() => navigate({ name: 'books' })}>
          <Icon name='book' size={18} />
          <Text className='settings-row__label'>账本管理</Text>
          <Text className='settings-row__value'>{data.books.length} 个</Text>
          <Icon className='row__chevron' name='forward' size={15} />
        </View>
        {MANAGE_ROWS.map((row) => (
          <View className='settings-row' hoverClass='settings-row--hover' key={row.label} onClick={() => navigate(row.route)}>
            <Icon name={row.icon} size={18} />
            <Text className='settings-row__label'>{row.label}</Text>
            <Icon className='row__chevron' name='forward' size={15} />
          </View>
        ))}
      </View>

      <View className='settings-group'>
        <View className='settings-group__title'>偏好设置</View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={() => setSheet('currency')}>
          <Icon name='tag' size={18} />
          <Text className='settings-row__label'>货币符号</Text>
          <Text className='settings-row__value'>{data.settings.currency}</Text>
          <Icon className='row__chevron' name='forward' size={15} />
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={() => setSheet('monthDay')}>
          <Icon name='calendar' size={18} />
          <Text className='settings-row__label'>每月起始日</Text>
          <Text className='settings-row__value'>{data.settings.monthStartDay} 日</Text>
          <Icon className='row__chevron' name='forward' size={15} />
        </View>
      </View>

      <View className='settings-group'>
        <View className='settings-group__title'>数据</View>
        {/* 超期未导出提醒。放在分组首位且整行可点，让「提醒」本身就是入口，
            省掉「看到提示 → 再去找导出项」这一步。 */}
        {staleExport ? (
          <View
            className='settings-row settings-row--note settings-row--alert'
            hoverClass='settings-row--hover'
            onClick={doExportJson}
          >
            <Icon name='warn' size={18} />
            <Text className='settings-note settings-note--alert'>
              {staleExport.days === null
                ? '还没把备份发出去过。微信清理存储空间或删除小程序会把记录一起清掉，点这里发一份到聊天存着。'
                : `上次把备份发出去是 ${staleExport.days} 天前。微信清理存储空间或删除小程序会把记录一起清掉，建议再发一份到聊天。`}
            </Text>
          </View>
        ) : null}
        <View className='settings-row' hoverClass='settings-row--hover' onClick={doExportJson}>
          <Icon name='download' size={18} />
          <Text className='settings-row__label'>
            导出完整备份
            <Text className='settings-row__sub'>JSON 格式 · 发到聊天存一份，换手机靠它恢复</Text>
          </Text>
          <Text className='settings-row__value'>{exportLabel}</Text>
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={doImport}>
          <Icon name='upload' size={18} />
          <Text className='settings-row__label'>
            从备份恢复
            <Text className='settings-row__sub'>换手机后用这一项把数据带回来</Text>
          </Text>
          <Text className='settings-row__value'>覆盖当前</Text>
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={() => setConfirmRestore(true)}>
          <Icon name='refresh' size={18} />
          <Text className='settings-row__label'>
            回到上一个存档
            <Text className='settings-row__sub'>本机自动保留的上一版，用于撤销误操作</Text>
          </Text>
          <Text className='settings-row__value'>{backupLabel}</Text>
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={doExportCsv}>
          <Icon name='list' size={18} />
          <Text className='settings-row__label'>导出当前账本 CSV</Text>
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={() => setConfirmDemo(true)}>
          <Icon name='chart' size={18} />
          <Text className='settings-row__label'>载入演示数据</Text>
          <Text className='settings-row__value'>用于体验图表</Text>
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={requestReset}>
          <Icon name='trash' size={18} />
          <Text className='settings-row__label danger-text'>清空所有数据</Text>
        </View>
      </View>

      <View className='settings-group'>
        <View className='settings-group__title'>本机自动存档</View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={doShareArchive}>
          <Icon name='upload' size={18} />
          <Text className='settings-row__label'>
            发送最新存档到聊天
            <Text className='settings-row__sub'>Excel 档案，可跨设备查阅，但不能用来恢复数据</Text>
          </Text>
          <Text className='settings-row__value'>{sharedLabel}</Text>
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={() => setArchiveOpen(true)}>
          <Icon name='eye' size={18} />
          <Text className='settings-row__label'>
            查看本机存档
            <Text className='settings-row__sub'>每个账本一个 Excel 文件</Text>
          </Text>
          <Text className='settings-row__value'>
            {archiveInfo.files ? `${archiveInfo.files} 个 · ${formatBytes(archiveInfo.bytes)}` : '暂无'}
          </Text>
        </View>
        <View className='settings-row' hoverClass='settings-row--hover' onClick={doArchiveNow}>
          <Icon name='download' size={18} />
          <Text className='settings-row__label'>立即存档</Text>
          <Text className='settings-row__value'>{relativeDay(archiveInfo.lastAt)}</Text>
        </View>
        <View className='settings-row settings-row--note'>
          <Icon name='warn' size={18} />
          <Text className='settings-note'>
            存档写在手机的文件目录里，和微信缓存同生共死——删除小程序或清理微信存储空间会一起消失。
            它防的是误点「清空所有数据」这类手滑，防不了清缓存和换手机，那两条只有把 JSON 备份发到聊天才救得回来。
          </Text>
        </View>
      </View>

      <View className='settings-group'>
        <View className='settings-group__title'>关于</View>
        {/* 反馈走微信原生客服会话：个人主体可以收消息、不能主动下发，
            对「收反馈」这个用途完全够用。点击直接进会话，不需要自建后端。
            前提是后台「功能 → 客服消息」已绑好客服微信号，否则点了进不去。 */}
        <Button
          className='settings-row settings-row--button'
          hoverClass='settings-row--hover'
          openType='contact'
        >
          <Icon name='wechat' size={18} />
          <Text className='settings-row__label'>
            反馈与建议
            <Text className='settings-row__sub'>想加的功能、用着别扭的地方，直接说</Text>
          </Text>
          <Icon className='row__chevron' name='forward' size={15} />
        </Button>
        <View className='settings-row'>
          <Icon name='book' size={18} />
          <Text className='settings-row__label'>应用版本</Text>
          <Text className='settings-row__value'>v{APP_VERSION}</Text>
        </View>
        <View className='settings-row'>
          <Icon name='wallet' size={18} />
          <Text className='settings-row__label'>本地数据占用</Text>
          <Text className='settings-row__value'>{usage}</Text>
        </View>
        <View className='settings-row'>
          <Icon name='refresh' size={18} />
          <Text className='settings-row__label'>数据存放</Text>
          <Text className='settings-row__value'>仅保存在本机</Text>
        </View>
        <View className='settings-row settings-row--note'>
          <Icon name='warn' size={18} />
          <Text className='settings-note'>
            数据只保存在这台手机的微信里，不上传服务器、无广告、无账号。
            在微信里「删除小程序」或「清理微信存储空间」会把记录一起清掉。
            本机有四层保护：改动自动留上一版可回滚、每次使用自动生成 Excel 存档、
            可导出 JSON 长期保存、换手机时用「从备份恢复」带回来。
            前两层都在手机里，只有发到聊天的才能跨设备。
          </Text>
        </View>
      </View>

      <View className='settings-foot' />

      {sheet === 'currency' ? (
        <Sheet onClose={() => setSheet(null)} title='货币符号'>
          <View className='settings-group sheet-group'>
            {CURRENCIES.map((item) => (
              <View
                className='settings-row' hoverClass='settings-row--hover'
                key={item}
                onClick={() => {
                  updateSettings({ currency: item });
                  setSheet(null);
                }}
              >
                <Text className='settings-row__label'>{item}</Text>
                {data.settings.currency === item ? (
                  <Icon name='check' size={16} style={{ color: 'var(--accent-deep)' }} />
                ) : null}
              </View>
            ))}
          </View>
        </Sheet>
      ) : null}

      {sheet === 'monthDay' ? (
        <Sheet onClose={() => setSheet(null)} title='每月起始日'>
          <View className='sheet-hint'>
            设为 1 即自然月；设为其他日期时，「本月」区间从该日开始（如 5 日 → 5 日至次月 4 日）。
          </View>
          <View className='settings-group sheet-group'>
            {MONTH_DAYS.map((item) => (
              <View
                className='settings-row' hoverClass='settings-row--hover'
                key={item}
                onClick={() => {
                  updateSettings({ monthStartDay: item });
                  setSheet(null);
                }}
              >
                <Text className='settings-row__label'>每月 {item} 日</Text>
                {data.settings.monthStartDay === item ? (
                  <Icon name='check' size={16} style={{ color: 'var(--accent-deep)' }} />
                ) : null}
              </View>
            ))}
          </View>
        </Sheet>
      ) : null}

      {/* 恢复前的元信息确认：条数 + 日期区间，让人一眼认出选的是哪一份 */}
      {pendingImport ? (
        <ConfirmDialog
          confirmText='覆盖'
          description={`这份备份有 ${pendingImport.data?.txs.length ?? 0} 条流水${
            pendingImport.range
              ? `，记账日期从 ${pendingImport.range.from} 到 ${pendingImport.range.to}`
              : ''
          }。确认后会替换当前所有账本的数据；当前状态会先存一份，随时能换回来。`}
          onCancel={() => setPendingImport(null)}
          onConfirm={doConfirmImport}
          title='用这份备份覆盖？'
        />
      ) : null}

      {/* 无近期导出的前置拦截。取消即安全出口：什么都不做，回到设置页 */}
      {resetGate ? (
        <ConfirmDialog
          confirmText='仍然清空'
          description={`${
            lastExport
              ? `最近一次把备份发出去是 ${Math.floor((Date.now() - lastExport) / 86_400_000)} 天前。`
              : '还没有把备份发出去过。'
          }清空之后手机里只剩自动存档，而自动存档和微信缓存同生共死——清理存储空间或删除小程序，数据就真的没有了。建议先取消，用「导出完整备份」发一份到聊天。`}
          onCancel={() => setResetGate(false)}
          onConfirm={() => {
            setResetGate(false);
            setConfirmReset(true);
          }}
          title='清空后可能再也找不回来'
          tone='danger'
        />
      ) : null}

      {confirmReset ? (
        <ConfirmDialog
          description='将删除本机所有账本、流水、账户与设置，且无法撤销。建议先导出备份。'
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            resetAll();
            setConfirmReset(false);
            toast('已清空所有数据');
          }}
          title='清空所有数据？'
          tone='danger'
        />
      ) : null}

      {confirmDemo ? (
        <ConfirmDialog
          confirmText='载入'
          description='会在当前账本生成近 3 个月的演示流水、预算与模板，仅用于体验图表。可随时通过「清空所有数据」移除。'
          onCancel={() => setConfirmDemo(false)}
          onConfirm={() => {
            loadDemo();
            setConfirmDemo(false);
            toast('演示数据已生成');
          }}
          title='载入演示数据？'
        />
      ) : null}

      {confirmRestore ? (
        <ConfirmDialog
          confirmText='恢复'
          description={`将把数据换回上一次保存前的状态（${backupLabel}的存档）。这之后的修改会被替换掉，但当前状态同样会先存一份，随时能再换回来。`}
          onCancel={() => setConfirmRestore(false)}
          onConfirm={doRestore}
          title='回到上一个存档？'
        />
      ) : null}

      {archiveOpen ? (
        <Sheet onClose={() => setArchiveOpen(false)} title='本机自动存档'>
          <View className='sheet-hint'>
            表格可以直接点开预览，打开后用右上角菜单还能转发出去；JSON 快照用于把整份数据换回来。
          </View>
          <View className='settings-group sheet-group'>
            {archives.length === 0 ? (
              <View className='settings-row'>
                <Text className='settings-row__label'>还没有存档，记一笔后会自动生成</Text>
              </View>
            ) : (
              archives.map((entry) => (
                <View className='settings-row' hoverClass='settings-row--hover' key={entry.name} onClick={() => onArchiveTap(entry)}>
                  <Icon name={entry.kind === 'xlsx' ? 'list' : 'download'} size={18} />
                  <Text className='settings-row__label'>
                    {entry.name}
                    <Text className='settings-row__sub'>
                      {formatBytes(entry.size)} · {relativeDay(entry.mtime)} ·{' '}
                      {entry.kind === 'xlsx' ? '点开预览' : '点此恢复整份数据'}
                    </Text>
                  </Text>
                  <Icon className='row__chevron' name='forward' size={15} />
                </View>
              ))
            )}
          </View>
        </Sheet>
      ) : null}

      {confirmArchive ? (
        <ConfirmDialog
          confirmText='恢复'
          description={`将用这份快照替换当前所有账本的数据。当前状态会先自动存一份，随时能再换回来。`}
          onCancel={() => setConfirmArchive(null)}
          onConfirm={doRestoreArchive}
          title='从这份快照恢复？'
        />
      ) : null}

      <BackupPrompt />
    </View>
  );
}
