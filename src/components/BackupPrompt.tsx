/**
 * 备份提醒弹层。
 *
 * 为什么用 ConfirmDialog 而不是 Taro.showModal：
 * 微信的 shareFileMessage 只认「用户点击行为」。
 * showModal 的 .then() 回调已经离开了手势的同步调用栈，可能被判成非用户手势；
 * 而 ConfirmDialog 的按钮是 View onClick，与设置页「导出完整备份」完全同构——
 * 那条路径在线上 1.1.5 已经验证可用。
 *
 * 另有两条必须守住的顺序：
 * 1. 判定与冷却写在 utils/backupPrompt.ts，组件只管渲染；
 * 2. 导出失败也不把弹层留在屏幕上——用户已经点过了，留着他还得再点一次关闭。
 */
import { useState } from 'react';
import { exportJson } from '@/db/dataIO';
import { markExported } from '@/db/persist';
import { useStore, toast } from '@/store/useStore';
import { useUiStore, type BackupPromptInfo } from '@/store/ui';
import { dismissBackupPrompt, runAfterPrompt } from '@/utils/backupPrompt';
import { confirmShareDone } from '@/utils/confirmShare';
import { ConfirmDialog } from './Sheet';

/**
 * 文案刻意不写「你必须备份」。
 * 上传的实际去处是「文件传输助手」，所以要把它点出来——每次都可以发给不同的人，
 * 不固定目标的话，恢复时会不知道去哪找。
 *
 * 升级前（preUpgrade）单独一套话术：那个时机新包已下完但没应用，
 * 用户还没真正「更新」，所以不能说「刚更新到新版本」。
 */
function describe(info: BackupPromptInfo): string {
  if (info.preUpgrade) {
    return `小程序即将更新到新版本，这期间还有 ${info.newTx} 笔没备份。新版本首次启动会跑一次数据迁移，万一迁移出问题，备份是唯一的退路。先发到「文件传输助手」存好，再继续更新。`;
  }

  const parts: string[] = [];
  if (info.upgrade) parts.push('刚更新到新版本，先备份一份更稳妥。');
  if (info.days === null) {
    parts.push(`你已经记了 ${info.newTx} 笔，但还没把备份发出去过。`);
  } else if (info.days >= 1) {
    parts.push(`距上次备份 ${info.days} 天，这期间新增 ${info.newTx} 笔。`);
  } else {
    parts.push(`这期间新增 ${info.newTx} 笔。`);
  }
  parts.push('数据只在这台手机里，删除小程序或清理微信存储空间会一起清掉。发到「文件传输助手」存着，换手机还能找回来。');
  return parts.join('');
}

export function BackupPrompt() {
  const info = useUiStore((s) => s.backupPrompt);
  const [busy, setBusy] = useState(false);

  if (!info) return null;

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    const data = useStore.getState().data;
    // 从点击到 shareFileMessage 之间必须保持同步调用链，中间不能插别的 await
    const outcome = await exportJson(data);
    setBusy(false);
    dismissBackupPrompt();

    if (outcome === 'shared') {
      // 面板调起 ≠ 文件发出去了（用户可以直接返回）→ 问一次，确认后才记时间。
      // 这里的判断决定备份提醒未来两周是否还活着，不能猜。
      const done = await confirmShareDone();
      if (done) {
        markExported(data.txs.length);
        toast('已记录备份时间');
      } else {
        // 没发出就只如实说一句，不自动复制剪贴板（理由见 pages/settings 的 doExportJson）
        toast('这次没有记为备份，之后仍会提醒');
      }
    } else if (outcome === 'copied') {
      toast('已复制备份全文到剪贴板');
    } else {
      toast('导出失败，可到「我的」页手动备份', 'warn');
    }
    // 升级流程要接着弹「重启」。放到下一拍：此刻 Sheet 还在提交阶段卸载，
    // 立刻弹原生 modal 会和 tabBar 的恢复计数抢时序。
    setTimeout(runAfterPrompt, 0);
  };

  /** 跳过也要接上后续动作：用户不想备份，不代表他不想更新 */
  const skip = () => {
    dismissBackupPrompt();
    setTimeout(runAfterPrompt, 0);
  };

  return (
    <ConfirmDialog
      cancelText={info.preUpgrade ? '直接更新' : '稍后再问'}
      confirmText={info.preUpgrade ? '备份后继续' : '现在备份'}
      description={describe(info)}
      onCancel={skip}
      onConfirm={doExport}
      title={info.preUpgrade ? '更新前先备份一份' : '该把备份发出去一份了'}
    />
  );
}
