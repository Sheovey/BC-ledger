import { useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { TabBar } from '@/components/TabBar';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { useNavMetrics } from '@/hooks/useNavMetrics';
import { getBook, summarize } from '@/store/selectors';
import { exportCsv, exportJson, pickAndParseBackup } from '@/db/dataIO';
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
import { describeSyncState } from '@/db/sync';
import { formatMoney } from '@/utils/money';
import { resolveRange, todayStr, withinRange } from '@/utils/date';
import { navigate } from '@/router';
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
 * 显示用版本号，**必须与微信后台上传的版本号一致**。
 * 提审时后台记录的版本来自 `cli upload -v`，界面这里读不到，只能手改同步。
 */
const APP_VERSION = '1.1.1';
const CURRENCIES = ['¥', '$', '€', '£'];
const MONTH_DAYS = [1, 5, 10, 15, 20, 25];

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
  const nav = useNavMetrics();

  const book = getBook(data);
  const [sheet, setSheet] = useState<'currency' | 'monthDay' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 导出/备份时间戳存在 storage 里，不随 store 变化，用 tick 手动触发重算 */
  const [stampTick, setStampTick] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTick, setArchiveTick] = useState(0);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  const exportLabel = useMemo(() => relativeDay(exportedAt()), [data, stampTick]);
  const backupLabel = useMemo(() => relativeDay(backupAt()), [data, stampTick]);
  const syncState = useMemo(() => describeSyncState(), [stampTick]);
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

  const doExportJson = async () => {
    if (busy) return;
    setBusy(true);
    const outcome = await exportJson(data);
    setBusy(false);
    if (outcome === 'shared') {
      // 只有文件真的交到用户手上才记时间：剪贴板那条路用户未必粘到别处，
      // 记成「已备份」会给出虚假的安全感。
      markExported();
      setStampTick((t) => t + 1);
      toast('备份文件已发出');
    } else if (outcome === 'copied') {
      toast('已复制备份全文到剪贴板');
    } else {
      toast('导出失败', 'warn');
    }
  };

  const doExportCsv = async () => {
    if (!book || busy) return;
    setBusy(true);
    const outcome = await exportCsv(data, book.id);
    setBusy(false);
    if (outcome === 'shared') toast('CSV 已发出');
    else if (outcome === 'copied') toast('已复制 CSV 全文到剪贴板');
    else toast('导出失败', 'warn');
  };

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
    importData(result.data);
    toast(result.message);
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
      toast('已发出，去聊天里存一份');
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
        <View className='settings-row' hoverClass='settings-row--hover' onClick={() => setConfirmReset(true)}>
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
          <Text className='settings-row__value'>{syncState.label}</Text>
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

      <TabBar active='settings' />

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
    </View>
  );
}
