import React, {
  ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import Select from 'react-select';
import { isMobile } from '../models';
import {
  FaAddressBook,
  FaAmilia,
  FaDAndD,
  FaFileUpload,
  FaPenNib,
  FaTimes,
} from 'react-icons/fa';
import { Scrollbars } from 'react-custom-scrollbars-2';
import { FaAnchor, FaOpencart, FaPerson } from 'react-icons/fa6';
import { FloatView } from './FloatView';
import MobilePromptSheet from './MobilePromptSheet';
import { V2MainRow } from './MobileV2Bars';
import {
  isV2,
  V2_SHEET_PEEK_PX,
  V2_TOP_PIECE_SLOT_ID,
  V2_TOP_SLOT_ID,
} from '../models/mobileV2';

export interface Option<T> {
  value: T;
  label: string;
}

interface DropdownSelectProps<T> {
  selectedOption: T | undefined;
  options: Option<T>[];
  className?: string;
  menuPlacement?: 'top' | 'bottom' | 'auto';
  onSelect: (option: Option<T>) => void;
  disabled?: boolean;
}

export const DropdownSelect = <T,>({
  className,
  menuPlacement,
  selectedOption,
  options,
  disabled,
  onSelect,
}: DropdownSelectProps<T>) => {
  const handleChange = (selected: Option<T> | null) => {
    if (selected) {
      onSelect(selected);
    }
  };

  return (
    <Select
      value={options.find((option) => option.value === selectedOption)}
      options={options}
      onChange={handleChange}
      menuPlacement={menuPlacement}
      menuPortalTarget={document.body}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 'var(--z-tooltip)' }) }}
      isDisabled={disabled}
      isSearchable={!isMobile}
      className={'my-react-select-container w-full ' + (className ?? '')}
      classNamePrefix="my-react-select"
    />
  );
};

export const FileUploadBase64: React.FC<{
  onFileSelect: (file: string) => void;
  disabled?: boolean;
  notext?: boolean;
}> = ({ onFileSelect, disabled, notext }) => {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<any>(null);

  const handleDragEnter = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDragOver = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDrop = (e: any) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setFile(file);
      convertFileToBase64(file);
    }
  };

  const handleFileChange = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      setFile(file);
      convertFileToBase64(file);
    }
  };

  const handleClick = () => {
    if (disabled) return;
    fileInputRef.current.click();
  };

  const convertFileToBase64 = (file: any) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      onFileSelect(base64String.split(',')[1]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      className="w-full h-8 overflow-hidden rounded-full back-sky clickable flex items-center justify-center"
      style={{
        backgroundColor: dragging ? '#0ea5e9' : undefined,
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
      <p className="whitespace-nowrap">
        {file && !notext ? file.name : <FaFileUpload />}
      </p>
    </div>
  );
};

interface TabProps {
  label: string;
  content: React.ReactNode | ((isActive: boolean) => React.ReactNode);
  banToggle?: boolean;
  emoji: React.ReactNode;
  onClick?: () => void;
  /** 모바일 하단 탭 바(mobileTabs='bottom')의 칸 라벨(약 5자). 없으면 label. */
  shortLabel?: string;
}

interface TabComponentProps {
  tabs: TabProps[];
  toggleView?: React.ReactNode;
  className?: string;
  left?: boolean;
  defaultActiveTab?: number;
  /**
   * 모바일 탭 배치(2026-09-26, 씬 편집 창): 'wide'=위 한 줄을 전체 폭 등분(엄지가 닿게), 'bottom'=본문 아래
   * 하단 탭 바(V2 메인 줄 언어, V2MainRow 재사용). 지정하지 않으면 기존(오른쪽 정렬 아이콘 스트립). PC 는 불변.
   */
  mobileTabs?: 'wide' | 'bottom';
  /** 모바일 탭 줄(위 스트립·하단 바)을 잠시 숨김 — 키보드가 떠 편집 중일 때(씬 편집 창 집중 모드, 2026-09-26). PC 불변. */
  mobileTabsHidden?: boolean;
}

export const TabComponent: React.FC<TabComponentProps> = ({
  left,
  tabs,
  toggleView,
  defaultActiveTab = 0,
  mobileTabs,
  mobileTabsHidden,
}) => {
  const [activeTab, setActiveTab] = useState(defaultActiveTab);
  const [toggleViewOpen, setToggleViewOpen] = useState(false);

  const handleTabClick = (index: number) => {
    tabs[index].onClick?.();
    setActiveTab(index);
  };

  useEffect(() => {
    setActiveTab(defaultActiveTab);
  }, [defaultActiveTab]);

  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (typeof action === 'string' && action.startsWith('tab-')) {
        const tabIndex = parseInt(action.split('-')[1], 10) - 1;
        if (tabIndex >= 0 && tabIndex < tabs.length) {
          handleTabClick(tabIndex);
        }
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, [tabs]);

  // 모바일 V2(선택형 배치): 「프롬프트 열기」 대신 하단 시트, 상단 줄 왼쪽은 활성 탭이 채우는 슬롯.
  // 탭 본문의 부모 체인은 클래식과 같게 유지한다(전환 시 재마운트 방지) — 바뀌는 것은 상단 줄과 시트뿐.
  const v2 = isV2();
  const wideTabs = isMobile && mobileTabs === 'wide';
  const bottomTabs = isMobile && mobileTabs === 'bottom';

  return (
    <div className={`h-full flex flex-col px-1 md:p-2${v2 ? ' relative' : ''}`}>
      <div
        className={
          'flex p-1 md:p-0 md:py-2 flex-none gap-2 items-center w-full mb-1 md:mb-0' +
          // 하단 탭 바 배치에서는 모바일 상단 줄을 통째로 숨긴다(PC 스트립은 md 이상에서 그대로)
          (bottomTabs || (isMobile && mobileTabsHidden) ? ' hidden md:flex' : '')
        }
      >
        {/* tab-seg/tab-seg-off: 탭 세그먼트 마감(App.css) — 클래식이면 기존 클래스 그대로 렌더 */}
        {/* 좁은 폭(좁은 창 또는 두꺼운 좌우 패널) 대응: 버튼은 flex-none 으로 눌리지 않게
            하고 컨테이너가 가로 스크롤 — 글자가 세로로 깨지는 문제 방지(모바일 변형과 동일 기법) */}
        <div className="tab-seg md:flex gap-2 w-full max-w-full min-w-0 overflow-x-auto no-scrollbar hidden">
          {tabs.map((tab, index) => (
            <button
              key={index}
              className={
                'active:brightness-90 hover:brightness-95 select-none h-8 px-3 text-sm rounded-md transition-colors flex-none whitespace-nowrap ' +
                (index === activeTab ? `back-sky` : 'back-llgray tab-seg-off')
              }
              onClick={() => handleTabClick(index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex md:hidden gap-1 w-full items-center">
          {v2 && (
            // 씬 탭이 [씬 검색+찾기][프롬프트조각]을 포털로 넣는 자리. 다른 탭에서는 비지만 폭은 그대로라
            // 탭 묶음의 크기와 위치가 변하지 않는다(2026-09-21 사용자 결정).
            <div
              id={V2_TOP_SLOT_ID}
              className="flex-1 min-w-0 h-10 flex items-center gap-1"
            />
          )}
          {v2 && <div id={V2_TOP_PIECE_SLOT_ID} className="flex-none h-10 flex items-center" />}
          {!v2 && !tabs[activeTab].banToggle && toggleView && (
            <button
              className="active:brightness-90 hover:brightness-95 select-none h-10 md:hidden text-sm back-llgray px-3 flex-none flex justify-center items-center"
              onClick={() => setToggleViewOpen(!toggleViewOpen)}
            >
              {toggleViewOpen ? '프롬프트 닫기' : '프롬프트 열기'}
            </button>
          )}
          {/* 탭이 많아 가로폭을 넘치면 잘리지 않고 스크롤되도록(min-w-0 + overflow-x-auto). */}
          <div
            className={`tab-seg flex gap-1 ml-auto overflow-x-auto no-scrollbar py-0.5 ${
              wideTabs ? 'w-full' : v2 ? 'flex-none max-w-[62%]' : 'min-w-0'
            }`}
            // .tab-seg 마감이 width:fit-content 라 유틸 w-full 이 밀린다 → 인라인으로 전체 폭
            style={wideTabs ? { width: '100%' } : undefined}
          >
            {tabs.map((tab, index) => (
              <button
                key={index}
                className={
                  'active:brightness-90 hover:brightness-95 select-none px-3 text-base rounded-md ' +
                  (wideTabs ? 'flex-1 basis-0 min-w-0 h-9 ' : 'h-10 flex-none ') +
                  (index === activeTab ? `back-sky` : 'back-llgray tab-seg-off')
                }
                onClick={() => handleTabClick(index)}
              >
                {tab.emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        className="flex-1 overflow-hidden relative"
        // 접힌 시트 높이만큼의 바닥 여백은 탭별이 아니라 여기 공통 컨테이너에서 한 번만 확보한다
        // (탭마다 주면 퀵 생성처럼 빠뜨린 탭의 바닥 요소가 시트에 가려진다 — 목업에서 실제로 겪음).
        style={v2 ? { paddingBottom: V2_SHEET_PEEK_PX } : undefined}
      >
        {!v2 && !tabs[activeTab].banToggle && toggleViewOpen && (
          <FloatView priority={0} onEscape={() => setToggleViewOpen(false)}>
            {toggleView}
          </FloatView>
        )}
        {tabs.map((tab, index) => (
          <div
            key={index}
            className="h-full overflow-auto"
            style={{ display: index === activeTab ? 'block' : 'none' }}
          >
            {typeof tab.content === 'function'
              ? tab.content(index === activeTab)
              : tab.content}
          </div>
        ))}
      </div>
      {bottomTabs && !mobileTabsHidden && (
        <div className="md:hidden" data-tab-bar="bottom">
          <V2MainRow
            slots={tabs.map((tab, index) => ({
              key: `tab-${index}`,
              name: tab.shortLabel ?? tab.label,
              icon: tab.emoji,
              tone: index === activeTab ? 'accent' : 'default',
              onTap: () => handleTabClick(index),
            }))}
          />
        </div>
      )}
      {v2 && toggleView && <MobilePromptSheet>{toggleView}</MobilePromptSheet>}
    </div>
  );
};

export const NumberSelect: React.FC<{
  n: number;
  selectedNumber: number;
  onChange: (num: number) => void;
}> = ({ n, selectedNumber, onChange }) => {
  const handleChange = (event: any) => {
    onChange(Number(event.target.value));
  };

  return (
    <select value={selectedNumber} onChange={handleChange}>
      {Array.from({ length: n }, (_, i) => (
        <option key={i} value={i}>
          prompt set {i}
        </option>
      ))}
    </select>
  );
};

export const Collapsible = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const toggleCollapse = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div>
      <button onClick={toggleCollapse} className="button">
        {title}
      </button>
      <div style={{ display: isOpen ? 'block' : 'none', padding: '10px' }}>
        {children}
      </div>
    </div>
  );
};

export const TextAreaWithUndo = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const textAreaRef = useRef<any>(null);
  useEffect(() => {
    if (value !== textAreaRef.current.value) {
      textAreaRef.current.value = value;
    }
  }, [value]);
  const handleChange = (e: any) => {
    const newValue = e.target.value;
    onChange(newValue);
  };
  return (
    <textarea
      className="clear-textarea h-full w-full bg-[var(--c-input-bg)] p-2"
      ref={textAreaRef}
      onChange={handleChange}
    />
  );
};

export const CustomScrollbars = ({
  onScroll,
  forwardedRef,
  style,
  children,
}: any) => {
  const refSetter = useCallback((scrollbarsRef: any) => {
    if (scrollbarsRef) {
      forwardedRef(scrollbarsRef.view);
    } else {
      forwardedRef(null);
    }
  }, []);

  return (
    <Scrollbars
      ref={refSetter}
      style={{ ...style, overflow: 'hidden' }}
      onScroll={onScroll}
      renderThumbVertical={({ style: thumbStyle, ...props }) => (
        <div
          {...props}
          className="scrollbar-thumb"
          style={{ ...thumbStyle }}
        />
      )}
      renderTrackVertical={({ style: trackStyle, ...props }) => (
        <div
          {...props}
          className="scrollbar-track"
          style={{
            ...trackStyle,
            right: 2,
            bottom: 2,
            top: 2,
            borderRadius: 4,
          }}
        />
      )}
    >
      {children}
    </Scrollbars>
  );
};
