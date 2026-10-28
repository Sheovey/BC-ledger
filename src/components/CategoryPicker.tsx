import { useMemo, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import type { Category, LedgerData } from '@/types';
import { Icon } from './Icon';
import { categoryTree } from '@/store/selectors';

/**
 * 分类选择器（小程序版）。逻辑与 Web 版一致：
 * 二级结构 — 上方根分类宫格，下方对应子分类横排；无子分类时点根分类即选中。
 * 渲染原语换成 View/Text，内联 flex 布局抽成语义类（WXSS 对 inline gap 支持不稳）。
 *
 * 子分类横排用 ScrollView(scrollX) 而不是 Web 版的 overflow-x:auto：
 * 弹层本身要纵向滚动，横竖两向都交给浏览器自带的 overflow 处理时，
 * 手指摸着横排往回滑会先把弹层滚下去，实际点不到被裁掉的那几个子分类。
 */

interface CategoryPickerProps {
  data: LedgerData;
  type: 'expense' | 'income';
  selectedId: string | null;
  onSelect: (id: string) => void;
  onManage?: () => void;
}

export function CategoryPicker({ data, type, selectedId, onSelect, onManage }: CategoryPickerProps) {
  const tree = useMemo(() => categoryTree(data.categories, type), [data.categories, type]);
  const byId = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const initialRoot = selected ? (selected.parentId ?? selected.id) : null;
  const [activeRoot, setActiveRoot] = useState<string | null>(initialRoot ?? tree[0]?.id ?? null);

  const recent = useMemo(() => {
    return data.settings.recentCategoryIds
      .map((id) => byId.get(id))
      .filter((c): c is Category => Boolean(c && c.type === type && !c.archived))
      .slice(0, 8);
  }, [data.settings.recentCategoryIds, byId, type]);

  const active = tree.find((root) => root.id === activeRoot) ?? tree[0];

  return (
    <View>
      {recent.length ? (
        <View className='picker__recent'>
          <Text className='picker__recent-label'>最近使用</Text>
          <View className='picker__chips'>
            {recent.map((category) => (
              <View
                className={`chip ${selectedId === category.id ? 'chip--active' : ''}`}
                key={category.id}
                onClick={() => onSelect(category.id)}
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
            className={`cat-item ${activeRoot === root.id ? 'cat-item--active' : ''}`} hoverClass='cat-item--hover'
            key={root.id}
            onClick={() => {
              setActiveRoot(root.id);
              if (!root.children.length) onSelect(root.id);
            }}
          >
            <View className='cat-item__bubble' style={{ background: root.color }}>
              <Icon name={root.icon} size={20} />
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
                className={`cat-sub ${selectedId === child.id ? 'cat-sub--active' : ''}`}
                key={child.id}
                onClick={() => onSelect(child.id)}
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
