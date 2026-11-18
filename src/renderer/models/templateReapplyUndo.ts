// 템플릿 재적용(현재 프로젝트) 되돌리기(2026-11-18 프리셋 유실 조사 경로 10·11, SPEC_GUIDE 「되돌리기 계약」, jest
// undoTemplateReapply.test.ts). 프로젝트 스택에 한 동작 = 한 항목.
//
// · 재적용(SessionService.applyProjectTemplateToSession)이 바꾸는 범위 전부를 한 항목으로 담는다:
//   ① 그림체 프리셋 목록 + 선택(presetUndo 의 목록 차분 — 지운 객체는 **같은 객체**를 원래 자리로, 사용자가 고친 내용 그대로)
//   ② 캐릭터 프리셋 목록 + 공용 설정의 캐릭터 항목(바이브·캐릭터 레퍼런스 포함, presetUndo 의 통째 상태 짝 — 내용 사본)
//   ③ 사이드카(templates.json)의 (프로젝트, 템플릿) 적용 기록 — 다음 재적용이 올바른 대상을 교체하도록 재적용 전 값으로
//   씬·변형 씬·생성 이미지·시드는 재적용이 건드리지 않으므로 담지 않는다(imageMap·mains 등 통째 복원 금지 대상 없음).
// · 한 항목 안에서 일부만 되돌리지 않는다: 실행 직전 적용 기록이 기록 시 결과와 다르면(다른 창 등) 항목 전체를 버리고, 적용 기록을
//   먼저 되돌려 실패(막힘·쓰기 오류)하면 프로젝트 쪽은 건드리지 않고 버린다. 캐릭터 상태가 기록 밖에서 또 바뀌었으면 D16 확인.
// · 재적용이 새로 복사한 이미지 파일(세션 vibes·references)은 지우지 않는다 — 다시 실행이 같은 파일을 다시 가리키기 때문.
//   (재적용 자체도 교체한 옛 인스턴스의 파일을 지우지 않는다 — ProjectTemplateService.removeRecordedInstances 「안전 우선」.)
// · 이 모듈은 잠금을 쓰지 않고 파일을 직접 쓰지 않는다 — 적용 기록은 TemplateService 공개 메서드(ops), 나머지는 MobX 대입
//   (저장은 기존 RS.watch). 기록은 흐름 계층(templateReapplyFlow)에서 재적용이 끝난 뒤에만.
import type { Session } from './types';
import { undoDeepClone, undoDeepEqual, undoService, UNDO_TEXT, UndoOutcome, UndoService } from './undoService';
import {
  applyPresetListDiff,
  CharacterStateSnap,
  PresetListRecorder,
  PresetListSnap,
  restoreCharacterState,
  samePresetLists,
  snapCharacterState,
  snapPresetLists,
} from './presetUndo';
import { flushSceneFieldEdit } from './sceneFieldUndo';

/** 사이드카 적용 기록 하나(프로젝트·템플릿이 정해진) — TemplateService.getApplication·restoreApplication */
export interface TemplateApplicationUndoOps<R> {
  get(): R | undefined;
  /** record 로 되돌린다(undefined = 기록 지움). 막혔으면 false */
  restore(record: R | undefined): Promise<boolean>;
}

interface ReapplySnap<R> {
  lists: PresetListSnap;
  chars: CharacterStateSnap;
  app: R | undefined;
}

/**
 * 재적용 직전에 부른다 — 시작 상태를 보관하고, commit(재적용이 끝난 뒤 — 실패해도 바뀐 것이 있으면) 때 바뀌었으면 1항목.
 * 기록할 수 없는 프로젝트(미러·실행 중)면 아무것도 하지 않는다.
 */
export function beginTemplateReapplyRecord<R>(
  session: Session | undefined,
  label: string,
  app: TemplateApplicationUndoOps<R>,
  opts: { service?: UndoService } = {},
): PresetListRecorder {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return { commit: () => false, cancel: () => {} };
  flushSceneFieldEdit();
  const snap = (): ReapplySnap<R> => ({
    lists: snapPresetLists(session),
    chars: snapCharacterState(session),
    app: undoDeepClone(app.get()),
  });
  const before = snap();
  let done = false;
  return {
    commit: (override) => {
      if (done) return false;
      done = true;
      if (!service.canRecord(session)) return false;
      const after = snap();
      if (
        samePresetLists(before.lists, after.lists) &&
        undoDeepEqual(before.chars, after.chars) &&
        undoDeepEqual(before.app, after.app)
      ) {
        return false;
      }
      const apply = async (from: ReapplySnap<R>, to: ReapplySnap<R>): Promise<UndoOutcome | void> => {
        // 적용 기록 먼저 — 막히면 프로젝트 쪽을 건드리지 않고 항목을 버린다(일부만 되돌리지 않음)
        if (!undoDeepEqual(from.app, to.app)) {
          const ok = await app.restore(undoDeepClone(to.app));
          if (!ok) throw new Error(UNDO_TEXT.templateApplicationBlocked);
        }
        const r = applyPresetListDiff(session, from.lists, to.lists);
        restoreCharacterState(session, to.chars);
        return r;
      };
      return !!service.record(session, {
        label: override ?? label,
        verify: (dir) =>
          undoDeepEqual(app.get(), dir === 'undo' ? after.app : before.app)
            ? true
            : UNDO_TEXT.templateApplicationChanged,
        // 캐릭터 상태는 통째 복원 — 기록 밖에서 또 바뀌었으면 묻는다(D16). 그림체 목록은 병합 복원이라 묻지 않는다
        conflict: (dir) => !undoDeepEqual(snapCharacterState(session), dir === 'undo' ? after.chars : before.chars),
        undo: () => apply(after, before),
        redo: () => apply(before, after),
      });
    },
    cancel: () => {
      done = true;
    },
  };
}
