import type { ReactNode } from 'react';
import { View, Text } from '@tarojs/components';
import { Icon } from './Icon';
import { useNavMetrics } from '@/hooks/useNavMetrics';
import { back } from '@/router';

/**
 * 二级页通用的自绘导航栏。
 *
 * 为什么不用原生导航栏（navigationBarTitleText）：
 * 原生栏只有「标题 + 右侧胶囊」，做不了副标题、也放不下两个操作按钮；
 * 而且小程序胶囊按钮固定占位在右上角，右侧按钮必须自己避让，
 * 这套度量已经在 useNavMetrics 里算好，顺带在这里复用。
 *
 * 目前 accounts 页还在用自己的 .acc-head（早期写的，功能一致），
 * 后续统一时可以直接换成这个组件。
 */

interface PageHeadProps {
  title: string;
  subtitle?: string;
  /** 右侧操作区（0~2 个 icon-btn），已自动让开胶囊 */
  right?: ReactNode;
  /** 默认返回上一页；需要特定落点时传进来 */
  onBack?: () => void;
}

export function PageHead({ title, subtitle, right, onBack }: PageHeadProps) {
  const nav = useNavMetrics();

  return (
    <View>
      <View style={{ height: `${nav.statusBar}px` }} />
      <View className='page-head' style={{ paddingRight: `${nav.rightInset}px` }}>
        <View className='icon-btn' hoverClass='icon-btn--hover' onClick={() => (onBack ? onBack() : back())}>
          <Icon name='back' size={20} />
        </View>
        <View className='page-head__main'>
          <Text className='page-head__title'>{title}</Text>
          {subtitle ? <Text className='page-head__sub'>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}
