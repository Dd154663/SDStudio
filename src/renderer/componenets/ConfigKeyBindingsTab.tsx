// 설정 화면 탭: 단축키(key 'keybindings', 라벨 「단축키」, PC 전용) — KeyBindingsTab
import { useEffect, useState } from 'react';
import { keyboardShortcutService, KeyboardShortcutService } from '../models/KeyboardShortcutService';
import { useBackLayer } from '../models/BackStackService';
import Tooltip from './Tooltip';
import { ActionIcon } from './ActionIcon';

/* ── 탭: 단축키 (PC only, 2026-10-01 라벨 「키 바인딩」→「단축키」) ── */
const KeyBindingsTab = () => {
  const [bindings, setBindings] = useState(keyboardShortcutService?.getAllActions() ?? []);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const refreshBindings = () => {
    setBindings(keyboardShortcutService?.getAllActions() ?? []);
  };

  // 녹음 중 Esc = 녹음 취소(설정 창 닫기 아님). 닫기 관문이 맨 위 항목으로 받는다(2026-10-03 U1·X2 —
  // 예전엔 설정 창의 Esc 리스너가 먼저 등록돼 녹음 취소 대신 설정 창이 닫혔다).
  useBackLayer(!!recordingAction, () => {
    setRecordingAction(null);
    setConflict(null);
  });

  useEffect(() => {
    if (!recordingAction) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const normalized = KeyboardShortcutService.normalizeKey(e);
      if (!normalized) return; // 수정자만 누른 경우

      // Escape로 취소
      if (e.key === 'Escape') {
        setRecordingAction(null);
        setConflict(null);
        return;
      }

      // 충돌 확인
      const conflictLabel = keyboardShortcutService.findConflict(normalized, recordingAction);
      if (conflictLabel) {
        setConflict(`"${conflictLabel}" 단축키와 충돌합니다`);
        return;
      }

      keyboardShortcutService.setBinding(recordingAction, normalized);
      setRecordingAction(null);
      setConflict(null);
      refreshBindings();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingAction]);

  // 동작 위치(= 충돌 scope)별로 그룹핑
  const groups: {
    title: string;
    hint: string;
    items: typeof bindings;
  }[] = [
    {
      title: '전역 (메인 화면)',
      hint: '씬 리스트가 보이는 메인 화면에서 동작',
      items: bindings.filter(
        (b) => b.category === 'global' || b.category === 'scene',
      ),
    },
    {
      title: '이미지 그리드',
      hint: '씬에 진입해 이미지 목록을 볼 때 동작',
      items: bindings.filter((b) => b.category === 'image-grid'),
    },
    {
      title: '이미지 상세 창',
      hint: '이미지를 클릭해 상세 창이 열린 상태에서 동작',
      items: bindings.filter((b) => b.category === 'viewer'),
    },
  ];

  const renderBindingRow = (action: (typeof bindings)[number]) => (
    <div
      key={action.id}
      className="flex items-center gap-2 py-1.5 border-b line-color"
    >
      <span className="flex-1 text-sm text-body min-w-0 truncate">
        {action.label}
      </span>
      <span
        className="text-sm font-mono bg-[var(--c-input-bg)] text-body px-2 py-0.5 rounded text-center flex-shrink-0"
        style={{ minWidth: '70px' }}
      >
        {recordingAction === action.id
          ? '입력 대기...'
          : KeyboardShortcutService.keyDisplayName(action.currentKey)}
      </span>
      <button
        className={`text-xs px-2 py-1 rounded transition-colors flex-shrink-0 ${
          recordingAction === action.id ? 'back-red text-white' : 'back-sky'
        }`}
        onClick={() => {
          setConflict(null);
          setRecordingAction(recordingAction === action.id ? null : action.id);
        }}
      >
        {recordingAction === action.id ? '취소' : '변경'}
      </button>
      <Tooltip content="기본값으로 초기화">
        {/* 기호 글자 ↺ → 사전 reset-default 아이콘 버튼(2026-11-20 UI 정돈 그룹 1-c). 이름표는 Tooltip 이 붙인다. */}
        <button
          type="button"
          className="setting-icon-btn ui-press"
          onClick={() => {
            keyboardShortcutService.resetBinding(action.id);
            setConflict(null);
            refreshBindings();
          }}
        >
          <ActionIcon id="reset-default" size={16} />
        </button>
      </Tooltip>
    </div>
  );

  return (
    // 높이 상한·안쪽 스크롤 없음(2026-11-15 C-1, SPEC 「높이 규칙 우선순위」) — 환경설정 본문 스크롤 하나가 맡는다.
    // 그룹 머리 sticky 는 본문 스크롤 기준으로 붙는다. 본문 슬롯은 여백 없음(ConfigScreen bodyPadding='none' +
    // 안쪽 p-5 감싸기)이라 top-0 = 스크롤 영역 맨 위(2026-11-21 — 종전엔 본문 p-5 만큼 내려와 위 틈으로 목록이 비쳤다).
    <div className="flex flex-col">
      <div className="text-sm text-muted mb-2 flex-none">
        "변경" 클릭 후 키 조합 입력. Esc로 취소. 그룹 내부에서만 키 충돌
        검사됩니다 (다른 그룹은 동작 상황이 달라 같은 키를 써도 OK).
      </div>
      {conflict && (
        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded mb-2 flex-none">
          {conflict}
        </div>
      )}
      <div className="space-y-1">
        {groups.map((group, idx) =>
          group.items.length === 0 ? null : (
            <div key={group.title} className={idx > 0 ? 'mt-4' : ''}>
              <div className="sticky top-0 bg-[var(--c-surface-2)] py-1.5 px-1 border-b-2 border-sky-400 dark:border-sky-500 z-10">
                <div className="text-sm font-semibold text-default">
                  {group.title}
                </div>
                <div className="text-xs text-muted">
                  {group.hint}
                </div>
              </div>
              <div>{group.items.map(renderBindingRow)}</div>
            </div>
          ),
        )}
      </div>
      <div className="pt-2 flex-none">
        <button
          className="text-sm px-3 py-1.5 rounded back-gray"
          onClick={() => {
            keyboardShortcutService.resetToDefaults();
            setConflict(null);
            refreshBindings();
          }}
        >
          전체 초기화
        </button>
      </div>
    </div>
  );
};

export default KeyBindingsTab;
