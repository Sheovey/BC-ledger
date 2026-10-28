import { View, Text } from '@tarojs/components';
import type { KeypadKey } from '@/hooks/useAmountInput';
import { Icon } from './Icon';

interface KeypadProps {
  onPress: (key: KeypadKey) => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  /** 左侧类型切换：支出/收入/转账/余额 */
  type: 'expense' | 'income' | 'transfer' | 'balance';
  onTypeChange?: (type: 'expense' | 'income' | 'transfer' | 'balance') => void;
}

const TYPE_ORDER: Array<KeypadProps['type']> = ['expense', 'income', 'transfer', 'balance'];
const TYPE_LABEL: Record<KeypadProps['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  balance: '余额',
};

/** 键盘布局严格对应 4×4 网格，第 12 格为跨两行的「确定」 */
const KEYS: KeypadKey[] = [
  { kind: 'digit', value: '7' },
  { kind: 'digit', value: '8' },
  { kind: 'digit', value: '9' },
  { kind: 'op', value: '-' },
  { kind: 'digit', value: '4' },
  { kind: 'digit', value: '5' },
  { kind: 'digit', value: '6' },
  { kind: 'op', value: '+' },
  { kind: 'digit', value: '1' },
  { kind: 'digit', value: '2' },
  { kind: 'digit', value: '3' },
  { kind: 'dot' },
  { kind: 'digit', value: '0' },
  { kind: 'back' },
];

export function Keypad({ onPress, onConfirm, confirmDisabled, type, onTypeChange }: KeypadProps) {
  return (
    <View className='keypad'>
      <View className='keypad__types'>
        {TYPE_ORDER.map((item) => (
          <View
            className={`keypad__type ${type === item ? 'keypad__type--active' : ''}`}
            key={item}
            onClick={() => onTypeChange?.(item)}
          >
            {TYPE_LABEL[item]}
          </View>
        ))}
      </View>
      <View className='keypad__grid'>
        {KEYS.slice(0, 11).map((key, index) => (
          <KeyButton key={index} keyDef={key} onPress={onPress} />
        ))}
        <View
          className={`key key--confirm ${confirmDisabled ? 'key--confirm-disabled' : ''}`}
          hoverClass={confirmDisabled ? 'none' : 'key--hover'}
          onClick={confirmDisabled ? undefined : onConfirm}
        >
          <Text className='key__label'>确定</Text>
        </View>
        {KEYS.slice(11).map((key, index) => (
          <KeyButton key={`t${index}`} keyDef={key} onPress={onPress} />
        ))}
      </View>
    </View>
  );
}

function KeyButton({ keyDef, onPress }: { keyDef: KeypadKey; onPress: (key: KeypadKey) => void }) {
  if (keyDef.kind === 'digit' || keyDef.kind === 'dot') {
    return (
      <View className='key' hoverClass='key--hover' onClick={() => onPress(keyDef)}>
        {keyDef.kind === 'digit' ? keyDef.value : '.'}
      </View>
    );
  }
  if (keyDef.kind === 'back') {
    return (
      <View className='key key--fn' hoverClass='key--hover' onClick={() => onPress(keyDef)}>
        <Icon name='close' size={17} />
      </View>
    );
  }
  if (keyDef.kind === 'op') {
    return (
      <View className='key key--fn' hoverClass='key--hover' onClick={() => onPress(keyDef)}>
        {keyDef.value}
      </View>
    );
  }
  return null;
}
