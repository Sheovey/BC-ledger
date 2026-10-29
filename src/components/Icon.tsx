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
 * - 图标图形取自 Phosphor Icons BOLD（@phosphor-icons/core，MIT），是填充路径而非描边，
 *   所以 strokeWidth 在运行期无法改变粗细（已烘焙进路径）。该 prop 只为兼容旧调用保留，
 *   仅对 plus 生效（切换到 .ic-plus--thick，形状同为 Bold 加号）。
 * - back/forward/down/up 四个 chevron 仍是手绘线描，线宽 2.0。
 *
 * 图标数据由 scripts/gen-icons.cjs 生成，勿手改 icon.scss / icon-names.ts。
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
