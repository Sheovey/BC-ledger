import { useMemo, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import type { Category, LedgerData } from '@/types';
import { Icon } from './Icon';
import { categoryTree } from '@/store/selectors';

/**
 * 分类选择器（小程序版）。
 *
 * 结构：上方根分类宫格，下方对应子分类横排。**一级分类只能一个，子分类可多选**。
 *
 * 多选的边界（关键设计）：
 * - 勾中别的根下的子分类时，把之前那个根的整组**替换掉**，而不是叠加。
 *   这是「一级只能一个」的直接含义 —— 允许跨根累积就等于允许多个一级分类，
 *   统计上那一笔的金额该归谁就说不清了。
 * - 金额不分摊：selectedIds 的顺序决定主分类（第一个被勾的），
 *   金额永远记在主分类上，其余只是「这笔钱还涉及哪些细项」的标签。
 *
 * 点击子分类不再自动关弹层：多选需要连续点。选择是即时生效的（onChange 立刻回传），
 * 所以点遮罩关掉也不会丢；底部「完成」只是「我选好了」的确认动作。
 *
 * 子分类横排用 ScrollView(scrollX) 而不是 Web 版的 overflow-x:auto：
 * 弹层本身要纵向滚动，横竖两向都交给浏览器自带的 overflow 处理时，
 * 手指摸着横排往回滑会先把弹层滚下去，实际点不到被裁掉的那几个子分类。
 */

interface CategoryPickerProps {
  data: LedgerData;
  type: 'expense' | 'income';
  /** 已选分类 id，第一个是主分类（金额归属看它的根分类） */
  selectedIds: string[];
  /** 勾选变化 */
  onChange: (ids: string[]) => void;
  /**
   * 是否多选。默认 false —— 点一下即选毕，由调用方在 onPick 里关弹层（模板页就是这种用法，
   * 模板只存一个分类）。true 时点击只切换勾选、不关弹层，收尾交给底部「完成」。
   */
  multiple?: boolean;
  /** 单选模式下点中某个分类后的回调，通常用来关弹层 */
  onPick?: (id: string) => void;
  onManage?: () => void;
}

export function CategoryPicker({
  data,
  type,
  selectedIds,
  onChange,
  multiple = false,
  onPick,
  onManage,
}: CategoryPickerProps) {
  const tree = useMemo(() => categoryTree(data.categories, type), [data.categories, type]);
  const byId = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  /** 所属根分类 id；本身是根就返回自己 */
  const rootIdOf = (id: string) => byId.get(id)?.parentId ?? id;

  const first = selectedIds.length ? byId.get(selectedIds[0]) : undefined;
  const [activeRoot, setActiveRoot] = useState<string | null>(
    first ? rootIdOf(first.id) : tree[0]?.id ?? null,
  );

  const active = tree.find((root) => root.id === activeRoot) ?? tree[0];

  const isSelected = (id: string) => selectedIds.includes(id);
  const countOfRoot = (rootId: string) => selectedIds.filter((id) => rootIdOf(id) === rootId).length;

  /**
   * 点一个分类。
   * 单选模式：选中 + 立刻回调关闭（模板页）；
   * 多选模式：切换勾选，同根内累加、跨根则替换 —— 保证结果里永远只有一个一级分类。
   */
  const pick = (id: string) => {
    if (!multiple) {
      onChange([id]);
      onPick?.(id);
      return;
    }
    const rootKey = rootIdOf(id);
    const sameRoot = selectedIds.filter((x) => rootIdOf(x) === rootKey);
    if (sameRoot.includes(id)) onChange(sameRoot.filter((x) => x !== id));
    else onChange([...sameRoot, id]);
  };

  const recent = useMemo(() => {
    return data.settings.recentCategoryIds
      .map((id) => byId.get(id))
      .filter((c): c is Category => Boolean(c && c.type === type && !c.archived))
      .slice(0, 8);
  }, [data.settings.recentCategoryIds, byId, type]);

  return (
    <View>
      {multiple ? (
        <View className='picker__hint'>一级分类只能选一个，子分类可多选</View>
      ) : null}

      {recent.length ? (
        <View className='picker__recent'>
          <Text className='picker__recent-label'>最近使用</Text>
          <View className='picker__chips'>
            {recent.map((category) => (
              <View
                className={`chip ${isSelected(category.id) ? 'chip--active' : ''}`}
                key={category.id}
                onClick={() => pick(category.id)}
              >
                {category.name}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View className='cat-grid'>
        {tree.map((root) => (
          <View
            className={`cat-item ${activeRoot === root.id ? 'cat-item--active' : ''}`}
            hoverClass='cat-item--hover'
            key={root.id}
            onClick={() => {
              setActiveRoot(root.id);
              // 没有子分类的根：点它本身就是选中（例如「其他」）
              if (!root.children.length) pick(root.id);
            }}
          >
            <View className='cat-item__bubble' style={{ background: root.color }}>
              <Icon name={root.icon} size={22} />
              {/* 角标表示「这个一级分类下已勾了几项」，与描边表示的「正在浏览」区分开 */}
              {countOfRoot(root.id) ? (
                <View className='cat-item__badge'>{countOfRoot(root.id)}</View>
              ) : null}
            </View>
            <Text className='cat-item__name'>{root.name}</Text>
          </View>
        ))}
      </View>

      {active?.children.length ? (
        <ScrollView className='cat-sub-scroll' scrollX>
          {/* 注意：flex 必须放在内层 View 上。ScrollView 在 WXML 里会再包一层
              滚动容器，把 display:flex 写在 ScrollView 上，子项会退化成块级、竖着排。 */}
          <View className='cat-sub-row'>
            {active.children.map((child) => (
              <View
                className={`cat-sub ${isSelected(child.id) ? 'cat-sub--active' : ''}`}
                key={child.id}
                onClick={() => pick(child.id)}
              >
                {child.name}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {onManage ? (
        <View className='text-btn picker__manage' hoverClass='text-btn--hover' onClick={onManage}>
          管理分类
        </View>
      ) : null}
    </View>
  );
}
