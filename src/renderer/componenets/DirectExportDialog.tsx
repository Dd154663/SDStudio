import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { DirectExportRequest, emptyExportForm, exportFormToPreset, exportFormProblems, exportSpecialChars } from '../models/exportSettings';
import ModalOverlay from './ModalOverlay';
import ExportSettingsFields from './ExportSettingsFields';

function DirectExportForm({ request }: { request: DirectExportRequest }) {
  const [form, setForm] = useState(emptyExportForm);
  const [characters, setCharacters] = useState<string[]>([]);
  const detected = useMemo(() => exportSpecialChars(request.sceneNames), [request]);
  // 앱 종료/부모 언마운트 시에도 대기 중인 실행을 취소한다.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current) request.resolve(); });
    };
  }, [request]);
  const close = () => request.resolve();
  // 빠진·잘못된 칸(2026-11-12 정비 M1): 비활성만 하던 [내보내기]를 내보내기 프리셋 관리와 같이 —
  // 버튼은 막지 않고 누르면 칸 이름 토스트, 버튼 위 한 줄 안내.
  const problems = exportFormProblems(form, false);
  const submit = () => {
    if (problems.length > 0) {
      appState.pushMessage(`다음 칸을 확인해 주세요: ${problems.join(', ')}`, 'error');
      return;
    }
    request.resolve({ preset: exportFormToPreset(form), charsToReplace: form.autoConvertSeparator ? detected : characters });
  };
  return <ModalOverlay isOpen onClose={close} title="직접 내보내기 설정" width="max-w-lg">
    <div className="space-y-4">
      <div className="text-sm text-muted">{request.projectName} · 대상 씬 {request.sceneNames.length}개</div>
      <ExportSettingsFields form={form} setForm={setForm} direct />
      {!form.autoConvertSeparator && detected.length > 0 && <fieldset className="border line-color rounded p-3">
        <legend className="text-sm text-muted">구분자로 변환할 문자</legend>
        <div className="flex flex-wrap gap-3">{detected.map((char) => <label key={char} className="flex items-center gap-1 text-default">
          <input type="checkbox" checked={characters.includes(char)} onChange={(e) => setCharacters((current) => e.target.checked ? [...current, char] : current.filter((value) => value !== char))} />
          {char === ' ' ? '띄어쓰기' : char}
        </label>)}</div>
      </fieldset>}
      <div className="text-xs text-muted">즐겨찾기가 없는 씬은 첫 이미지를 사용합니다. 원본 이미지는 변경하지 않습니다.</div>
      {problems.length > 0 && <div className="text-xs text-red-500 dark:text-red-400 text-right" data-direct-export-problems="">
        필수 칸을 채워 주세요: {problems.join(', ')}
      </div>}
      <div className="flex justify-end gap-2">
        {/* [확인][취소] 순서(2026-10-03 D1) */}
        <button type="button" className={'round-button back-sky' + (problems.length > 0 ? ' opacity-50' : '')}
          aria-disabled={problems.length > 0 || undefined} onClick={submit}>내보내기</button>
        <button type="button" className="round-button back-gray" onClick={close}>취소</button>
      </div>
    </div>
  </ModalOverlay>;
}

export default observer(function DirectExportDialog() {
  const request = appState.directExportRequest;
  return request ? <DirectExportForm request={request} /> : null;
});
