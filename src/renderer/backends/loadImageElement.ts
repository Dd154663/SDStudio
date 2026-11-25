/**
 * 그림 주소(data URI 등)를 <img> 로 읽어 load 이벤트까지 기다린다(못 읽으면 reject).
 *
 * HTMLImageElement.decode() 를 쓰지 않는다(2026-11-25 모바일 레퍼런스 「NO IMAGE」).
 * Chromium 은 decode() 를 합성기(compositor)의 다음 프레임 처리에 묶어 두어, 화면에 다시 그릴 것이
 * 없는 동안(Android WebView 가 파일 선택기에서 막 돌아온 직후 등) 약속이 풀리지 않는다 — 썸네일 생성이
 * 그 자리에서 멈춰 있다가 아무 화면 변화가 생기면 그제야 끝난다. load 뒤의 drawImage 는 그 자리에서
 * 동기로 디코드하므로 프레임과 무관하다.
 */
export function loadImageElement(
  src: string,
  create: () => HTMLImageElement = () => new Image(),
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = create();
    // 핸들러를 먼저 달고 src 를 넣는다(캐시된 그림의 빠른 load 를 놓치지 않게).
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = src;
  });
}
