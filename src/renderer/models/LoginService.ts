import { backend } from '.';

export class LoginService extends EventTarget {
  loggedIn: boolean;

  constructor() {
    super();
    this.loggedIn = false;
    // 프로그램 시작 시 1회 실제 토큰 검증 (로그인 끊김은 드물어 상시 폴링은 하지 않는다).
    // 세션 도중 만료는 TobBar의 크레딧 조회 실패 시 재검증으로 잡힌다.
    this.refresh();
  }

  async login(email: string, password: string) {
    await backend.login(email, password);
    await this.refresh(true);
  }

  async loginWithToken(token: string) {
    await backend.loginWithToken(token);
    await this.refresh(true);
  }

  // 저장된 토큰을 NovelAI API로 실제 검증한다(단순 파일 존재 확인이 아님).
  // valid → 로그인 ON, invalid(인증 거부) → OFF, error(네트워크 등 불확실) → 현재 상태 유지.
  // 상태가 실제로 바뀔 때만 'change'를 발생시켜(또는 force 시) 재검증 루프를 방지한다.
  async refresh(force = false) {
    let next = this.loggedIn;
    try {
      const status = await backend.validateLogin();
      if (status === 'valid') next = true;
      else if (status === 'invalid') next = false;
      // 'error' → 일시 오류로 보고 현재 상태 유지(오탐 방지)
    } catch (e) {
      // 예기치 못한 오류 → 상태 유지
    }
    const changed = next !== this.loggedIn;
    this.loggedIn = next;
    if (changed || force) {
      this.dispatchEvent(new CustomEvent('change', {}));
    }
  }
}
