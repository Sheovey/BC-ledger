import { useMemo, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { EmptyState } from '@/components/TxRow';
import { categoryTree } from '@/store/selectors';
import './index.scss';

/**
 * 分类管理（小程序版）。对应 Web 版 CategoriesPage.tsx。
 *
 * 改写点：
 * 1. 顶部换成公共 PageHead（返回 + 标题 + 加号）。
 * 2. 一级分类行拆成「可点区域 + 编辑 + 删除」三个并列容器，
 *    和 Web 版结构一致——小程序里点击会冒泡，把按钮嵌套在可点区域里
 *    会连带触发展开，拆开是最省事也最稳的做法（不依赖 stopPropagation）。
 * 3. 子分类用 chip 横排换行，Web 版是 flex-wrap，这边沿用。
 * 4. 新增子分类时 icon / color 直接继承父级。
 *    老 Web 版这里传的是表单 state（默认取第一个图标与第一个颜色），
 *    结果是子分类的图标和父级对不上——属于顺手修掉的既有缺陷。
 */

const ICON_CHOICES = [
  'food',
  'traffic',
  'shopping',
  'home',
  'fun',
  'medical',
  'edu',
  'phone',
  'gift',
  'finance',
  'other',
  'salary',
  'parttime',
  'invest',
  'income',
];

const COLORS = [
  '#f97362',
  '#f5a623',
  '#e8608c',
  '#7b8ff7',
  '#9b7bf0',
  '#4bb3a0',
  '#59a5f5',
  '#5cc9a7',
  '#ef7d9a',
  '#8a94a6',
];

export default function CategoriesPage() {
  const data = useStore((s) => s.data);
  const addCategory = useStore((s) => s.addCategory);
  const updateCategory = useStore((s) => s.updateCategory);
  const deleteCategory = useStore((s) => s.deleteCategory);

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; parentId: string | null } | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(ICON_CHOICES[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const tree = useMemo(() => categoryTree(data.categories, type), [data.categories, type]);

  const openNew = (parentId: string | null) => {
    const parent = parentId ? data.categories.find((c) => c.id === parentId) : null;
    setEditing({ id: null, parentId });
    setName('');
    setIcon(parent?.icon ?? ICON_CHOICES[0]);
    setColor(parent?.color ?? COLORS[0]);
  };

  const openEdit = (id: string) => {
    const category = data.categories.find((c) => c.id === id);
    if (!category) return;
    setEditing({ id, parentId: category.parentId });
    setName(category.name);
    setIcon(category.icon);
    setColor(category.color);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入分类名称', 'warn');
      return;
    }
    if (editing?.id) {
      updateCategory(editing.id, { name: trimmed, icon, color });
      toast('分类已更新');
    } else {
      addCategory({
        bookId: null,
        parentId: editing?.parentId ?? null,
        name: trimmed,
        type,
        icon,
        color,
      });
      toast('分类已创建');
    }
    setEditing(null);
  };

  const deleteTarget = pendingDelete ? data.categories.find((c) => c.id === pendingDelete) : null;
  const isRootTarget = Boolean(deleteTarget && !deleteTarget.parentId);

  return (
    <View className='shell shell--plain'>
      <PageHead
        right={
          <View className='icon-btn' hoverClass='icon-btn--hover' onClick={() => openNew(null)}>
            <Icon name='plus' size={20} />
          </View>
        }
        subtitle='两级分类，预设项可改可删'
        title='分类管理'
      />

      <View className='section cat-seg'>
        <View className='segmented'>
          <View
            className={`segmented__item ${type === 'expense' ? 'segmented__item--active' : ''}`}
            onClick={() => {
              setType('expense');
              setExpanded(null);
            }}
          >
            支出分类
          </View>
          <View
            className={`segmented__item ${type === 'income' ? 'segmented__item--active' : ''}`}
            onClick={() => {
              setType('income');
              setExpanded(null);
            }}
          >
            收入分类
          </View>
        </View>
      </View>

      <View className='section'>
        <View className='section__head'>
          <Text className='section__title'>{type === 'expense' ? '支出' : '收入'}一级分类</Text>
          <Text className='section__hint'>{tree.length} 个</Text>
        </View>

        {tree.length === 0 ? (
          <EmptyState description='点右上角加号新建一个分类' icon='tag' title='还没有分类' />
        ) : (
          <View className='tx-list'>
            {tree.map((root) => (
              <View className='cat-root' key={root.id}>
                <View className='cat-root__head'>
                  <View
                    className='row cat-root__row' hoverClass='row--hover'
                    onClick={() => setExpanded(expanded === root.id ? null : root.id)}
                  >
                    <View className='avatar avatar--sm' style={{ background: root.color }}>
                      <Icon name={root.icon} size={15} />
                    </View>
                    <View className='row__main'>
                      <Text className='row__title'>{root.name}</Text>
                      <Text className='row__meta'>{root.children.length} 个子分类</Text>
                    </View>
                    <Icon
                      className={`row__chevron cat-chev ${expanded === root.id ? 'cat-chev--open' : ''}`}
                      name='down'
                      size={14}
                    />
                  </View>
                  <View className='icon-btn icon-btn--plain' hoverClass='icon-btn--hover' onClick={() => openEdit(root.id)}>
                    <Icon name='edit' size={15} />
                  </View>
                  <View className='icon-btn icon-btn--plain' hoverClass='icon-btn--hover' onClick={() => setPendingDelete(root.id)}>
                    <Icon name='trash' size={15} />
                  </View>
                </View>

                {expanded === root.id ? (
                  <View className='cat-sub'>
                    <View className='cat-chips'>
                      {root.children.length === 0 ? (
                        <Text className='cat-sub__empty'>暂无子分类</Text>
                      ) : (
                        root.children.map((child) => (
                          <View className='chip cat-chip' key={child.id}>
                            <Text>{child.name}</Text>
                            <View className='cat-chip__x' onClick={() => setPendingDelete(child.id)}>
                              <Icon name='close' size={11} />
                            </View>
                          </View>
                        ))
                      )}
                    </View>
                    <View className='chip chip--active cat-add-child' onClick={() => openNew(root.id)}>
                      <Icon name='plus' size={12} />
                      <Text>添加子分类</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}

        <View className='btn btn--ghost btn--block cat-new-root' onClick={() => openNew(null)}>
          <Icon name='plus' size={16} />
          新增一级分类
        </View>
        <Text className='cat-note'>
          删除是软删除：历史流水仍显示原分类名，只是不再出现在记账选择器里。
        </Text>
      </View>

      {editing ? (
        <Sheet
          onClose={() => setEditing(null)}
          title={editing.id ? '编辑分类' : editing.parentId ? '新增子分类' : '新增一级分类'}
        >
          <View className='cat-form'>
            <View className='settings-group__title cat-form__label'>名称</View>
            <Input
              className='input'
              onInput={(event) => setName(event.detail.value)}
              placeholder='分类名称'
              placeholderClass='cat-ph'
              value={name}
            />

            {!editing.parentId ? (
              <View>
                <View className='settings-group__title cat-form__label cat-form__label--gap'>图标</View>
                <View className='cat-icons'>
                  {ICON_CHOICES.map((item) => (
                    <View
                      className={`icon-btn cat-icon ${icon === item ? 'cat-icon--on' : ''}`} hoverClass='icon-btn--hover'
                      key={item}
                      onClick={() => setIcon(item)}
                      style={{
                        background: icon === item ? color : undefined,
                        color: icon === item ? '#fff' : undefined,
                      }}
                    >
                      <Icon name={item} size={17} />
                    </View>
                  ))}
                </View>

                <View className='settings-group__title cat-form__label cat-form__label--gap'>颜色</View>
                <View className='cat-colors'>
                  {COLORS.map((item) => (
                    <View
                      className='cat-color'
                      key={item}
                      onClick={() => setColor(item)}
                      style={{
                        background: item,
                        // 选中环必须跟随所选颜色（内联变量），class 里拿不到
                        boxShadow:
                          color === item ? `0 0 0 2px var(--surface), 0 0 0 4px ${item}` : undefined,
                      }}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <Text className='cat-form__hint'>子分类沿用上级分类的图标与颜色。</Text>
            )}

            <View className='btn btn--primary btn--block cat-submit' onClick={submit}>
              保存
            </View>
          </View>
        </Sheet>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          description={
            isRootTarget
              ? '删除一级分类会同时停用其下所有子分类，历史记录不受影响。'
              : '删除后该分类不再出现在记账选择器里，历史记录不受影响。'
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteCategory(pendingDelete);
            toast('分类已删除');
            setPendingDelete(null);
          }}
          title='删除分类？'
          tone='danger'
        />
      ) : null}
    </View>
  );
}
