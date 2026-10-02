import { registerPlugin } from '@capacitor/core';

export interface FetchServicePlugin {
  // timeoutMs: OkHttp read·write·call 타임아웃(생략 시 네이티브 기본 120초, connect 는 30초 고정).
  // requestId: cancel 로 진행 중 요청을 끊을 때 쓰는 키(선택).
  // 네이티브 시간 초과는 code 'TIMEOUT', cancel 로 끊긴 요청은 code 'CANCELED' 로 거부된다.
  fetchData(options: {
    url: string;
    body: string;
    headers: string;
    timeoutMs?: number;
    requestId?: string;
  }): Promise<{ data: string; status: number; correlationId?: string }>;
  cancel(options: { requestId: string }): Promise<void>;
}

const FetchService = registerPlugin<FetchServicePlugin>('FetchService');

export default FetchService;
