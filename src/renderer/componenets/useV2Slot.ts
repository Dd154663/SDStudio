import { useEffect, useState } from 'react';

// 모바일 V2 포털 슬롯 조회(models/mobileV2.ts 의 슬롯 id). 슬롯은 TabComponent·시트·하단 바가 항상 마운트해 두지만,
// 채우는 쪽(씬 목록 등)이 먼저 렌더될 수 있어 마운트 뒤에 찾고, 아직 없으면 다음 프레임에 다시 찾는다.
export function useV2Slot(id: string, enabled: boolean): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) {
      setEl(null);
      return undefined;
    }
    let raf = 0;
    let tries = 0;
    const find = () => {
      const found = document.getElementById(id);
      if (found) setEl(found);
      else if (tries++ < 120) raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [id, enabled]);
  return el;
}
