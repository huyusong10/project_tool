import { useEffect, useState } from "react";
import type { SystemBranding } from "../types";

export const defaultLogoUrl = "/project-management-logo.png";

export const defaultBranding: SystemBranding = {
  systemName: "项目管理",
  shortName: "PM",
  logoUrl: null,
  updatedAt: null,
};

export function useDocumentBranding(branding: SystemBranding) {
  useEffect(() => {
    document.title = branding.systemName || defaultBranding.systemName;

    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.setAttribute("href", branding.logoUrl || defaultLogoUrl);
    if (!branding.logoUrl) favicon.type = "image/png";
    document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((link) => link.remove());
    document.head.appendChild(favicon);
  }, [branding.logoUrl, branding.systemName]);
}

export function BrandLogo({ branding, className = "" }: { branding: SystemBranding; className?: string }) {
  const [activeUrl, setActiveUrl] = useState<string | null>(branding.logoUrl || defaultLogoUrl);
  useEffect(() => setActiveUrl(branding.logoUrl || defaultLogoUrl), [branding.logoUrl]);
  return (
    <span className={`brand-logo${activeUrl ? " has-image" : ""}${className ? ` ${className}` : ""}`} title={branding.systemName}>
      {activeUrl
        ? <img src={activeUrl} alt="" onError={() => setActiveUrl(activeUrl === defaultLogoUrl ? null : defaultLogoUrl)} />
        : <span aria-hidden="true">{branding.shortName || "PM"}</span>}
    </span>
  );
}
