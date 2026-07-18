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
  content: React.ReactNode;
  banToggle?: boolean;
  emoji: React.ReactNode;
  onClick?: () => void;
}

interface TabComponentProps {
  tabs: TabProps[];
  toggleView?: React.ReactNode;
  className?: string;
  left?: boolean;
  defaultActiveTab?: number;
}

export const TabComponent: React.FC<TabComponentProps> = ({
  left,
  tabs,
  toggleView,
  defaultActiveTab = 0,
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

  return (
    <div className="h-full flex flex-col px-1 md:p-2">
      <div
        className={
          'flex p-1 md:p-0 md:py-2 flex-none gap-2 items-center w-full mb-1 md:mb-0'
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
          {!tabs[activeTab].banToggle && toggleView && (
            <button
              className="active:brightness-90 hover:brightness-95 select-none h-10 md:hidden text-sm back-llgray px-3 flex-none flex justify-center items-center"
              onClick={() => setToggleViewOpen(!toggleViewOpen)}
            >
              {toggleViewOpen ? '프롬프트 닫기' : '프롬프트 열기'}
            </button>
          )}
          {/* 탭이 많아 가로폭을 넘치면 잘리지 않고 스크롤되도록(min-w-0 + overflow-x-auto). */}
          <div className="tab-seg flex gap-1 ml-auto min-w-0 overflow-x-auto no-scrollbar py-0.5">
            {tabs.map((tab, index) => (
              <button
                key={index}
                className={
                  'active:brightness-90 hover:brightness-95 select-none px-3 text-base h-10 rounded-md flex-none ' +
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
      <div className="flex-1 overflow-hidden relative">
        {!tabs[activeTab].banToggle && toggleViewOpen && (
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
            {tab.content}
          </div>
        ))}
      </div>
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
