// 토스트 종류 추론 — 2026-10-03 U1·X7. 실제 저장소 pushMessage 문구 표본으로 고정한다.
import { inferToastKind, resolveToastKind } from '../toastKind';

describe('inferToastKind', () => {
  test.each([
    // 오류(실패·없음·불가·전제 조건 미충족)
    ['내보내기 실패: disk full', 'error'],
    ['압축 해제에 실패했습니다.', 'error'],
    ['JSON 파일을 읽는 중 오류가 발생했습니다', 'error'],
    ['프롬프트 에러: unexpected token', 'error'],
    ['내보낼 이미지가 없습니다', 'error'],
    ['북마크된 씬을 찾을 수 없습니다.', 'error'],
    ['생성 설정을 읽지 못해 예약하지 못했습니다.', 'error'],
    ['이 플랫폼에서는 WebP 변환을 지원하지 않습니다.', 'error'],
    ['같은 이름의 프로젝트가 이미 존재합니다.', 'error'],
    ['이미 내보내기 작업이 진행중입니다.', 'error'],
    ['프로젝트를 먼저 선택해주세요', 'error'],
    ['프로젝트를 먼저 여세요.', 'error'],
    ['예약 개수가 올바르지 않습니다.', 'error'],
    ['전체 백업 파일이 아닙니다.', 'error'],
    ['시드는 0~4294967295 사이의 정수여야 합니다.', 'error'],
    ['씬이 2개 이상 필요합니다.', 'error'],
    ['txt 파일만 지원됩니다', 'error'],
    ['동일한 이름의 작가가 있어 이름을 변경하지 않았습니다.', 'error'],
    // 오류 우선: 완료 + 못함 = 오류
    ['내보내기는 완료됐지만 임시 압축파일을 정리하지 못했습니다.', 'error'],
    ['3개 이미지 복사 실패 (건너뜀)', 'error'],
    ['ENOENT: no such file or directory', 'error'],
    ['Network request failed', 'error'],
    // 성공
    ['저장되었습니다.', 'success'],
    ['토큰으로 로그인 성공!', 'success'],
    ['씬 정렬 완료', 'success'],
    ['3개 글로벌 프리셋을 삭제했습니다', 'success'],
    ['2장의 이미지가 복사되었습니다.', 'success'],
    ['5개 태그 복사됨', 'success'],
    ['캐릭터 프리셋을 불러왔습니다', 'success'],
    ['프롬프트·샘플링 설정을 덮어썼습니다.', 'success'],
    ['로컬 휴지통을 비웠습니다.', 'success'],
    ['글로벌 프리셋에 추가: 기본', 'success'],
    // 안내(중립)
    ['순차 생성이 취소되었습니다', 'info'],
    ['이미지 캐시 초기화 시작', 'info'],
    ['씬1 예약 4장', 'info'],
    ['다음 프리셋 "A" 준비 중 (5초 대기)...', 'info'],
    ['', 'info'],
  ] as const)('%s → %s', (msg, kind) => {
    expect(inferToastKind(msg)).toBe(kind);
  });

  test('「이미지」는 「이미 …」로 오판하지 않는다', () => {
    expect(inferToastKind('이미지가 저장되었습니다: a.png')).toBe('success');
  });

  test('명시한 kind 가 추론보다 우선', () => {
    expect(resolveToastKind('저장되었습니다.', 'error')).toBe('error');
    expect(resolveToastKind('파일이 없습니다', 'info')).toBe('info');
    expect(resolveToastKind('저장되었습니다.')).toBe('success');
  });
});
