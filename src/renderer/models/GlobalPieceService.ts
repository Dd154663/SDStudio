import { observable, action } from 'mobx';
import { PieceLibrary, IPieceLibrary } from './types';
import { StoreFile } from './storeFile';
import { globalStoreDeps } from './globalStoreDeps';

const GLOBAL_PIECES_FILE = 'global_pieces.json';

export class GlobalPieceService {
  @observable accessor library: Map<string, PieceLibrary> = new Map();

  // 로드 판정·저장·사본 회전(storeFile.ts 단일 출처, 2026-11-17 묶음 1). 형식(이름 → 조각 그룹 객체)은 종전 그대로.
  // 조각은 편집 화면이 그룹 객체를 직접 고치고 scheduleSave 만 부르므로, 읽기 실패 상태의 거부는 저장 단계(안내 토스트)에서 한다.
  private store = new StoreFile<Map<string, PieceLibrary>>(
    {
      file: GLOBAL_PIECES_FILE,
      label: '전역 조각',
      parse: (raw) => {
        const json = JSON.parse(raw);
        if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
        return new Map(
          Object.entries(json as Record<string, IPieceLibrary>).map(([key, value]) => [
            key,
            PieceLibrary.fromJSON(value),
          ]),
        );
      },
      countItems: (m) => m.size,
      serialize: () => {
        const json: Record<string, any> = {};
        for (const [key, value] of this.library.entries()) {
          json[key] = value.toJSON();
        }
        return JSON.stringify(json);
      },
      saveDelayMs: 2000,
    },
    globalStoreDeps,
  );

  /** 파일을 읽지 못해 저장이 막힌 상태 */
  get loadFailed(): boolean {
    return this.store.loadFailed;
  }

  async load() {
    const res = await this.store.load();
    if (res.keepMemory) return; // 재로드 실패 — 이미 가진 목록 유지
    this.library =
      res.kind === 'ok' || res.kind === 'recovered' ? res.data : new Map();
  }

  // 저장: tmp → rename(실패 시 직접 쓰기 — 종전은 직접 쓰기만), 세션 첫 저장 전 .bak1~3 회전, 읽기 실패 상태면 쓰지 않음
  async save() {
    await this.store.saveNow();
  }

  scheduleSave() {
    this.store.schedule();
  }

  // 종료 직전 — 바뀐 것이 있을 때만 쓴다
  async flushSave() {
    await this.store.flush();
  }

  @action
  addLibrary(name: string, lib: PieceLibrary) {
    if (!this.store.canWrite()) return;
    this.library.set(name, lib);
    this.scheduleSave();
  }

  @action
  deleteLibrary(name: string) {
    if (!this.store.canWrite()) return;
    this.library.delete(name);
    this.scheduleSave();
  }
}
