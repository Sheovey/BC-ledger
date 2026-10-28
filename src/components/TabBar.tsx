import { View, Text } from '@tarojs/components';
import { Icon, type IconName } from './Icon';
import { navigate, replaceTo } from '@/router';

/**
 * 底部导航（小程序版）。
 *
 * 与 Web 版（ledger-app/src/components/TabBar.tsx）的两处差异：
 * 1. 当前页不再从 store 的路由栈里推断 —— 小程序是原生页面栈，没有统一的 route 数组，
 *    因此由各页面显式传 active，谁渲染谁负责，避免多页面下高亮错位。
 * 2. 切换用 redirectTo 而非 reLaunch：redirect 只替换当前页，
 *    不会把整个页面栈清空再重建，切 tab 更快且不闪白。
 */

export type TabKey = 'home' | 'ledger' | 'stats' | 'accounts' | 'settings';

interface TabBarProps {
  active: TabKey;
}

export function TabBar({ active }: TabBarProps) {
  const item = (key: TabKey, label: string, icon: IconName) => (
    <View
      className={`tabbar__item ${active === key ? 'tabbar__item--active' : ''}`}
      onClick={() => {
        if (active === key) return;
        replaceTo({ name: key });
      }}
    >
      <Icon name={icon} size={21} />
      <Text className='tabbar__label'>{label}</Text>
    </View>
  );

  return (
    <View className='tabbar'>
      {item('home', '首页', 'home')}
      {item('ledger', '流水', 'list')}
      <View className='tabbar__add' onClick={() => navigate({ name: 'record' })}>
        <View className='tabbar__add-inner'>
          <Icon name='plus' size={17} strokeWidth={2.2} />
          <Text className='tabbar__add-label'>记一笔</Text>
        </View>
      </View>
      {item('stats', '图表', 'pie')}
      {item('settings', '我的', 'settings')}
    </View>
  );
}
