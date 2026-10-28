import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Canvas } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { StatItem } from '@/store/selectors';
import { formatMoney } from '@/utils/money';

/**
 * 环形图（小程序版）。
 *
 * Web 版是纯 SVG（<circle> + stroke-dasharray），WXML 里没有 svg 标签，
 * 照搬会渲染成空白 —— 这是迁移到小程序时唯一必须换实现的可视化组件。
 *
 * 这里换成 Canvas 2D：
 * - 用 stroke 画弧（同一套「弧度换算成角度」的算法），不用 path 填色，
 *   单一项占 100% 时也不会出现接缝。
 * - 中心的总金额不画在 canvas 上，而是用 View 绝对定位叠在上面。
 *   理由：canvas 里画文字取不到 CSS 变量，暗色主题下颜色会写死；
 *   叠一层 View 则完全走 WXSS，字号/颜色/字重都能跟着主题变。
 *
 * 点击命中：canvas 拿不到「第几段被点了」，只能自己算角度。
 * 每次触摸都重新查一次 canvas 位置（页面可能已经滚动过），
 * 再用 atan2 换算成从 12 点方向顺时针的角度，落进哪段就选哪段。
 */

const SIZE = 232;
const STROKE = 26;
const RADIUS = 78;
/** = --surface-3，canvas 读不到 CSS 变量，只能取当前主题下的实际色值 */
const TRACK_COLOR = '#f1efeb';
/** 相邻扇区之间留的空隙，换算成角度（对应 Web 版 dasharray 里减掉的 2px） */
const GAP_PX = 2;

interface DonutChartProps {
  items: StatItem[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  total: number;
  centerLabel: string;
  currency: string;
  size?: number;
}

export function DonutChart({
  items,
  activeKey,
  onSelect,
  total,
  centerLabel,
  currency,
  size = SIZE,
}: DonutChartProps) {
  const canvasId = useRef(`donut-${Math.random().toString(36).slice(2, 8)}`).current;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctxRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  const circumference = 2 * Math.PI * RADIUS;

  /** 每段的起点角度与跨度，绘制和命中判定共用同一份，避免两处算法漂移 */
  const segments = useMemo(() => {
    let startRatio = 0;
    return items.map((item) => {
      const ratio = total > 0 ? item.amount / total : 0;
      const segment = { ...item, ratio, startRatio };
      startRatio += ratio;
      return segment;
    });
  }, [items, total]);

  // 初始化 canvas 节点：必须在首帧之后，否则 select 拿不到节点
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      Taro.createSelectorQuery()
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (cancelled) return;
          const info = res?.[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const node = (info as any)?.node;
          if (!node) return;
          const dpr = Taro.getWindowInfo ? Taro.getWindowInfo().pixelRatio : 2;
          node.width = size * dpr;
          node.height = size * dpr;
          const ctx = node.getContext('2d');
          if (!ctx) return;
          // 按设备像素比放大画布后，后续所有坐标仍按 CSS 像素算
          ctx.scale(dpr, dpr);
          ctxRef.current = ctx;
          setReady(true);
        });
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canvasId, size]);

  // 数据或选中项变了就重绘
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ready || !ctx || !segments.length || total <= 0) return;

    ctx.clearRect(0, 0, size, size);
    const center = size / 2;

    // 底圈：占位提示「一圈有多粗」
    ctx.beginPath();
    ctx.arc(center, center, RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = STROKE;
    ctx.strokeStyle = TRACK_COLOR;
    ctx.stroke();

    const gapAngle = (GAP_PX / circumference) * Math.PI * 2;

    for (const segment of segments) {
      if (segment.ratio <= 0) continue;
      const startAngle = -Math.PI / 2 + segment.startRatio * Math.PI * 2;
      const endAngle = startAngle + segment.ratio * Math.PI * 2;
      const isActive = activeKey === segment.key;

      ctx.beginPath();
      // 跨度比空隙还小时不留缝，否则会画成负长度圆弧（什么都不显示）
      const drawEnd = endAngle - startAngle > gapAngle * 2 ? endAngle - gapAngle : endAngle;
      ctx.arc(center, center, RADIUS, startAngle, drawEnd);
      ctx.lineWidth = isActive ? STROKE + 6 : STROKE;
      ctx.strokeStyle = segment.color;
      // 选中某项时其余淡化，和 Web 版的 opacity: .42 一致
      ctx.globalAlpha = activeKey && !isActive ? 0.42 : 1;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [ready, segments, activeKey, total, size, circumference]);

  /** 点在环上哪一段：靠角度判断，半径不匹配时返回 null */
  const hitTest = (x: number, y: number): string | null => {
    const center = size / 2;
    const dx = x - center;
    const dy = y - center;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // 允许 ±14px 的手抖余量，环外面一点点也算命中
    if (distance < RADIUS - STROKE / 2 - 14 || distance > RADIUS + STROKE / 2 + 14) return null;

    // atan2 的 0 在 3 点方向，+90° 挪到 12 点，再归一化到 [0, 2π)
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;

    let cursor = 0;
    for (const segment of segments) {
      const next = cursor + segment.ratio * Math.PI * 2;
      if (angle >= cursor && angle < next) return segment.key;
      cursor = next;
    }
    return segments[segments.length - 1]?.key ?? null;
  };

  /**
   * 点在环上哪一段。
   *
   * 小程序的 CanvasTouch 给的是 x/y —— 已经是相对 canvas 左上角的坐标
   * （不是 clientX/clientY），所以真机上不需要再查 boundingClientRect。
   * 但自动化注入的触摸事件只有 clientX/pageX，这里补一条兜底，
   * 否则验收脚本无法点圆环，「点圆环切分类」这条链路永远测不到。
   */
  const resolvePoint = (
    touch: Record<string, unknown>,
  ): { x: number; y: number } | Promise<{ x: number; y: number } | null> | null => {
    if (typeof touch.x === 'number' && typeof touch.y === 'number') {
      return { x: touch.x, y: touch.y };
    }
    const viewportX = typeof touch.clientX === 'number' ? touch.clientX : touch.pageX;
    const viewportY = typeof touch.clientY === 'number' ? touch.clientY : touch.pageY;
    if (typeof viewportX !== 'number' || typeof viewportY !== 'number') return null;

    return new Promise((resolve) => {
      Taro.createSelectorQuery()
        .select(`#${canvasId}`)
        .boundingClientRect()
        .exec((res) => {
          const rect = (res?.[0] ?? null) as { left: number; top: number } | null;
          if (!rect) {
            resolve(null);
            return;
          }
          resolve({ x: viewportX - rect.left, y: viewportY - rect.top });
        });
    });
  };

  const handleTouch = (event: unknown) => {
    const e = event as {
      touches?: Array<Record<string, unknown>>;
      changedTouches?: Array<Record<string, unknown>>;
    };
    const touch = e.touches?.[0] ?? e.changedTouches?.[0];
    if (!touch) return;

    const apply = (point: { x: number; y: number } | null) => {
      if (!point) return;
      const key = hitTest(point.x, point.y);
      if (key) onSelect(key);
    };

    const resolved = resolvePoint(touch);
    if (resolved && typeof (resolved as Promise<unknown>).then === 'function') {
      void (resolved as Promise<{ x: number; y: number } | null>).then(apply);
    } else {
      apply(resolved as { x: number; y: number } | null);
    }
  };

  if (!items.length || total <= 0) {
    return (
      <View className='donut-empty' style={{ width: `${size}px`, height: `${size}px` }}>
        该时间段暂无数据
      </View>
    );
  }

  return (
    <View className='donut-canvas-wrap' style={{ width: `${size}px`, height: `${size}px` }}>
      <Canvas
        className='donut-canvas'
        id={canvasId}
        onTouchStart={handleTouch}
        style={{ width: `${size}px`, height: `${size}px` }}
        type='2d'
      />
      <View className='donut-center'>
        <View className='donut-center__label'>{centerLabel}</View>
        <View className='donut-center__value num'>
          {currency}
          {formatMoney(total, { digits: 2 })}
        </View>
      </View>
    </View>
  );
}
