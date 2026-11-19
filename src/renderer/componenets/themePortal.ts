// 포털을 붙일 자리 = 앱 테마 루트(App.tsx 의 [data-app-theme-root]).
// 테마 클래스(.dark·.true-dark)와 커스텀 테마 변수가 그 요소에 걸려 있어서, document.body 에 붙인 포털은
// 다크 테마에서도 라이트 색 토큰(--c-*)으로 그려진다(2026-11-19 실기: 문법 패널·서랍 우클릭 목록이 흰 바탕).
// from 을 주면 그 요소가 속한 루트, 없으면 문서의 루트, 그것도 없으면(테스트 등) body.
export function themePortalRoot(from?: Element | null): HTMLElement {
  return (
    from?.closest<HTMLElement>('[data-app-theme-root]') ??
    document.querySelector<HTMLElement>('[data-app-theme-root]') ??
    document.body
  );
}
