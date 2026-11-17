// 글로벌 저장소 파일(storeFile.ts)의 실제 의존 — models/index 의 backend 와 persistService(반복 저장 직렬화 큐).
// storeFile.ts 는 순수 모듈로 두고(테스트 주입), 서비스는 이 객체를 넘긴다.
import { backend } from '.';
import { persistService } from './PersistenceService';
import type { StoreFileDeps } from './storeFile';

export const globalStoreDeps: StoreFileDeps = {
  backend: () => backend,
  write: (path, data) => persistService.write(path, data),
};
