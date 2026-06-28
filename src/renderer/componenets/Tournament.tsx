import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useContextMenu } from 'react-contexify';
import { FaQuestion } from 'react-icons/fa';
import { observer } from 'mobx-react-lite';
import { gameService, sessionService, backend, imageService } from '../models';
import { shuffleArray } from '../models/GameService';
import { isOutputImageFile } from '../models/imageFormats';
import { Scene, InpaintScene, ContextMenuType, Player } from '../models/types';
import { appState } from '../models/AppService';
import ShortcutCheatsheet from './ShortcutCheatsheet';

interface TournamentProps {
  scene: Scene | InpaintScene;
  path: string;
}

const Tournament = observer(({ scene, path }: TournamentProps) => {
  const { curSession } = appState;
  const [images, setImages] = useState<string[]>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const lock = useRef(false);
  const [finalRank, setFinalRank] = useState(-1);
  const showCheatsheet = appState.showTournamentCheatsheet;

  const nextMatchRef = useRef<() => void>(() => {});
  const resetRanksRef = useRef<() => void>(() => {});
  const playersRef = useRef<string[]>([]);
  const lockRef = useRef(lock);
  const { show } = useContextMenu({
    id: ContextMenuType.Image,
  });

  const isInputFocused = useCallback(() => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }, []);

  const loadRoundInitial = () => {
    const [finalizedRank, newRound] = gameService.nextRound(scene.game!);
    if (!scene.round) {
      scene.round = newRound;
      sessionUpdated();
    }
    if (newRound) {
      const round = scene.round!;
      setPlayers([
        round.players[round.curPlayer],
        round.players[round.curPlayer + 1],
      ]);
    }
    setFinalRank(finalizedRank);
  };
  const finalizeMatch = () => {
    let wins = 0;
    let loses = 0;
    const round = scene.round!;
    if (round.players.length % 2 === 1) {
      round.winMask[round.players.length - 1] = true;
    }
    for (let i = 0; i < round.players.length; i++) {
      if (round.winMask[i]) {
        wins++;
      } else {
        loses++;
      }
    }
    const cvt = new Map<string, Player>();
    for (const player of scene.game!) {
      cvt.set(player.path, player);
    }
    const roundRank = cvt.get(round.players[0])!.rank;
    const winRank = roundRank - loses;
    for (let i = 0; i < round.players.length; i++) {
      if (round.winMask[i]) {
        cvt.get(round.players[i])!.rank = winRank;
      }
    }
    if (winRank === 0) {
      appState.pushDialog({
        type: 'yes-only',
        text: '1위가 결정되었습니다. 여기서 멈춰도 됩니다.',
      });
    }
    gameUpdated();
  };
  const nextMatch = () => {
    if (lock.current) return;
    setPlayers([]);
    lock.current = true;
    const round = scene.round!;
    round.curPlayer += 2;
    if (round.curPlayer + 1 >= round.players.length) {
      finalizeMatch();
      const [finalizedRank, newRound] = gameService.nextRound(scene.game!);
      if (newRound) {
        scene.round = newRound;
        setPlayers([newRound.players[0], newRound.players[1]]);
      }
      setFinalRank(finalizedRank);
      sessionUpdated();
      lock.current = false;
      return;
    }
    setPlayers([
      round.players[round.curPlayer],
      round.players[round.curPlayer + 1],
    ]);
    sessionUpdated();
    lock.current = false;
  };
  const gameUpdated = () => {
    gameService.gameUpdated(curSession!, scene);
    sessionUpdated();
  };
  const sessionUpdated = () => {};

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      if (
        (e.key === 'h' || e.key === 'H') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        appState.showTournamentCheatsheet = !appState.showTournamentCheatsheet;
        return;
      }

      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        resetRanksRef.current();
        return;
      }

      if (!playersRef.current.length || lockRef.current.current) return;

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const r = scene.round!;
      if (!r) return;

      if (e.key === 'a' || e.key === 'A' || e.key === ',') {
        e.preventDefault();
        r.winMask[r.curPlayer] = true;
        r.winMask[r.curPlayer + 1] = false;
        nextMatchRef.current();
      } else if (e.key === 'd' || e.key === 'D' || e.key === '.') {
        e.preventDefault();
        r.winMask[r.curPlayer] = false;
        r.winMask[r.curPlayer + 1] = true;
        nextMatchRef.current();
      } else if (
        e.key === 'w' ||
        e.key === 'W' ||
        e.key === 'k' ||
        e.key === 'K'
      ) {
        e.preventDefault();
        r.winMask[r.curPlayer] = true;
        r.winMask[r.curPlayer + 1] = true;
        nextMatchRef.current();
      } else if (
        e.key === 's' ||
        e.key === 'S' ||
        e.key === 'l' ||
        e.key === 'L'
      ) {
        e.preventDefault();
        r.winMask[r.curPlayer] = false;
        r.winMask[r.curPlayer + 1] = false;
        nextMatchRef.current();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetRanksRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isInputFocused, scene]);

  useEffect(() => {
    setPlayers([]);
    setImages([]);
    setFinalRank(-1);
    (async () => {
      try {
        if (!scene.game) {
          scene.game = await gameService.createGame(path);
        }
        let files = await backend.listFiles(path);
        files = files.filter(isOutputImageFile);
        if (scene.game!.length !== files.length) {
          appState.pushDialog({
            type: 'yes-only',
            text: '새로운 이미지가 추가되었습니다. 순위를 초기화 해주세요.',
          });
        }
        loadRoundInitial();
      } catch (e: any) {
        appState.pushMessage(`Error: ${e.message}`);
      }
    })();
  }, [scene]);
  useEffect(() => {
    const round = scene.round!;
    if (players.length) {
      (async () => {
        try {
          const p0 = (await imageService.fetchImage(
            `${imageService.getOutputDir(curSession!, scene)}/${players[0]}`,
          ))!;
          const p1 = (await imageService.fetchImage(
            `${imageService.getOutputDir(curSession!, scene)}/${players[1]}`,
          ))!;
          setImages([p0, p1]);
        } catch (e: any) {
          appState.pushMessage(`Image load error: ${e.message}`);
          setImages([]);
        }
      })();
    } else if (scene.game && scene.game.length && players.length === 0) {
      const first = scene.game.find((p) => p.rank === 0);
      if (first) {
        (async () => {
          try {
            const p0 = (await imageService.fetchImage(
              `${imageService.getOutputDir(curSession!, scene)}/${first.path}`,
            ))!;
            setImages([p0]);
          } catch (e: any) {
            appState.pushMessage(`Image load error: ${e.message}`);
            setImages([]);
          }
        })();
      } else {
        setImages([]);
      }
    } else {
      setImages([]);
    }
  }, [players]);
  const resetRanks = () => {
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 순위를 초기화하시겠습니까?',
      callback: async () => {
        setPlayers([]);
        setFinalRank(-1);
        try {
          scene.game = await gameService.createGame(path);
          scene.round = undefined;
          loadRoundInitial();
        } catch (e: any) {
          appState.pushMessage(`Error: ${e.message}`);
        }
      },
    });
  };
  const reroll = () => {
    if (!players.length) return;
    const round = scene.round!;
    if (round.players.length <= 1) {
      return;
    }
    const items = round.players.slice(round.curPlayer);
    shuffleArray(items);
    round.players = round.players.slice(0, round.curPlayer).concat(items);
    setPlayers([
      round.players[round.curPlayer],
      round.players[round.curPlayer + 1],
    ]);
    sessionUpdated();
  };
  const getCurWinRank = () => {
    const round = scene.round!;
    if (round.players.length === 2) {
      return '결승전';
    }
    if (round.players.length <= 5) {
      return '준결승전';
    }
    return `${Math.floor(round.players.length / 2)}강`;
  };
  const showFolder = async () => {
    await backend.showFile(path);
  };
  const round = scene.round!;

  nextMatchRef.current = nextMatch;
  resetRanksRef.current = resetRanks;
  playersRef.current = players;

  return (
    <div className="flex flex-col w-full h-full">
      <div className="p-2 md:p-4 flex flex-none gap-2 items-center text-default">
        {players.length ? (
          <span className="font-bold text-xl">
            {finalRank + 1}
위 결정 이상형 월드컵{getCurWinRank()}
{' '}
(
{Math.floor(round.curPlayer / 2) + 1}
/
{Math.floor(round.players.length / 2)}
)
</span>
        ) : (
          <span className="font-bold text-xl">모든 순위가 확정되었습니다</span>
        )}
        <div className="flex-1" />
        <button
          className="text-default opacity-50 hover:opacity-100 transition-opacity cursor-pointer flex items-center gap-1"
          onClick={() => {
            appState.showTournamentCheatsheet = !appState.showTournamentCheatsheet;
          }}
          title="단축키 도움말 (H)"
        >
          <FaQuestion size={14} />
          <span className="text-xs hidden lg:inline">H</span>
        </button>
      </div>
      <div className="px-2 pb-2 md:px-4 md:pb-4 flex flex-none gap-2 w-full border-b line-color flex-wrap">
        <button className="round-button back-sky" onClick={showFolder}>
          결과 폴더 열기
        </button>
        <button className="round-button back-red" onClick={resetRanks}>
          순위 초기화
        </button>
        <button
          onClick={() => {
            if (players.length && !lock.current && round.curPlayer !== 0) {
              setPlayers([]);
              round.curPlayer -= 2;
              setPlayers([
                round.players[round.curPlayer],
                round.players[round.curPlayer + 1],
              ]);
            }
          }}
          className="round-button back-gray"
        >
          실행취소
        </button>
        <button className="round-button back-orange" onClick={reroll}>
          대진 리롤
        </button>
        <button
          className="round-button back-orange"
          onClick={() => {
            if (players.length && !lock.current) {
              round.winMask[round.curPlayer] = false;
              round.winMask[round.curPlayer + 1] = false;
              nextMatch();
            }
          }}
        >
          둘다 패배 처리
        </button>
        <button
          className="round-button back-orange"
          onClick={() => {
            if (players.length && !lock.current) {
              round.winMask[round.curPlayer] = true;
              round.winMask[round.curPlayer + 1] = true;
              nextMatch();
            }
          }}
        >
          둘다 승리 처리
        </button>
      </div>
      <div className="flex-1 w-full overflow-hidden">
        {!!(players.length && images.length) && (
          <div className="flex h-full w-full overflow-hidden flex-col md:flex-row">
            <div className="flex-1 justify-center items-center flex overflow-hidden">
              <img
                draggable={false}
                onClick={() => {
                  if (!lock.current) {
                    round.winMask[round.curPlayer] = true;
                    round.winMask[round.curPlayer + 1] = false;
                    nextMatch();
                  }
                }}
                className="active:brightness-90 hover:brightness-95 cursor-pointer imageSmall "
                src={images[0]}
                onContextMenu={(e) => {
                  show({
                    event: e,
                    props: {
                      ctx: {
                        type: 'image',
                        path: `${imageService.getOutputDir(
                          curSession!,
                          scene,
                        )}/${players[0]}`,
                      },
                    },
                  });
                }}
              />
            </div>
            <div className="bg-gray-300 dark:bg-slate-700 h-px w-full md:w-px md:h-full flex-none" />
            <div className="flex-1 justify-center items-center flex overflow-hidden">
              <img
                draggable={false}
                onClick={() => {
                  if (!lock.current) {
                    round.winMask[round.curPlayer] = false;
                    round.winMask[round.curPlayer + 1] = true;
                    nextMatch();
                  }
                }}
                className="active:brightness-90 hover:brightness-95 cursor-pointer imageSmall"
                src={images[1]}
                onContextMenu={(e) => {
                  show({
                    event: e,
                    props: {
                      ctx: {
                        type: 'image',
                        path: `${imageService.getOutputDir(
                          curSession!,
                          scene,
                        )}/${players[1]}`,
                      },
                    },
                  });
                }}
              />
            </div>
          </div>
        )}
        {!!(
          scene.game &&
          scene.game.length &&
          players.length === 0 &&
          images.length
        ) && (
          <div className="h-full w-full">
            <img className="imageSmall" src={images[0]} draggable={false} />
          </div>
        )}
      </div>
      {showCheatsheet && (
        <ShortcutCheatsheet
          scope="tournament"
          onClose={() => {
            appState.showTournamentCheatsheet = false;
          }}
        />
      )}
    </div>
  );
});

export default Tournament;
