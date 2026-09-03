import type { ReactNode } from "react";

export function FieldShell({
  label,
  children,
  help,
  full = false,
  className = "",
  asLabel = true,
}: {
  label: ReactNode;
  children: ReactNode;
  help?: ReactNode;
  full?: boolean;
  className?: string;
  asLabel?: boolean;
}) {
  const classes = `field field-shell${full ? " field-full" : ""}${className ? ` ${className}` : ""}`;
  const support = help !== undefined && help !== null && <small className="field-support">{help}</small>;
  return asLabel
    ? <label className={classes}><span className="field-label">{label}</span><span className="field-control">{children}</span>{support}</label>
    : <div className={classes}><span className="field-label">{label}</span><div className="field-control">{children}</div>{support}</div>;
}

export function DataCell({
  primary,
  secondary,
  className = "",
  align = "start",
  density = "regular",
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  density?: "regular" | "compact";
}) {
  return <span className={`data-cell data-cell-${align} data-cell-${density}${className ? ` ${className}` : ""}`}>
    <span className="data-cell-primary">{primary}</span>
    {secondary !== undefined && secondary !== null && <small className="data-cell-secondary">{secondary}</small>}
  </span>;
}
