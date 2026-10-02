import { contextMenu } from 'react-contexify';
import {
  backStackService,
  BackStackHandle,
} from '../models/BackStackService';

// 우클릭·길게 누르기 메뉴(react-contexify)를 닫기 관문에 올린다(2026-10-03 U1·X6).
// 메뉴가 떠 있는 동안 Android 뒤로 가기·PC Esc 는 메뉴만 닫는다 — 예전엔 뒤로 가기가 아래 창을 닫거나 앱을
// 최소화했고, Esc 는 관문이 아래 창으로 보냈다. <Menu onVisibilityChange={contextMenuBackLayer(id)}> 로 쓴다.
const handles = new Map<string, BackStackHandle>();
const callbacks = new Map<string, (visible: boolean) => void>();

export function contextMenuBackLayer(id: string | number): (visible: boolean) => void {
  const key = String(id);
  let cb = callbacks.get(key);
  if (!cb) {
    cb = (visible: boolean) => {
      const prev = handles.get(key);
      if (visible) {
        if (prev) return;
        handles.set(key, backStackService.push(() => contextMenu.hideAll()));
      } else if (prev) {
        prev.remove();
        handles.delete(key);
      }
    };
    callbacks.set(key, cb);
  }
  return cb;
}
