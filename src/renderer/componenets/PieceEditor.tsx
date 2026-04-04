import {
  createRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { backend, promptService, sessionService, globalPieceService } from '../models';
import { DropdownSelect } from './UtilComponents';
import Tooltip from './Tooltip';
import PromptEditTextArea from './PromptEditTextArea';
import {
  FaArrowCircleUp,
  FaExchangeAlt,
  FaFileExport,
  FaFileImport,
  FaPlus,
  FaPuzzlePiece,
  FaShare,
  FaTrashAlt,
} from 'react-icons/fa';
import { FaTrash } from 'react-icons/fa';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { isValidPieceLibrary, Piece, PieceLibrary } from '../models/types';
import { appState } from '../models/AppService';
import { migratePieceLibrary } from '../models/legacy';
import { observer } from 'mobx-react-lite';

interface PieceCellProps {
  piece: Piece;
  name: string;
  curPieceLibrary: PieceLibrary;
  width?: number;
  style?: React.CSSProperties;
  movePiece?: (fromIndex: string, toIndex: string) => void;
  onReloadDB?: () => void;
  onPieceContentChange?: () => void;
}
export const PieceCell = observer(
  ({
    piece,
    name,
    curPieceLibrary,
    movePiece,
    width,
    style,
    onReloadDB,
    onPieceContentChange,
  }: PieceCellProps) => {
    const containerRef = useRef<any>();
    const elementRef = createRef<any>();

    const [curWidth, setCurWidth] = useState<number>(0);

    useLayoutEffect(() => {
      const measure = () => {
        if (!containerRef.current) return;
        setCurWidth(containerRef.current.getBoundingClientRect().width);
      };

      measure();
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
      };
    }, []);

    const [{ isDragging }, drag, preview] = useDrag(
      {
        type: 'piece',
        item: { piece, curPieceLibrary, name, width: curWidth },
        canDrag: () => true,
        collect: (monitor) => ({
          isDragging: monitor.isDragging(),
        }),
      },
      [curWidth, piece],
    );

    const [, drop] = useDrop(
      {
        accept: 'piece',
        hover: (draggedItem: any) => {
          if (draggedItem.piece !== piece) {
            movePiece!(draggedItem.pieceName, piece.name);
          }
        },
      },
      [curWidth, piece],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    return (
      <div
        className={
          'p-3 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-500 my-2 rounded-lg ' +
          (isDragging ? 'opacity-0' : '')
        }
        style={style ? { ...style, width: width } : {}}
        ref={(node) => {
          if (movePiece) {
            drag(drop(node));
            containerRef.current = node;
          }
          return null;
        }}
      >
        <div className="flex pb-2">
          <div
            className="font-bold text-default"
            onDoubleClick={() => {
              if (!movePiece) return;
              appState.pushDialog({
                type: 'input-confirm',
                text: '조각의 이름을 변경합니다',
                callback: (name) => {
                  if (!name) return;
                  if (curPieceLibrary.pieces.find((p) => p.name === name)) {
                    appState.pushMessage('조각이 이미 존재합니다');
                    return;
                  }
                  piece!.name = name;
                  onReloadDB?.();
                },
              });
            }}
          >
            {piece.name}
          </div>
          <button
            className="ml-auto text-red-500 dark:text-white"
            onClick={() => {
              if (!movePiece) return;
              const index = curPieceLibrary.pieces.indexOf(piece);
              curPieceLibrary.pieces.splice(index, 1);
              onReloadDB?.();
            }}
          >
            <FaTrash size={20} />
          </button>
        </div>
        <div className="h-20">
          <PromptEditTextArea
            innerRef={elementRef}
            disabled={!movePiece}
            lineHighlight
            value={piece.prompt}
            onChange={(txt) => {
              piece.prompt = txt;
              onPieceContentChange?.();
            }}
          />
        </div>
        <div className={'mt-1 gray-label'}>
          랜덤 줄 선택 모드:{' '}
          <input
            checked={piece.multi}
            type="checkbox"
            onChange={(e) => {
              if (!movePiece) return;
              piece.multi = e.target.checked;
              onPieceContentChange?.();
            }}
          />
        </div>
      </div>
    );
  },
);

const PieceEditor = observer(() => {
  const { curSession } = appState;
  const [scope, setScope] = useState<'local' | 'global'>('local');
  const [selectedPieceLibrary, setSelectedPieceLibrary] = useState<
    string | null
  >(null);
  const [curPieceLibrary, setCurPieceLibrary] = useState<PieceLibrary | null>(
    null,
  );
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const librarySource = scope === 'local'
    ? curSession?.library
    : globalPieceService.library;

  const libraryOptions = librarySource
    ? Array.from(librarySource.entries()).map(([name]) => ({
        label: name,
        value: name,
      }))
    : [];

  useEffect(() => {
    if (selectedPieceLibrary && librarySource) {
      setCurPieceLibrary(librarySource.get(selectedPieceLibrary) ?? null);
    } else {
      setCurPieceLibrary(null);
    }
  }, [selectedPieceLibrary, librarySource]);

  // 스코프 전환 시 선택 초기화
  useEffect(() => {
    setSelectedPieceLibrary(null);
    setCurPieceLibrary(null);
  }, [scope]);

  const reloadDB = () => {
    if (curSession) {
      sessionService.reloadPieceLibraryDB(curSession);
    }
    if (scope === 'global') {
      globalPieceService.scheduleSave();
    }
  };

  const movePiece = (from: string, to: string) => {
    const fromIndex = curPieceLibrary!.pieces.findIndex((p) => p.name === from);
    const toIndex = curPieceLibrary!.pieces.findIndex((p) => p.name === to);
    const [movedKey] = curPieceLibrary!.pieces.splice(fromIndex, 1);
    curPieceLibrary!.pieces.splice(toIndex, 0, movedKey);
    if (scope === 'global') globalPieceService.scheduleSave();
  };

  const handleJsonImport = async (file: File) => {
    try {
      const text = await file.text();
      let json = JSON.parse(text);
      if (!isValidPieceLibrary(json)) {
        appState.pushMessage('올바른 조각그룹 JSON 파일이 아닙니다');
        return;
      }
      if (!json.version) {
        json = migratePieceLibrary(json);
      }
      const source = scope === 'local' ? curSession!.library : globalPieceService.library;
      if (!source.has(json.name)) {
        const lib = PieceLibrary.fromJSON(json);
        if (scope === 'local') {
          source.set(json.name, lib);
        } else {
          globalPieceService.addLibrary(json.name, lib);
        }
        setSelectedPieceLibrary(json.name);
        reloadDB();
        appState.pushMessage(`조각그룹 "${json.name}" 가져오기 완료`);
      } else {
        appState.pushDialog({
          type: 'input-confirm',
          text: `"${json.name}" 이름의 조각그룹이 이미 존재합니다. 새 이름을 입력하세요.`,
          callback: (newName) => {
            if (!newName) return;
            if (source.has(newName)) {
              appState.pushMessage('이미 존재하는 조각그룹 이름입니다');
              return;
            }
            json.name = newName;
            const lib = PieceLibrary.fromJSON(json);
            if (scope === 'local') {
              source.set(newName, lib);
            } else {
              globalPieceService.addLibrary(newName, lib);
            }
            setSelectedPieceLibrary(newName);
            reloadDB();
          },
        });
      }
    } catch (e) {
      appState.pushMessage('JSON 파일을 읽는 중 오류가 발생했습니다');
    }
  };

  const handleFileImport = async (file: File) => {
    if (file.name.endsWith('.json')) {
      await handleJsonImport(file);
      return;
    }
    if (file.name.endsWith('.txt')) {
      await handleWildcardImport(file);
      return;
    }
    appState.pushMessage('txt 또는 json 파일만 지원됩니다');
  };

  const handleWildcardImport = async (file: File) => {
    if (!file.name.endsWith('.txt')) {
      appState.pushMessage('txt 파일만 지원됩니다');
      return;
    }

    const text = await file.text();
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length === 0) {
      appState.pushMessage('파일이 비어있습니다');
      return;
    }

    const pieceName = file.name.replace(/\.txt$/i, '');

    let targetLibrary = curPieceLibrary;
    if (!targetLibrary) {
      const libraryName = 'wildcards';
      const source = scope === 'local' ? curSession!.library : globalPieceService.library;
      if (!source.has(libraryName)) {
        const newLib = PieceLibrary.fromJSON({
          version: 1,
          pieces: [],
          name: libraryName,
        });
        if (scope === 'local') {
          source.set(libraryName, newLib);
        } else {
          globalPieceService.addLibrary(libraryName, newLib);
        }
      }
      targetLibrary = source.get(libraryName)!;
      setSelectedPieceLibrary(libraryName);
    }

    let finalName = pieceName;
    let counter = 1;
    while (targetLibrary.pieces.find((p) => p.name === finalName)) {
      finalName = `${pieceName}_${counter}`;
      counter++;
    }

    const prompt = lines.join('\n');
    targetLibrary.pieces.push(
      Piece.fromJSON({
        name: finalName,
        prompt: prompt,
        multi: true,
      }),
    );

    reloadDB();
    appState.pushMessage(`와일드카드 "${finalName}" 가져오기 완료 (${lines.length}줄, 랜덤 줄 선택 모드 활성화)`);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      await handleFileImport(files[i]);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      await handleFileImport(files[i]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const addLibrary = () => {
    appState.pushDialog({
      type: 'input-confirm',
      text: '조각그룹의 이름을 입력하세요',
      callback: async (name) => {
        if (!name) return;
        const source = scope === 'local' ? curSession!.library : globalPieceService.library;
        if (source.has(name)) {
          appState.pushMessage('조각그룹이 이미 존재합니다');
          return;
        }
        const newLib = PieceLibrary.fromJSON({
          version: 1,
          pieces: [],
          name: name,
        });
        if (scope === 'local') {
          source.set(name, newLib);
        } else {
          globalPieceService.addLibrary(name, newLib);
        }
        setSelectedPieceLibrary(name);
        reloadDB();
      },
    });
  };

  const deleteLibrary = () => {
    if (!selectedPieceLibrary) return;
    appState.pushDialog({
      type: 'confirm',
      text: '정말로 삭제하시겠습니까?',
      callback: async () => {
        if (scope === 'local') {
          curSession!.library.delete(selectedPieceLibrary!);
        } else {
          globalPieceService.deleteLibrary(selectedPieceLibrary!);
        }
        setSelectedPieceLibrary(null);
        reloadDB();
      },
    });
  };

  const exportLibrary = async () => {
    if (!curPieceLibrary) return;
    const prefix = scope === 'local' ? curSession?.name ?? 'global' : 'global';
    const outPath =
      'exports/' +
      prefix +
      '_' +
      selectedPieceLibrary +
      '_' +
      Date.now().toString() +
      '.json';
    await backend.writeFile(outPath, JSON.stringify(curPieceLibrary.toJSON()));
    await backend.showFile(outPath);
  };

  const exportAllGlobal = async () => {
    const allData: Record<string, any> = {};
    for (const [key, value] of globalPieceService.library.entries()) {
      allData[key] = value.toJSON();
    }
    const outPath = 'exports/global_pieces_backup_' + Date.now().toString() + '.json';
    await backend.writeFile(outPath, JSON.stringify(allData));
    await backend.showFile(outPath);
    appState.pushMessage('전역 조각 전체 백업 완료');
  };

  const copyToOtherScope = () => {
    if (!curPieceLibrary || !selectedPieceLibrary) return;
    const targetLabel = scope === 'local' ? '전역' : '로컬';
    const targetSource = scope === 'local' ? globalPieceService.library : curSession!.library;

    const setTargetLib = (name: string, lib: PieceLibrary) => {
      if (scope === 'local') {
        globalPieceService.addLibrary(name, lib);
      } else {
        curSession!.library.set(name, lib);
      }
    };

    // 통째로 복사 (새 이름 또는 대상에 없는 경우)
    const doFullCopy = (name: string) => {
      const cloned = PieceLibrary.fromJSON(curPieceLibrary.toJSON());
      cloned.name = name;
      setTargetLib(name, cloned);
      reloadDB();
      appState.pushMessage(`"${name}" 조각그룹을 ${targetLabel}에 복사했습니다`);
    };

    // 병합: 대상 라이브러리에 소스 조각을 합침
    const doMerge = (name: string, overwriteDuplicates: boolean) => {
      const targetLib = targetSource.get(name)!;
      const srcPieces = curPieceLibrary.pieces;
      let added = 0;
      let overwritten = 0;
      let skipped = 0;

      for (const srcPiece of srcPieces) {
        const existingIdx = targetLib.pieces.findIndex(p => p.name === srcPiece.name);
        if (existingIdx >= 0) {
          if (overwriteDuplicates) {
            targetLib.pieces[existingIdx] = Piece.fromJSON(srcPiece.toJSON());
            overwritten++;
          } else {
            skipped++;
          }
        } else {
          targetLib.pieces.push(Piece.fromJSON(srcPiece.toJSON()));
          added++;
        }
      }

      if (scope === 'local') {
        globalPieceService.scheduleSave();
      }
      reloadDB();

      const parts = [];
      if (added > 0) parts.push(`${added}개 추가`);
      if (overwritten > 0) parts.push(`${overwritten}개 덮어쓰기`);
      if (skipped > 0) parts.push(`${skipped}개 건너뜀`);
      appState.pushMessage(`"${name}" 병합 완료: ${parts.join(', ')}`);
    };

    if (!targetSource.has(selectedPieceLibrary)) {
      // 대상에 동명 라이브러리 없음 → 바로 복사
      doFullCopy(selectedPieceLibrary);
      return;
    }

    // 동명 라이브러리 존재 → 겹치는 조각 분석
    const targetLib = targetSource.get(selectedPieceLibrary)!;
    const srcNames = new Set(curPieceLibrary.pieces.map(p => p.name));
    const tgtNames = new Set(targetLib.pieces.map(p => p.name));
    const overlap = [...srcNames].filter(n => tgtNames.has(n));
    const srcOnly = [...srcNames].filter(n => !tgtNames.has(n));
    const tgtOnly = [...tgtNames].filter(n => !srcNames.has(n));

    // 상세 정보 구성
    let detail = `${targetLabel}에 "${selectedPieceLibrary}" 조각그룹이 이미 존재합니다.\n\n`;
    if (overlap.length > 0) detail += `겹치는 조각(${overlap.length}개): ${overlap.slice(0, 5).join(', ')}${overlap.length > 5 ? ' ...' : ''}\n`;
    if (srcOnly.length > 0) detail += `원본에만 있는 조각(${srcOnly.length}개): ${srcOnly.slice(0, 5).join(', ')}${srcOnly.length > 5 ? ' ...' : ''}\n`;
    if (tgtOnly.length > 0) detail += `대상에만 있는 조각(${tgtOnly.length}개): ${tgtOnly.slice(0, 5).join(', ')}${tgtOnly.length > 5 ? ' ...' : ''}\n`;

    const items: { text: string; value: string }[] = [];
    if (overlap.length > 0) {
      items.push({ text: '병합 (겹치는 조각 덮어쓰기)', value: 'merge-overwrite' });
      items.push({ text: '병합 (겹치는 조각 건너뛰기)', value: 'merge-skip' });
    } else {
      // 이름만 같고 조각이 안 겹침 → 병합이 곧 합치기
      items.push({ text: '병합 (양쪽 조각 모두 유지)', value: 'merge-skip' });
    }
    items.push({ text: '통째로 덮어쓰기 (대상 조각 모두 교체)', value: 'overwrite' });
    items.push({ text: '새 이름으로 복사', value: 'rename' });
    items.push({ text: '취소', value: 'cancel' });

    appState.pushDialog({
      type: 'select',
      text: detail,
      items,
      callback: (action) => {
        if (!action || action === 'cancel') return;
        if (action === 'merge-overwrite') {
          doMerge(selectedPieceLibrary!, true);
        } else if (action === 'merge-skip') {
          doMerge(selectedPieceLibrary!, false);
        } else if (action === 'overwrite') {
          if (scope === 'local') globalPieceService.library.delete(selectedPieceLibrary!);
          else curSession!.library.delete(selectedPieceLibrary!);
          doFullCopy(selectedPieceLibrary!);
        } else if (action === 'rename') {
          appState.pushDialog({
            type: 'input-confirm',
            text: '새 조각그룹 이름을 입력하세요',
            callback: (newName) => {
              if (!newName) return;
              if (targetSource.has(newName)) {
                appState.pushMessage('이미 존재하는 이름입니다');
                return;
              }
              doFullCopy(newName);
            },
          });
        }
      },
    });
  };

  return (
    <div
      className={`flex flex-col relative ${isDraggingFile ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file input for wildcard/json import */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".txt,.json"
        multiple
        onChange={handleFileInputChange}
      />

      {/* 스코프 토글 */}
      <div className="flex gap-1 mb-3">
        <button
          className={`px-4 py-1.5 text-sm rounded-lg ${scope === 'local' ? 'back-sky font-bold' : 'back-llgray'}`}
          onClick={() => setScope('local')}
        >
          로컬 조각
        </button>
        <button
          className={`px-4 py-1.5 text-sm rounded-lg ${scope === 'global' ? 'bg-purple-500 text-white dark:bg-purple-400/25 dark:text-purple-300 font-bold' : 'back-llgray'}`}
          onClick={() => setScope('global')}
        >
          전역 조각
        </button>
      </div>

      {/* 스코프 안내 */}
      {scope === 'local' && (
        <div className="mb-3 px-3 py-2 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 text-sm rounded-lg border border-sky-200 dark:border-sky-700">
          로컬 조각은 현재 프로젝트에서만 사용되며 전역 조각보다 우선됩니다. 프로젝트 내보내기에 포함됩니다.
        </div>
      )}
      {scope === 'global' && (
        <div className="mb-3 px-3 py-2 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-sm rounded-lg border border-purple-200 dark:border-purple-700">
          전역 조각은 모든 프로젝트에서 공유됩니다. 프로젝트 내보내기에는 포함되지 않습니다.
        </div>
      )}

      {/* 라이브러리 선택 + 액션 버튼 */}
      <div className="flex gap-2 items-center mb-3 flex-wrap">
        <div className="flex-1 min-w-48">
          <DropdownSelect
            selectedOption={selectedPieceLibrary}
            menuPlacement="bottom"
            options={libraryOptions}
            onSelect={(opt) => {
              setSelectedPieceLibrary(opt.value);
            }}
          />
        </div>
        <Tooltip content="조각그룹 추가">
          <button
            className="icon-button h-8 px-3 back-sky flex items-center gap-1"
            onClick={addLibrary}
          >
            <FaPlus size={14} /> <span className="text-sm hidden md:inline">추가</span>
          </button>
        </Tooltip>
        <Tooltip content="와일드카드(.txt) 또는 조각그룹(.json) 가져오기">
          <button
            className="icon-button h-8 px-3 back-green flex items-center gap-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <FaFileImport size={14} /> <span className="text-sm hidden md:inline">가져오기 (.txt/.json)</span>
          </button>
        </Tooltip>
        <Tooltip content="선택한 조각그룹 내보내기">
          <button
            className="icon-button h-8 px-3 flex items-center gap-1"
            onClick={exportLibrary}
          >
            <FaShare size={14} /> <span className="text-sm hidden md:inline">내보내기</span>
          </button>
        </Tooltip>
        <Tooltip content="조각그룹 삭제">
          <button
            className="icon-button h-8 px-3 back-red flex items-center gap-1"
            onClick={deleteLibrary}
          >
            <FaTrashAlt size={14} /> <span className="text-sm hidden md:inline">삭제</span>
          </button>
        </Tooltip>
        {curPieceLibrary && (scope === 'local' ? true : !!curSession) && (
          <Tooltip content={scope === 'local' ? '전역 조각으로 복사' : '로컬 조각으로 복사'}>
            <button
              className={`icon-button h-8 px-3 flex items-center gap-1 ${scope === 'local' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' : 'back-sky'}`}
              onClick={copyToOtherScope}
            >
              <FaExchangeAlt size={14} /> <span className="text-sm hidden md:inline">{scope === 'local' ? '전역으로 복사' : '로컬로 복사'}</span>
            </button>
          </Tooltip>
        )}
        {scope === 'global' && (
          <Tooltip content="전역 조각 전체 백업 내보내기">
            <button
              className="icon-button h-8 px-3 back-orange flex items-center gap-1"
              onClick={exportAllGlobal}
            >
              <FaFileExport size={14} /> <span className="text-sm hidden md:inline">전체 백업</span>
            </button>
          </Tooltip>
        )}
      </div>

      {/* Drag and drop hint */}
      {isDraggingFile && (
        <div className="absolute inset-0 flex items-center justify-center bg-sky-100/80 dark:bg-sky-900/80 z-10 pointer-events-none rounded-lg">
          <div className="text-xl font-bold text-sky-600 dark:text-sky-300">
            와일드카드 .txt 파일을 여기에 놓으세요
          </div>
        </div>
      )}

      {/* 빈 상태 */}
      {!curPieceLibrary && libraryOptions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
          <FaPuzzlePiece size={48} className="mb-4 opacity-30" />
          <p className="text-lg mb-2">조각그룹이 없습니다</p>
          <p className="text-sm mb-4">조각그룹을 추가하거나 와일드카드 파일을 가져오세요</p>
          <div className="flex gap-2">
            <button className="round-button back-sky" onClick={addLibrary}>
              조각그룹 추가
            </button>
            <button className="round-button back-green" onClick={() => fileInputRef.current?.click()}>
              와일드카드 가져오기
            </button>
          </div>
        </div>
      )}

      {/* 라이브러리 미선택 상태 (라이브러리는 있지만 선택 안 함) */}
      {!curPieceLibrary && libraryOptions.length > 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-sm">위 드롭다운에서 조각그룹을 선택하세요</p>
        </div>
      )}

      {/* 조각 목록 */}
      {curPieceLibrary && (
        <div className="flex-1 overflow-auto">
          {Array.from(curPieceLibrary.pieces.values()).map((piece) => (
            <PieceCell
              key={curPieceLibrary.name + ' ' + piece.name}
              piece={piece}
              name={curPieceLibrary.name}
              curPieceLibrary={curPieceLibrary}
              movePiece={movePiece}
              onReloadDB={reloadDB}
              onPieceContentChange={scope === 'global' ? () => globalPieceService.scheduleSave() : undefined}
            />
          ))}
          <Tooltip content="조각 추가">
            <button
              className="py-2 px-8 rounded-xl back-lllgray"
              onClick={async () => {
                appState.pushDialog({
                  type: 'input-confirm',
                  text: '조각의 이름을 입력하세요',
                  callback: (name) => {
                    if (!name) return;
                    if (curPieceLibrary.pieces.find((p) => p.name === name)) {
                      appState.pushMessage('조각이 이미 존재합니다');
                      return;
                    }
                    curPieceLibrary!.pieces.push(
                      Piece.fromJSON({
                        name: name,
                        prompt: '',
                        multi: false,
                      }),
                    );
                    reloadDB();
                  },
                });
              }}
            >
              <FaPlus />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

export default PieceEditor;
