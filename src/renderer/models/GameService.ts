import { backend, imageService } from '.';
import { Game, GenericScene, Round, Session } from './types';
import { isOutputImageFile } from './imageFormats';
import { runInAction } from 'mobx';
import {
  cleanGameRanks,
  mergeImageOrder,
  rankingForFiles,
  type RankingSnapshot,
  sortGame,
} from './imageRanking';

// sortGame·cleanGame 본체는 순수 모듈 imageRanking.ts 로 옮겼다(2026-11-01 되돌리기 U3a — 동작 불변, 기존 import 경로 유지).
export { sortGame };

export class GameService extends EventTarget {
  outputList: {
    [type: string]: { [key: string]: { [key2: string]: string[] } };
  };
  constructor() {
    super();
    this.outputList = {
      scene: {},
      inpaint: {},
    };
    imageService.addEventListener('updated', (e) => {
      this.onImageUpdated(e);
    });
  }

  gameUpdated(session: Session, scene: GenericScene) {
    this.refreshList(session, scene);
    this.dispatchEvent(new CustomEvent('updated', {}));
  }

  onImageUpdated(e: any) {
    if (e.detail.batch) {
      for (const type of ['scene', 'inpaint']) {
        const session = e.detail.session;
        for (const scene of session.getScenes(type)) {
          this.refreshList(session, scene as GenericScene);
        }
      }
    } else {
      this.refreshList(e.detail.session, e.detail.scene);
    }
    this.dispatchEvent(new CustomEvent('updated', {}));
  }

  getOutputs(session: Session, scene: GenericScene) {
    if (!(scene.type in this.outputList)) {
      return [];
    }
    if (!(session.name in this.outputList[scene.type])) {
      return [];
    }
    if (!(scene.name in this.outputList[scene.type][session.name])) {
      return [];
    }
    return this.outputList[scene.type][session.name][scene.name];
  }

  refreshList(session: Session, scene: GenericScene) {
    const type = scene.type;
    const list = this.outputList[type];
    if (!(session.name in list)) {
      list[session.name] = {};
    }
    let images = imageService.getOutputs(session, scene);
    const invImageMap: any = {};
    for (let i = 0; i < scene.imageMap.length; i++) {
      invImageMap[scene.imageMap[i]] = i;
    }
    images = images.filter((x: string) => x in invImageMap);
    const sortByGameAndNatural = (
      a: [number, number | undefined],
      b: [number, number | undefined],
    ) => {
      if (a[1] == null && b[1] == null) {
        return a[0] - b[0];
      }
      if (a[1] == null) {
        return 1;
      }
      if (b[1] == null) {
        return -1;
      }
      if (b[1] === a[1]) {
        return a[0] - b[0];
      }
      return b[1] - a[1];
    };
    const cvtMap: any = {};
    if (scene.game) {
      for (const player of scene.game) {
        cvtMap[player.path] = player.rank;
      }
      const files = images.map(
        (x: string) =>
          [invImageMap[x], cvtMap[x]] as [number, number | undefined],
      );
      files.sort(sortByGameAndNatural);
      files.reverse();
      list[session.name][scene.name] = files.map(
        (x: [number, number | undefined]) => scene.imageMap[x[0]],
      );
    } else {
      images.reverse();
      list[session.name][scene.name] = images;
    }
    if (scene.type === 'scene') {
      const nameToPrior: any = {};
      list[session.name][scene.name].forEach((x: string, i: number) => {
        nameToPrior[x] = i;
      });
      scene.mains.sort((a: string, b: string) => {
        return nameToPrior[a] - nameToPrior[b];
      });
    }
  }

  async createGame(path: string) {
    let files = await backend.listFiles(path);
    files = files.filter(isOutputImageFile);
    return files.map((x: string) => ({
      path: x,
      rank: files.length - 1,
    }));
  }

  cleanGame(game: Game) {
    cleanGameRanks(game);
  }

  // ── 되돌리기 병합 복원(2026-11-01 U3a, SPEC_GUIDE 「되돌리기 계약」) ──
  // 되돌리기 모듈(imageStateUndo.ts)은 이미지 필드에 직접 대입하지 않고 이 두 메서드만 부른다. 둘 다 통째 덮어쓰지 않는다 —
  // 생성 중 새로 생긴 이미지는 남기고, 그사이 사라진 이미지는 건너뛴다(최우선 원칙).

  /** 이미지 순서를 order 대로 병합해 세운다(order 에 없는 지금 이미지는 뒤에 유지). 바뀌었으면 true. 화면 갱신은 호출부(refresh) */
  applyImageOrder(scene: GenericScene, order: readonly string[]): boolean {
    const next = mergeImageOrder(scene.imageMap, order);
    const cur = scene.imageMap;
    if (next.length === cur.length && next.every((f, i) => f === cur[i])) return false;
    runInAction(() => {
      scene.imageMap = next;
    });
    return true;
  }

  /**
   * 순위(game·round)를 snap 으로 되살린다 — 지금 이미지 목록에 있는 참가자만 남기고(빠지면 결번 정규화),
   * 대진(round)은 참가자가 모두 있을 때만. 항상 새 객체를 대입한다(round 는 observable.ref·game 은 shallow 라
   * 제자리 수정은 저장 반응이 일어나지 않는다 — E5). 열린 월드컵 화면은 'ranking-restored' 로 다시 맞춘다.
   */
  applyRanking(session: Session, scene: GenericScene, snap: RankingSnapshot): void {
    const r = rankingForFiles(snap, scene.imageMap);
    runInAction(() => {
      scene.game = r.game;
      scene.round = r.round;
    });
    this.gameUpdated(session, scene);
    this.dispatchEvent(new CustomEvent('ranking-restored', { detail: { session, scene } }));
  }

  nextRound(game: Game): [number, Round | undefined] {
    sortGame(game);
    let matchRank = -1;
    for (let i = 0; i < game.length - 1; i++) {
      if (game[i].rank === game[i + 1].rank) {
        matchRank = game[i].rank;
        break;
      }
    }
    if (matchRank === -1) {
      return [game.length, undefined];
    }
    let matchPlayers = game.filter((x) => x.rank === matchRank);
    shuffleArray(matchPlayers);
    for (let i = 0; i < game.length - 1; i++) {
      if (game[i].rank != i) {
        const round: Round = {
          players: matchPlayers.map((x) => x.path),
          winMask: matchPlayers.map(() => false),
          curPlayer: 0,
        };
        return [i, round];
      }
    }
    throw new Error('should not be reached here');
  }
}

export function shuffleArray<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
