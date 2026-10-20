// 搜索类型过滤行（Workflowy 同款）：全部 / #标签 / @提及 / 日期 / 最近 / 人员 / 更多。
// 结果不在这里显示——主视图（大纲 + 其它笔记）已经进入搜索态。
import { useSettings } from "../../i18n";

export type SearchFilter = "all" | "tags" | "mentions" | "dates" | "recent" | "people" | "more";

const PILL_PITCH = 42; // 38px 按钮 + 4px gap（与 320 宽搜索卡一致）

const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.2" />
    <path
      d="M1.8 8h12.4M8 1.8c1.9 1.7 2.9 3.8 2.9 6.2S9.9 12.5 8 14.2C6.1 12.5 5.1 10.4 5.1 8S6.1 3.5 8 1.8Z"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);
const HashIcon = () => <span className="home-search-glyph">#</span>;
const AtIcon = () => <span className="home-search-glyph">@</span>;
const CalIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
    <rect x="1.6" y="2.7" width="12.8" height="11.7" rx="1.8" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1.6 5.9h12.8M4.8 1.3v2.9M11.2 1.3v2.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <g fill="currentColor">
      <rect x="3.5" y="7.4" width="1.7" height="1.5" rx="0.3" />
      <rect x="7.15" y="7.4" width="1.7" height="1.5" rx="0.3" />
      <rect x="10.8" y="7.4" width="1.7" height="1.5" rx="0.3" />
      <rect x="3.5" y="10" width="1.7" height="1.5" rx="0.3" />
      <rect x="7.15" y="10" width="1.7" height="1.5" rx="0.3" />
      <rect x="10.8" y="10" width="1.7" height="1.5" rx="0.3" />
    </g>
  </svg>
);
const ClockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.1" stroke="currentColor" strokeWidth="1.2" />
    <path d="M8 4.4V8l2.5 1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PeopleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
    <circle cx="6" cy="5.7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M2.1 13.1c.3-2.1 1.9-3.4 3.9-3.4s3.6 1.3 3.9 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="11.4" cy="5.4" r="1.7" stroke="currentColor" strokeWidth="1.2" />
    <path d="M10 9.7c1.7.1 3 1.3 3.4 3.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const MoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="3.6" cy="8" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="12.4" cy="8" r="1.25" />
  </svg>
);

const FILTERS: { key: Exclude<SearchFilter, "more">; labelKey: string; icon: React.ReactNode }[] = [
  { key: "all", labelKey: "searchFilterAll", icon: <GlobeIcon /> },
  { key: "tags", labelKey: "searchFilterTags", icon: <HashIcon /> },
  { key: "mentions", labelKey: "searchFilterMentions", icon: <AtIcon /> },
  { key: "dates", labelKey: "searchFilterDates", icon: <CalIcon /> },
  { key: "recent", labelKey: "searchFilterRecent", icon: <ClockIcon /> },
  { key: "people", labelKey: "searchFilterPeople", icon: <PeopleIcon /> },
];

export default function HomeSearchFilters({
  value,
  onChange,
}: {
  value: SearchFilter;
  onChange: (f: SearchFilter) => void;
}) {
  const { t } = useSettings();
  const idx = FILTERS.findIndex((f) => f.key === value);
  const visible = value !== "all" && value !== "more" && idx >= 0;
  return (
    <div className="home-search-filters" role="toolbar">
      <span
        className="home-search-pill"
        style={{ transform: `translateX(${visible ? idx * PILL_PITCH : 0}px)`, opacity: visible ? 1 : 0 }}
      />
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          className={`home-search-filter${value === f.key ? " is-active" : ""}`}
          aria-label={t(f.labelKey)}
          onClick={() => onChange(f.key)}
        >
          {f.icon}
        </button>
      ))}
      <button
        type="button"
        className={`home-search-filter${value === "more" ? " is-active" : ""}`}
        aria-label={t("searchFilterMore")}
        onClick={() => onChange("more")}
      >
        <MoreIcon />
      </button>
    </div>
  );
}
