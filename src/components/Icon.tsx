import type { CSSProperties } from 'react';
import { View } from '@tarojs/components';
import { ICON_NAMES, type IconName } from './icon-names';

/**
 * 小程序版图标组件。
 *
 * 与 Web 版（ledger-app/src/components/Icon.tsx）的关键差异：
 * - Web 版用内联 <svg>，小程序 WXML 没有 svg 标签，因此改为
 *   「CSS mask + SVG data-uri」：样式类里放 -webkit-mask-image: url("data:image/svg+xml,...")，
 *   元素本身只设置 background-color: currentColor。
 * - 这样颜色的来源与 Web 版完全一致：跟随父级 color 继承。
 *   实测（pages/icon-test）父级设 color: red 时图标变红，120 处依赖继承的调用无需改动。
 * - strokeWidth 在数据 URI 里已固化（默认 1.65），运行期无法改变线条粗细；
 *   目前只有 TabBar 的「+」需要 2.2，为此单独提供了一个加粗变体。
 *
 * 图标数据由 scripts/gen-icons.cjs 从 Web 版 Icon.tsx 自动转换，勿手改 icon.scss。
 */

const KNOWN = new Set<string>(ICON_NAMES as readonly string[]);

export type { IconName };

export interface IconProps {
  name: IconName;
  size?: number;
  /** 仅为保持与 Web 版接口一致；>2 时对 plus 生效（使用加粗变体） */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, strokeWidth, className, style }: IconProps) {
  const safeName = KNOWN.has(name) ? name : 'other';
  const thick = safeName === 'plus' && strokeWidth !== undefined && strokeWidth >= 2;
  const cls = ['ic', `ic-${safeName}${thick ? '--thick' : ''}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <View
      className={cls}
      style={{ width: `${size}px`, height: `${size}px`, ...style }}
    />
  );
}

export default Icon;
