import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';

/**
 * 自绘导航栏需要的两个尺寸。
 *
 * Web 版顶部栏由浏览器排版，小程序要自己算：
 *
 * 1. statusBar：状态栏（刘海／时间电量那一条）高度。navigationStyle=custom 后
 *    页面从屏幕最顶开始画，不让出这块内容会被状态栏盖住。
 * 2. rightInset：右上角「胶囊按钮」占掉的宽度。硬编码一个值在不同机型
 *    （尤其大字号模式）下仍会重叠，实测第一版「保存」就被压在胶囊底下点不到，
 *    所以必须问 getMenuButtonBoundingClientRect 要真实坐标。
 *
 * 两个值都带默认值，任何一步取不到都不会让页面崩掉，只是留白略保守。
 */
export interface NavMetrics {
  statusBar: number;
  rightInset: number;
  /** 导航栏单行高度（与微信原生导航栏一致的 44px） */
  barHeight: number;
}

const FALLBACK: NavMetrics = { statusBar: 20, rightInset: 96, barHeight: 44 };

export function useNavMetrics(): NavMetrics {
  const [metrics, setMetrics] = useState<NavMetrics>(FALLBACK);

  useEffect(() => {
    try {
      const info = Taro.getWindowInfo ? Taro.getWindowInfo() : Taro.getSystemInfoSync();
      const statusBar = info?.statusBarHeight || FALLBACK.statusBar;

      let rightInset = FALLBACK.rightInset;
      try {
        const rect = Taro.getMenuButtonBoundingClientRect();
        if (rect && rect.left > 0 && rect.width > 0 && info?.windowWidth) {
          // 胶囊右边缘到屏幕右边的留白（通常 7px），再多给 8px 间隙
          rightInset = Math.max(0, info.windowWidth - rect.left) + 8;
        }
      } catch {
        /* 取不到胶囊位置就用默认值，宁可多留白也不要重叠 */
      }

      setMetrics({ statusBar, rightInset, barHeight: FALLBACK.barHeight });
    } catch {
      /* 读不到系统信息就用默认值，不影响功能 */
    }
  }, []);

  return metrics;
}
