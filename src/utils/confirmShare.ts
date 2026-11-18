/**
 * 「文件发到聊天了吗」的确认。
 *
 * 存在理由：`wx.shareFileMessage` 的 success 只表示**接口调用完成**，不表示文件真的发出去了。
 * 实测（2026-11-18 老板真机）：在转发面板直接返回、并未选择任何聊天，仍然走 success 分支，
 * 于是界面提示「备份已发出」。腾讯对分享类接口的一贯口径也是「无论成功、失败、取消都回传成功」，
 * 目的是防止开发者用分享结果做诱导。
 *
 * 为什么不能含糊过去：这个结果直接决定要不要写 `markExported()`。
 * 误记为「已备份」→ 备份提醒在之后的 14 天里不再出现 → 用户以为有备份、实际没有。
 * 数据只在本机，这条误判的代价是数据全丢。所以宁可多问一次，也不能猜。
 */
import Taro from '@tarojs/taro';

export async function confirmShareDone(): Promise<boolean> {
  try {
    const res = await Taro.showModal({
      title: '文件发出去了吗？',
      content: '微信不会告诉我们文件是否真的发出。确认发出才记备份时间，否则过几天还会再提醒你。',
      confirmText: '已发出',
      cancelText: '没发出',
    });
    return Boolean(res.confirm);
  } catch {
    // 弹窗本身失败时按「没发出」处理：宁可多提醒一次，不可误记已备份
    return false;
  }
}
