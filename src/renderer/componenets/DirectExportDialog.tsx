import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { isMobile } from '../models';
import {
  DEFAULT_FOLDER_EXPORT_TARGET,
  DirectExportRequest,
  emptyExportForm,
  exportFormToPreset,
  exportFormProblems,
  exportSpecialChars,
  FOLDER_EXPORT_FIXED_NOTE,
  folderExportSceneTypes,
  FolderExportTarget,
} from '../models/exportSettings';
import ModalOverlay, { DIALOG_PRIMARY_BTN, DIALOG_SECONDARY_BTN } from './ModalOverlay';
import ExportSettingsFields from './ExportSettingsFields';
import { PICKED_EXPORT_TEXT } from '../models/pickedImageExport';

function DirectExportForm({ request }: { request: DirectExportRequest }) {
  const [form, setForm] = useState(emptyExportForm);
  const [characters, setCharacters] = useState<string[]>([]);
  const scope = request.scope ?? 'project';
  // 폴더 일괄의 「대상」(2026-11-17 M5 묶음 b-3) — 프리셋 형식에 넣지 않는 실행 옵션이라 폼 상태와 따로 둔다
  const [folderTarget, setFolderTarget] = useState<FolderExportTarget>(DEFAULT_FOLDER_EXPORT_TARGET);
  // 특수문자 감지 = 실제로 내보낼 씬 이름(폴더 범위는 「대상」에 따라 생성·변형 씬 이름)
  const targetSceneNames = useMemo(() => {
    if (scope !== 'folder') return request.sceneNames;
    const types = folderExportSceneTypes(folderTarget);
    return [
      ...(types.includes('scene') ? request.sceneNames : []),
      ...(types.includes('inpaint') ? request.variantSceneNames ?? [] : []),
    ];
  }, [request, scope, folderTarget]);
  const detected = useMemo(() => exportSpecialChars(targetSceneNames), [targetSceneNames]);
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
  // 범위(2026-11-16 M5 묶음 b P8): 폴더 일괄은 같은 폼 + 한 줄 안내(달라지는 사실만). 숨길 칸은 FOLDER_EXPORT_UNUSED_FIELDS
  // (묶음 b-2 부터 비어 있음 — 폴더도 프로젝트와 같은 단계 함수로 모든 칸을 쓴다).
  // 폴더 범위는 「대상」 선택과 무관하게 두 종류 개수를 모두 보여 규모를 알 수 있게(2026-11-17 b-3)
  const summary = scope === 'folder'
    ? `폴더 "${request.projectName}" · 프로젝트 ${request.projectCount ?? 0}개 · 생성 씬 ${request.sceneNames.length}개 · 변형 씬 ${request.variantSceneNames?.length ?? 0}개`
    : scope === 'images'
      ? PICKED_EXPORT_TEXT.summary(request.projectName, request.imageCount ?? 0)
      : `${request.projectName} · 대상 씬 ${request.sceneNames.length}개`;
  // 빠진·잘못된 칸(2026-11-12 정비 M1): 비활성만 하던 [내보내기]를 내보내기 프리셋 관리와 같이 —
  // 버튼은 막지 않고 누르면 칸 이름 토스트, 바닥줄 왼쪽 한 줄 안내.
  const problems = exportFormProblems(form, false);
  const submit = () => {
    if (problems.length > 0) {
      appState.pushMessage(`다음 칸을 확인해 주세요: ${problems.join(', ')}`, 'error');
      return;
    }
    // 「대상」을 바꿔 감지 목록에서 빠진 문자는 넘기지 않는다
    const chars = form.autoConvertSeparator ? detected : characters.filter((c) => detected.includes(c));
    request.resolve({
      preset: exportFormToPreset(form),
      charsToReplace: chars,
      ...(scope === 'folder' ? { folderTarget } : {}),
    });
  };
  // 바닥줄(2026-11-14 오버레이 묶음 B): footer = [내보내기][취소](내보내기 프리셋 관리와 같은 규격, [확인][취소] 순서
  // 2026-10-03 D1), footerStart = 빠진 칸 안내. s·m 창이라 PC·모바일 공통 바닥줄(규약 ⑧).
  const footer = <>
    <button type="button"
      className={DIALOG_PRIMARY_BTN + (problems.length > 0 ? ' opacity-50' : '')}
      aria-disabled={problems.length > 0 || undefined} onClick={submit}>내보내기</button>
    <button type="button" className={DIALOG_SECONDARY_BTN} onClick={close}>취소</button>
  </>;
  const footerStart = problems.length > 0
    ? <span className="text-xs text-red-500 dark:text-red-400" data-direct-export-problems="">
      필수 칸을 채워 주세요: {problems.join(', ')}
    </span>
    : null;
  return <ModalOverlay isOpen onClose={close} title="직접 내보내기 설정" size="m" footer={footer} footerStart={footerStart}>
    <div className="space-y-4">
      <div className="text-sm text-muted">{summary}</div>
      {/* PC 는 2열 격자(칸마다 최소 300px — m 창 폭이면 2열), 모바일은 종전 세로 쌓기 */}
      <ExportSettingsFields form={form} setForm={setForm} direct twoColumn={!isMobile} scope={scope}
        {...(scope === 'folder' ? { folderTarget, setFolderTarget } : {})} />
      {scope === 'folder' && <div className="text-xs text-muted" data-direct-export-folder-note="">{FOLDER_EXPORT_FIXED_NOTE}</div>}
      {!form.autoConvertSeparator && detected.length > 0 && <fieldset className="border line-color rounded p-3">
        <legend className="text-sm text-muted">구분자로 변환할 문자</legend>
        <div className="flex flex-wrap gap-3">{detected.map((char) => <label key={char} className="flex items-center gap-1 text-default">
          <input type="checkbox" className="setting-check" checked={characters.includes(char)} onChange={(e) => setCharacters((current) => e.target.checked ? [...current, char] : current.filter((value) => value !== char))} />
          {char === ' ' ? '띄어쓰기' : char}
        </label>)}</div>
      </fieldset>}
      <div className="text-xs text-muted">{scope === 'images'
        ? PICKED_EXPORT_TEXT.note
        : '즐겨찾기가 없는 씬은 첫 이미지를 사용합니다. 원본 이미지는 변경하지 않습니다.'}</div>
    </div>
  </ModalOverlay>;
}

export default observer(function DirectExportDialog() {
  const request = appState.directExportRequest;
  return request ? <DirectExportForm request={request} /> : null;
});
