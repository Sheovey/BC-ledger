import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { Icon, type IconName } from '@/components/Icon';
import { useUiStore, type TabKey } from '@/store/ui';
import './index.scss';

/**
 * 自定义底部导航（微信 tabBar.custom = true 时由框架渲染）。
 *
 * 为什么从「页面内组件」改成「框架组件」：
 * 页面内自绘时，四个 tab 只能是普通页面，切换必须用 redirectTo（销毁+新建），
 * 每点一次重建整页 —— 实测 280~500ms、峰值 3s、且逐轮递增。声明 tabBar 之后
 * 它们才是真正的 tab 页，切换走 switchTab，页面常驻，稳态 30~90ms。
 * 视觉一并沿用，因为原生 tabBar 做不出中间凸起的「记一笔」。
 *
 * 三点实现约束：
 * 1. 每个 tab 页各有一个本组件实例，状态不共享，所以高亮只能读 useUiStore
 *    这个公共信源（由各页 useDidShow 写入），不能靠组件自己的 useState 推导。
 * 2. 样式类 .tabbar 定义在全局 components.scss 里，因此下方必须声明
 *    options.addGlobalClass，否则组件样式隔离会让它取不到、渲染成无样式的竖排文字。
 * 3. 不要换成 cover-view：本项目图标是 <View> + CSS mask，cover-view 里放不了 View。
 *    代价是普通 view 的层级不如 cover-view 稳，但弹层（z-index 100）能正常盖住它，
 *    反而更符合预期。
 */

const TABS: { key: TabKey; label: string; icon: IconName; path: string }[] = [
  { key: 'home', label: '首页', icon: 'home', path: '/pages/home/index' },
  { key: 'ledger', label: '流水', icon: 'list', path: '/pages/ledger/index' },
  { key: 'stats', label: '图表', icon: 'pie', path: '/pages/stats/index' },
  { key: 'settings', label: '我的', icon: 'settings', path: '/pages/settings/index' },
];

function CustomTabBar() {
  const active = useUiStore((s) => s.activeTab);

  const item = (tab: (typeof TABS)[number]) => (
    <View
      key={tab.key}
      className={`tabbar__item ${active === tab.key ? 'tabbar__item--active' : ''}`}
      onClick={() => {
        if (active === tab.key) return;
        // tab 页必须 switchTab；redirectTo / navigateTo 对 tab 页会直接失败
        Taro.switchTab({ url: tab.path }).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[tabbar] switchTab 失败:', err?.errMsg ?? err);
        });
      }}
    >
      <Icon name={tab.icon} size={21} />
      <Text className='tabbar__label'>{tab.label}</Text>
    </View>
  );

  return (
    <View className='tabbar'>
      {item(TABS[0])}
      {item(TABS[1])}
      <View
        className='tabbar__add'
        onClick={() => {
          // 记一笔不是 tab 页，用 navigateTo 叠在 tab 页之上，返回即回到原 tab
          Taro.navigateTo({ url: '/pages/record/index' }).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[tabbar] 打开记一笔失败:', err?.errMsg ?? err);
          });
        }}
      >
        <View className='tabbar__add-inner'>
          <Icon name='plus' size={17} strokeWidth={2.2} />
          <Text className='tabbar__add-label'>记一笔</Text>
        </View>
      </View>
      {item(TABS[2])}
      {item(TABS[3])}
    </View>
  );
}

/** 全局样式类在 app.wxss 里，组件必须开启 addGlobalClass 才能取到 */
CustomTabBar.options = { addGlobalClass: true };

export default CustomTabBar;
