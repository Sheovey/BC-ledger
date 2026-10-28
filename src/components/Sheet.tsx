import type { ReactNode } from 'react';
import { View } from '@tarojs/components';
import { Icon } from './Icon';

/**
 * 底部弹层（小程序版）。
 *
 * 与 Web 版（ledger-app/src/components/Sheet.tsx）的差异：
 * - 去掉了 document/body 的滚动锁与 Esc 键监听：小程序没有 body，也没有键盘退出；
 *   弹层是 position: fixed 全屏，遮住即等于锁住，页面本身也不会被滚到。
 * - 用 catchMove 语义替代 event.stopPropagation() 的样式兜底：两者都写，
 *   点击卡片内部既不会关闭弹层，也不会穿透到下层的行点击。
 */

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Sheet({ title, onClose, children, footer }: SheetProps) {
  return (
    <View className='overlay' onClick={onClose}>
      <View
        className='sheet'
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <View className='sheet__head'>
          <View className='sheet__title'>{title}</View>
          <View className='icon-btn icon-btn--plain' hoverClass='icon-btn--hover' onClick={onClose}>
            <Icon name='close' size={18} />
          </View>
        </View>
        <View className='sheet__body'>{children}</View>
        {footer}
      </View>
    </View>
  );
}

interface ConfirmProps {
  title: string;
  description?: string;
  confirmText?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmText = '确定',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Sheet onClose={onCancel} title={title}>
      {description ? (
        <View className='dialog__desc'>{description}</View>
      ) : null}
      <View className='dialog__actions'>
        <View className='btn btn--ghost' onClick={onCancel} style={{ flex: 1 }}>
          取消
        </View>
        <View
          className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
          onClick={onConfirm}
          style={{ flex: 1 }}
        >
          {confirmText}
        </View>
      </View>
    </Sheet>
  );
}
