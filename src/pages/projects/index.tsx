import { useMemo, useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import { useStore, toast } from '@/store/useStore';
import { Icon } from '@/components/Icon';
import { PageHead } from '@/components/PageHead';
import { Sheet, ConfirmDialog } from '@/components/Sheet';
import { EmptyState } from '@/components/TxRow';
import { getBook } from '@/store/selectors';
import { formatMoney, sumFen } from '@/utils/money';
import './index.scss';

/**
 * 项目（小程序版）。对应 Web 版 ProjectsPage.tsx。
 *
 * 项目是「跨分类归集」维度：装修、旅行、某次报销都会横跨餐饮/交通/购物多个分类，
 * 所以它的价值在统计页按项目维度看合计，列表这里只承担增删改与金额预览。
 *
 * 与 Web 版一致：删除项目是软删除，历史流水的 projectId 仍能解析出名字。
 */

const COLORS = ['#f0993e', '#e05a4f', '#7b8ff7', '#4bb3a0', '#e8608c', '#8a94a6'];

export default function ProjectsPage() {
  const data = useStore((s) => s.data);
  const addProject = useStore((s) => s.addProject);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const book = getBook(data);
  const bookId = book?.id ?? '';

  const projects = useMemo(
    () => data.projects.filter((p) => p.bookId === bookId && !p.archived),
    [data.projects, bookId],
  );

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const open = (id: string | 'new') => {
    setEditing(id);
    if (id === 'new') {
      setName('');
      setColor(COLORS[projects.length % COLORS.length]);
    } else {
      const project = projects.find((p) => p.id === id);
      setName(project?.name ?? '');
      setColor(project?.color ?? COLORS[0]);
    }
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请输入项目名称', 'warn');
      return;
    }
    if (editing === 'new') {
      addProject({ bookId, name: trimmed, color });
      toast('项目已创建');
    } else if (editing) {
      updateProject(editing, { name: trimmed, color });
      toast('项目已更新');
    }
    setEditing(null);
  };

  const rows = useMemo(
    () =>
      projects.map((project) => {
        const txs = data.txs.filter((tx) => tx.projectId === project.id);
        const amount = sumFen(txs.filter((tx) => tx.type === 'expense').map((tx) => tx.amount));
        return { project, count: txs.length, amount };
      }),
    [projects, data.txs],
  );

  return (
    <View className='shell shell--plain'>
      <PageHead
        right={
          <View className='icon-btn' hoverClass='icon-btn--hover' onClick={() => open('new')}>
            <Icon name='plus' size={20} />
          </View>
        }
        subtitle={book?.name ?? '未选择账本'}
        title='项目'
      />

      <View className='section prj-section'>
        {rows.length === 0 ? (
          <EmptyState
            description='项目用于跨分类归集，例如「装修」「旅行」「某次报销」'
            icon='project'
            title='还没有项目'
          />
        ) : (
          <View className='tx-list'>
            {rows.map(({ project, count, amount }) => (
              <View className='row' hoverClass='row--hover' key={project.id} onClick={() => open(project.id)}>
                <View className='legend-dot prj-dot' style={{ background: project.color }} />
                <View className='row__main'>
                  <Text className='row__title'>{project.name}</Text>
                  <Text className='row__meta'>{count} 笔记录</Text>
                </View>
                <Text className='row__value num amount-expense'>{formatMoney(amount, { digits: 2 })}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View className='section'>
        <View className='btn btn--primary btn--block' onClick={() => open('new')}>
          <Icon name='plus' size={17} />
          新建项目
        </View>
        <Text className='prj-note'>
          项目与分类是两个维度：分类回答「花在哪」，项目回答「为哪件事花」。
          统计页可按项目查看合计。
        </Text>
      </View>

      {editing ? (
        <Sheet onClose={() => setEditing(null)} title={editing === 'new' ? '新建项目' : '项目设置'}>
          <View className='prj-form'>
            <View className='settings-group__title prj-form__label'>名称</View>
            <Input
              className='input'
              onInput={(event) => setName(event.detail.value)}
              placeholder='例如：装修、旅行'
              placeholderClass='prj-ph'
              value={name}
            />

            <View className='settings-group__title prj-form__label prj-form__label--gap'>颜色</View>
            <View className='prj-colors'>
              {COLORS.map((item) => (
                <View
                  className='prj-color'
                  key={item}
                  onClick={() => setColor(item)}
                  style={{
                    background: item,
                    boxShadow:
                      color === item ? `0 0 0 2px var(--surface), 0 0 0 4px ${item}` : undefined,
                  }}
                />
              ))}
            </View>

            <View className='btn btn--primary btn--block prj-submit' onClick={submit}>
              保存
            </View>

            {editing !== 'new' ? (
              <View className='btn btn--danger btn--block prj-delete' onClick={() => setPendingDelete(editing)}>
                删除项目
              </View>
            ) : null}
          </View>
        </Sheet>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          description='删除后，已归入该项目的流水会变为「未归项目」，记录本身不受影响。'
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteProject(pendingDelete);
            toast('项目已删除');
            setPendingDelete(null);
            setEditing(null);
          }}
          title='删除项目？'
          tone='danger'
        />
      ) : null}
    </View>
  );
}
