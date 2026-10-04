// 아이콘 의미 사전(models/iconDictionary.ts)의 렌더 도우미 — <ActionIcon id="queue-add" size={18} />.
// 모양은 사전이 정하고 크기·색·여백(size·className)은 사용처가 정한다(SPEC_GUIDE §6 「아이콘 의미 사전」).
import type { IconBaseProps } from 'react-icons';
import { ICON_DICTIONARY, IconId, iconOf } from '../models/iconDictionary';

export const ActionIcon = ({ id, ...props }: { id: IconId } & IconBaseProps) => {
  const Icon = ICON_DICTIONARY[id];
  return <Icon {...props} />;
};

// 런타임 문자열 id 용(퀵 메뉴 항목 등) — 사전에 없으면 fallback 을 그린다.
export const ActionIconById = ({
  id,
  fallback,
  ...props
}: { id: string; fallback?: IconId } & IconBaseProps) => {
  const Icon = iconOf(id) ?? (fallback ? ICON_DICTIONARY[fallback] : undefined);
  return Icon ? <Icon {...props} /> : null;
};
