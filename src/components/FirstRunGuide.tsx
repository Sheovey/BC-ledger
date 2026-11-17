/**
 * 首次使用引导。
 *
 * 三条硬约束，缺一条都会出问题：
 *
 * 1. **必须遮住底部 tabBar。** tabBar 由框架渲染在页面之上，页面内的 z-index
 *    管不到它（这坑在「切换账本」弹层上已经踩过）。这里靠 useUiStore.sheetDepth
 *    让 tabBar 主动隐藏，而不是靠层级硬顶。
 * 2. **只做介绍，不夹带授权。** 微信明确要求「用户未触发需权限或个人信息的功能，
 *    不能提前弹窗申请」。所以这一屏不含任何授权、不伪装成隐私协议；
 *    「我知道了」只是一个开始按钮。
 * 3. **必须把缺点写进去。** 这个应用最大的风险是数据只在本机，
 *    而「无广告、无账号、不上传」正是它的卖点——卖点和风险是同一件事，
 *    只讲卖点等于误导。
 */
import { useEffect, useState } from 'react';
import { View, Text } from '@tarojs/components';
import { Icon } from './Icon';
import { useUiStore } from '@/store/ui';
import { markOnboarded, shouldAutoShow } from '@/utils/onboard';

export function FirstRunGuide() {
  const [visible, setVisible] = useState(() => shouldAutoShow());
  const openSheet = useUiStore((s) => s.openSheet);
  const closeSheet = useUiStore((s) => s.closeSheet);

  // 引导期间隐藏 tabBar：它压在页面之上，不隐藏就会从引导层下面露出来
  useEffect(() => {
    if (!visible) return;
    openSheet();
    return closeSheet;
  }, [visible, openSheet, closeSheet]);

  if (!visible) return null;

  const done = () => {
    markOnboarded();
    setVisible(false);
  };

  return (
    <View className='guide'>
      <View className='guide__card'>
        <View className='guide__head'>
          <Text className='guide__title'>半寸册</Text>
          <Text className='guide__sub'>一本只属于你自己的账</Text>
        </View>

        <View className='guide__row'>
          <Icon name='book' size={18} />
          <Text className='guide__text'>记收支、看统计、管多个账本。不用注册，打开就能记。</Text>
        </View>

        <View className='guide__row'>
          <Icon name='check' size={18} />
          <Text className='guide__text'>
            无广告、无账号、断网也能用。所有记录都不上传任何服务器——这是它最大的优点，也正是下面这条提醒的由来。
          </Text>
        </View>

        <View className='guide__row guide__row--warn'>
          <Icon name='warn' size={18} />
          <Text className='guide__text'>
            数据只存在这台手机的微信里。删除小程序、清理微信存储空间、换手机，记录会一起消失。请定期到「我的 → 导出完整备份」把备份发到聊天存一份。
          </Text>
        </View>

        <View className='btn btn--primary btn--block guide__btn' hoverClass='btn--hover' onClick={done}>
          我知道了，开始记账
        </View>
      </View>
    </View>
  );
}
