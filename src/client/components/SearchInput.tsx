import type { InputHTMLAttributes } from "react";
import { Search } from "lucide-react";

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  iconSize?: number;
};

export function SearchInput({
  value,
  onChange,
  className = "search-box",
  iconSize = 16,
  placeholder = "搜索",
  "aria-label": ariaLabel,
  ...inputProps
}: SearchInputProps) {
  return <label className={className}>
    <Search size={iconSize} aria-hidden="true" />
    <input
      {...inputProps}
      type="search"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel || placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>;
}
