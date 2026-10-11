// 少量手绘 16px 线框图标，避免引入图标库
export const I = {  chevron: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  folder: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M1.75 4.75A1.5 1.5 0 0 1 3.25 3.25h2.6l1.4 1.75h5.5a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  note: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M3.25 2.75h9.5v10.5h-9.5z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  asset: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="6" cy="6.7" r="1.1" fill="currentColor" />
      <path d="M3 11.5l3.2-3 2.3 2.2 2-1.8 2.5 2.6" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),
  plus: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  folderPlus: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M1.75 4.75A1.5 1.5 0 0 1 3.25 3.25h2.6l1.4 1.75h5.5a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 7.5v3.5M6.25 9.25h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  pencil: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M10.75 2.75l2.5 2.5L6 12.5l-3.25.75L3.5 10l7.25-7.25z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M3 4.75h10M6.25 4.75V3.25h3.5v1.5M4.5 4.75l.6 8h5.8l.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  share: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M11 2.75l2.75 2.75L11 8.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 5.5H6.75a3.5 3.5 0 0 0-3.5 3.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  pen: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 13.5s.5-3 2-4.5l5-5 2.5 2.5-5 5c-1.5 1.5-4.5 2-4.5 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 4l2.5 2.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  canvas: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2.25" y="2.25" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.05" y="2.25" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2.25" y="9.05" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.05" y="9.05" width="4.7" height="4.7" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  image: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6" cy="6.7" r="1.1" fill="currentColor" />
      <path d="M3 11.5l3.2-3 2.3 2.2 2-1.8 2.5 2.6" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="3.25" y="6.75" width="9.5" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 6.75V5a2.5 2.5 0 0 1 5 0v1.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="10.2" r="1.1" fill="currentColor" />
    </svg>
  ),
  unlock: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="3.25" y="6.75" width="9.5" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 6.75V5a2.5 2.5 0 0 1 4.77-1.02" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="10.2" r="1.1" fill="currentColor" />
    </svg>
  ),
  back: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  forward: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  panelLeft: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 2.75v10.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.4 8h1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  switchVault: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 5.5h9l-2.5-2.5M13.5 10.5h-9l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  more: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="3.4" cy="8" r="1.35" fill="currentColor" />
      <circle cx="8" cy="8" r="1.35" fill="currentColor" />
      <circle cx="12.6" cy="8" r="1.35" fill="currentColor" />
    </svg>
  ),
  gear: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <g stroke="currentColor" strokeLinecap="round">
        {/* 外圈环带（齿轮本体） */}
        <circle cx="8" cy="8" r="4.4" strokeWidth="2.2" />
        {/* 中心孔 */}
        <circle cx="8" cy="8" r="1.3" strokeWidth="1.4" />
        {/* 环上的八颗外齿 */}
        <path
          d="M13 8h1.9M8 13v1.9M3 8H1.1M8 3V1.1M11.54 11.54l1.34 1.34M4.46 11.54l-1.34 1.34M11.54 4.46l1.34-1.34M4.46 4.46L3.12 3.12"
          strokeWidth="1.8"
        />
      </g>
    </svg>
  ),
};

/** 个人 logo：线条皮卡丘（单色描边，跟随主题色；眼睛高光用底色挖空） */
export function PikachuLogo({ size = 110, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 130"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Pikachu"
    >
      {/* 左耳（外缘 / 内缘都落在头廓上，黑色耳尖） */}
      <path d="M42 54 Q21 34 14 8" />
      <path d="M14 8 Q30 21 54 47" />
      <path d="M15 9 Q20 23 29 34 L35 29 Q26 19 22 6 Z" fill="currentColor" stroke="none" />
      {/* 右耳 */}
      <path d="M98 54 Q119 34 126 8" />
      <path d="M126 8 Q110 21 86 47" />
      <path d="M125 9 Q120 23 111 34 L105 29 Q114 19 118 6 Z" fill="currentColor" stroke="none" />
      {/* 脸 */}
      <path d="M70 44 C46 44 30 58 30 78 C30 99 48 112 70 112 C92 112 110 99 110 78 C110 58 94 44 70 44 Z" />
      {/* 眼睛（瞳仁 + 高光） */}
      <circle cx="55" cy="74" r="6.5" fill="currentColor" stroke="none" />
      <circle cx="85" cy="74" r="6.5" fill="currentColor" stroke="none" />
      <circle cx="57.4" cy="71.6" r="1.9" fill="var(--surface)" stroke="none" />
      <circle cx="87.4" cy="71.6" r="1.9" fill="var(--surface)" stroke="none" />
      {/* 鼻子 */}
      <path d="M67.4 82 L72.6 82 L70 85.4 Z" fill="currentColor" stroke="none" />
      {/* 嘴巴：人中 + 微笑 */}
      <path d="M70 86 L70 90" />
      <path d="M70 90 Q62 98 54 92" />
      <path d="M70 90 Q78 98 86 92" />
      {/* 腮红（电气纹） */}
      <circle cx="39" cy="88" r="9.5" />
      <circle cx="101" cy="88" r="9.5" />
      <path d="M34 84 L40 92" strokeWidth="2.2" />
      <path d="M38 82 L44 90" strokeWidth="2.2" />
      <path d="M96 84 L102 92" strokeWidth="2.2" />
      <path d="M100 82 L106 90" strokeWidth="2.2" />
    </svg>
  );
}
