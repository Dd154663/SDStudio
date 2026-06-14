import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Buffer } from 'buffer';
import {
  FaPlus,
  FaSearch,
  FaHeart,
  FaRegHeart,
  FaCopy,
  FaTrash,
  FaImage,
  FaFileAlt,
  FaStar,
  FaPen,
  FaFileArchive,
  FaFileImport,
} from 'react-icons/fa';
import { artistLibraryService, imageService, backend } from '../models';
import { IArtistEntry, IArtistImage } from '../models/ArtistLibraryService';
import { appState } from '../models/AppService';
import { dataUriToBase64 } from '../models/ImageService';
import { extractPromptDataFromBase64 } from '../models/util';
import ModalOverlay from './ModalOverlay';

const copyText = async (text: string, msg: string) => {
  try {
    await navigator.clipboard.writeText(text);
    appState.pushMessage(msg);
  } catch (e) {
    appState.pushMessage('복사 실패');
  }
};

const fileToBase64 = async (file: File): Promise<string> => {
  const buf = await file.arrayBuffer();
  return Buffer.from(buf).toString('base64');
};

// ─── 이미지 표시 ───
const ArtistImage = observer(
  ({ path, className, onClick }: { path: string; className?: string; onClick?: () => void }) => {
    const [image, setImage] = useState<string | null>(null);
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const data = await imageService.fetchImage(path);
          if (!cancelled) setImage(data);
        } catch (e) {
          if (!cancelled) setImage(null);
        }
      })();
      return () => { cancelled = true; };
    }, [path]);
    if (image) {
      return <img className={(className || '') + ' object-cover'} src={image} draggable={false} onClick={onClick} />;
    }
    return (
      <div className={(className || '') + ' flex items-center justify-center bg-gray-200 dark:bg-slate-700'} onClick={onClick}>
        <FaImage className="text-gray-400" />
      </div>
    );
  },
);

// ─── 태그 프리셋 관리 ───
const TagPresetManageModal = observer(({ onClose }: { onClose: () => void }) => {
  const [input, setInput] = useState('');
  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="태그 프리셋 관리" width="max-w-md">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            className="flex-1 gray-input text-sm"
            placeholder="새 태그 (예: 러프)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { artistLibraryService.addTagPreset(input); setInput(''); } }}
          />
          <button className="back-sky !rounded-md px-3 py-1.5 text-sm" onClick={() => { artistLibraryService.addTagPreset(input); setInput(''); }}>추가</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {artistLibraryService.tagPresets.length === 0 && (
            <span className="text-sm text-gray-400">프리셋이 없습니다.</span>
          )}
          {artistLibraryService.tagPresets.map((t) => (
            <span key={t} className="flex items-center gap-1 text-sm px-2 py-1 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200">
              {t}
              <button className="text-gray-400 hover:text-red-500" onClick={() => artistLibraryService.removeTagPreset(t)}>
                <FaTrash size={11} />
              </button>
            </span>
          ))}
        </div>
      </div>
    </ModalOverlay>
  );
});

// ─── 프롬프트 보기 ───
const PromptView = observer(({ path }: { path: string }) => {
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [uc, setUc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPrompt(null);
      setUc(null);
      try {
        const dataUri = await backend.readDataFile(path);
        const base64 = dataUriToBase64(dataUri);
        const job = await extractPromptDataFromBase64(base64);
        if (!cancelled) {
          setPrompt(job?.prompt ?? null);
          setUc(job?.uc ?? null);
        }
      } catch (e) {
        if (!cancelled) { setPrompt(null); setUc(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (loading) return <div className="text-xs text-gray-400 py-2">프롬프트 추출 중...</div>;
  if (!prompt && !uc) return <div className="text-xs text-gray-400 py-2">이 이미지에서 프롬프트 메타데이터를 찾지 못했습니다.</div>;
  return (
    <div className="flex flex-col gap-2 mt-2">
      {prompt && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">프롬프트</span>
            <button className="text-xs text-sky-500 hover:text-sky-600" onClick={() => copyText(prompt, '프롬프트를 복사했습니다')}>
              <FaCopy className="inline mr-1" size={10} />복사
            </button>
          </div>
          <div className="text-xs p-2 rounded bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-gray-100 break-words max-h-32 overflow-auto">{prompt}</div>
        </div>
      )}
      {uc && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">네거티브</span>
            <button className="text-xs text-sky-500 hover:text-sky-600" onClick={() => copyText(uc, '네거티브를 복사했습니다')}>
              <FaCopy className="inline mr-1" size={10} />복사
            </button>
          </div>
          <div className="text-xs p-2 rounded bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-gray-100 break-words max-h-24 overflow-auto">{uc}</div>
        </div>
      )}
    </div>
  );
});

// ─── 카드 상세 모달 ───
const ArtistDetailModal = observer(({ artistId, onClose }: { artistId: string; onClose: () => void }) => {
  const artist = artistLibraryService.getArtist(artistId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [managePreset, setManagePreset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!artist) { onClose(); return null; }

  const selected: IArtistImage | undefined =
    artist.images.find((i) => i.id === selectedId) || artist.images[0];

  const addImages = async (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const b64 = await fileToBase64(files[i]);
      await artistLibraryService.addImage(artist.id, b64);
    }
  };

  return (
    <>
      <ModalOverlay isOpen={true} onClose={onClose} title={artist.name} width="max-w-3xl">
        <div className="flex flex-col gap-3">
          {/* 작가 태그 + 즐겨찾기 */}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-mono px-2 py-1.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-gray-100 truncate">artist:{artist.name}</span>
            <button className="back-sky !rounded-md px-3 py-1.5 text-sm" onClick={() => copyText('artist:' + artist.name, '작가 태그를 복사했습니다')}>
              <FaCopy className="inline mr-1" size={12} />복사
            </button>
            <button
              className="icon-button back-gray !rounded-md px-3 py-1.5"
              title="작가 이름 변경"
              onClick={async () => {
                const newName = await appState.pushDialogAsync({
                  type: 'input-confirm',
                  text: `새 작가 이름을 입력하세요 (현재: ${artist.name})`,
                });
                if (newName) artistLibraryService.renameArtist(artist.id, newName);
              }}
            >
              <FaPen />
            </button>
            <button className="icon-button back-gray !rounded-md px-3 py-1.5" title="즐겨찾기" onClick={() => artistLibraryService.toggleFavorite(artist.id)}>
              {artist.favorite ? <FaHeart className="text-red-500" /> : <FaRegHeart />}
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            {/* 좌: 이미지 */}
            <div className="flex-1 min-w-0">
              <div className="w-full aspect-[3/4] rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
                {selected ? (
                  <ArtistImage path={selected.path} className="w-full h-full" />
                ) : (
                  <div className="text-gray-400 text-sm">이미지가 없습니다</div>
                )}
              </div>
              {/* 썸네일 스트립 */}
              <div className="flex flex-wrap gap-2 mt-2">
                {artist.images.map((img) => (
                  <div key={img.id} className={'relative w-14 h-14 rounded overflow-hidden cursor-pointer border-2 ' + (selected?.id === img.id ? 'border-sky-500' : 'border-transparent')}>
                    <ArtistImage path={img.path} className="w-full h-full" onClick={() => { setSelectedId(img.id); setShowPrompt(false); }} />
                  </div>
                ))}
                <button className="w-14 h-14 rounded border border-dashed border-gray-300 dark:border-slate-500 flex items-center justify-center text-gray-400 hover:text-sky-500"
                  onClick={() => fileRef.current?.click()}>
                  <FaPlus />
                </button>
                <input type="file" accept="image/png" multiple ref={fileRef} className="hidden"
                  onChange={(e) => { if (e.target.files) addImages(e.target.files); e.target.value = ''; }} />
              </div>
              {selected && (
                <div className="flex gap-2 mt-2">
                  {artist.images[0]?.id !== selected.id && (
                    <button className="text-xs back-gray !rounded-md px-2 py-1" onClick={() => artistLibraryService.setThumbnail(artist.id, selected.id)}>
                      <FaStar className="inline mr-1" size={10} />대표로 지정
                    </button>
                  )}
                  <button className="text-xs back-gray !rounded-md px-2 py-1" onClick={() => setShowPrompt((v) => !v)}>
                    <FaFileAlt className="inline mr-1" size={10} />{showPrompt ? '프롬프트 닫기' : '프롬프트 보기'}
                  </button>
                  <button className="text-xs icon-button bg-red-500 text-white !rounded-md px-2 py-1" onClick={() => { artistLibraryService.removeImage(artist.id, selected.id); setSelectedId(null); setShowPrompt(false); }}>
                    <FaTrash className="inline mr-1" size={10} />이미지 삭제
                  </button>
                </div>
              )}
              {selected && showPrompt && <PromptView path={selected.path} />}
            </div>

            {/* 우: 태그 */}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">태그</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {artist.tags.length === 0 && <span className="text-xs text-gray-400">태그 없음</span>}
                {artist.tags.map((t) => (
                  <span key={t} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                    {t}
                    <button className="hover:text-red-500" onClick={() => artistLibraryService.removeTag(artist.id, t)}>×</button>
                  </span>
                ))}
              </div>
              <input
                className="w-full gray-input text-sm mb-3"
                placeholder="태그 추가 후 Enter (예: 러프)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { artistLibraryService.addTag(artist.id, tagInput); setTagInput(''); } }}
              />
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">태그 프리셋 (클릭해서 추가)</span>
                <button className="text-xs text-sky-500 hover:text-sky-600" onClick={() => setManagePreset(true)}>
                  <FaPen className="inline mr-1" size={9} />관리
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {artistLibraryService.tagPresets.length === 0 && (
                  <span className="text-xs text-gray-400">프리셋 없음 — "관리"에서 추가</span>
                )}
                {artistLibraryService.tagPresets.map((t) => {
                  const has = artist.tags.includes(t);
                  return (
                    <button key={t} disabled={has}
                      className={'text-xs px-2.5 py-1 rounded-full border ' + (has ? 'border-gray-200 dark:border-slate-700 text-gray-300 dark:text-gray-600' : 'border-gray-300 dark:border-slate-500 text-gray-600 dark:text-gray-300 hover:border-sky-500 hover:text-sky-500')}
                      onClick={() => artistLibraryService.addTag(artist.id, t)}>
                      + {t}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </ModalOverlay>
      {managePreset && <TagPresetManageModal onClose={() => setManagePreset(false)} />}
    </>
  );
});

// ─── 카드 ───
const ArtistCard = observer(({ artist, onOpen }: { artist: IArtistEntry; onOpen: () => void }) => {
  const thumb = artist.images[0];
  return (
    <div className="flex-none w-[calc(50%-8px)] md:w-60 rounded-lg overflow-hidden flex flex-col border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-sky-400 transition-colors">
      {/* 대표 이미지 */}
      <div className="relative w-full aspect-[3/4] md:aspect-auto md:h-72 bg-gray-100 dark:bg-slate-700 cursor-pointer" onClick={onOpen}>
        {thumb ? (
          <ArtistImage path={thumb.path} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400"><FaImage size={30} /></div>
        )}
        {artist.images.length > 0 && (
          <span className="absolute top-2 right-2 text-xs bg-black/60 text-white rounded-md px-2 py-0.5">{artist.images.length}장</span>
        )}
      </div>
      {/* 이름 + 큰 액션 버튼 */}
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate cursor-pointer" onClick={onOpen}>{artist.name}</span>
          <div className="flex gap-1.5 flex-none">
            <button
              title="작가 태그 복사"
              className="p-2 rounded-lg text-gray-500 dark:text-gray-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 hover:text-sky-500 transition-colors"
              onClick={(e) => { e.stopPropagation(); copyText('artist:' + artist.name, '작가 태그를 복사했습니다'); }}
            >
              <FaCopy size={18} />
            </button>
            <button
              title="즐겨찾기"
              className="p-2 rounded-lg text-gray-500 dark:text-gray-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              onClick={(e) => { e.stopPropagation(); artistLibraryService.toggleFavorite(artist.id); }}
            >
              {artist.favorite ? <FaHeart size={18} className="text-red-500" /> : <FaRegHeart size={18} className="hover:text-red-500" />}
            </button>
          </div>
        </div>
        {artist.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {artist.tags.slice(0, 4).map((t) => (
              <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">{t}</span>
            ))}
            {artist.tags.length > 4 && <span className="text-[11px] text-gray-400">+{artist.tags.length - 4}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── 그리드 끝 "새 작가 추가" 카드 ───
const AddArtistCard = ({ onClick }: { onClick: () => void }) => (
  <button
    className="flex-none w-[calc(50%-8px)] md:w-60 self-stretch min-h-[16rem] rounded-lg border-2 border-dashed border-gray-300 dark:border-slate-600 flex flex-col items-center justify-center text-gray-400 hover:border-sky-400 hover:text-sky-500 transition-colors"
    onClick={onClick}
  >
    <FaPlus size={30} />
    <span className="mt-2 text-sm font-medium">새 작가 추가</span>
  </button>
);

// ─── 탭 ───
type SortKey = 'recent' | 'name' | 'favorite';

const ArtistLibraryTab = observer(() => {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [favOnly, setFavOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const newArtist = async () => {
    const name = await appState.pushDialogAsync({ type: 'input-confirm', text: '작가 이름을 입력하세요 (예: suko mugi)' });
    if (!name) return;
    const a = artistLibraryService.createArtist(name);
    if (a) setOpenId(a.id);
  };

  let list = artistLibraryService.search(query);
  if (favOnly) list = list.filter((a) => a.favorite);
  list = [...list].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (sortBy === 'favorite') return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.updatedAt - a.updatedAt);
    return b.updatedAt - a.updatedAt;
  });

  const total = artistLibraryService.artists.length;

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
      {/* 툴바 */}
      <div className="flex-none p-3 border-b border-gray-200 dark:border-slate-600 flex flex-wrap gap-2 items-center bg-gray-50 dark:bg-slate-800">
        <div className="relative flex-1 min-w-[180px]">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
          <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="작가 이름 · 태그로 검색…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="gray-input text-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
          <option value="recent">최근순</option>
          <option value="name">이름순</option>
          <option value="favorite">즐겨찾기 우선</option>
        </select>
        <button className={'round-button px-3 py-2 text-sm ' + (favOnly ? 'back-orange' : 'back-gray')} onClick={() => setFavOnly((v) => !v)}>
          <FaHeart className="inline mr-1" size={12} />즐겨찾기
        </button>
        <button className="round-button back-sky px-4 py-2 text-sm flex items-center gap-1" onClick={newArtist}>
          <FaPlus size={12} /> 새 작가
        </button>
        <button className="round-button back-gray px-3 py-2 text-sm flex items-center gap-1" title="작가 라이브러리 전체 백업" onClick={() => appState.artistLibraryBackupExport()}>
          <FaFileArchive size={13} /> 백업
        </button>
        <button className="round-button back-gray px-3 py-2 text-sm flex items-center gap-1" title="백업 파일에서 복원 (동명 처리 선택)" onClick={() => appState.artistLibraryBackupImport()}>
          <FaFileImport size={13} /> 복원
        </button>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto p-4">
        {total > 0 && list.length === 0 ? (
          <div className="text-center text-gray-400 py-10">검색 결과가 없습니다.</div>
        ) : (
          <div className="flex flex-wrap gap-4 items-start">
            {list.map((a) => (
              <ArtistCard key={a.id} artist={a} onOpen={() => setOpenId(a.id)} />
            ))}
            {/* 항상 그리드 끝에 추가 카드 (마우스 기동 최소화) */}
            <AddArtistCard onClick={newArtist} />
          </div>
        )}
      </div>

      {openId && <ArtistDetailModal artistId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
});

export default ArtistLibraryTab;
