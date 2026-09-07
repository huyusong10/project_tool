import { useEffect, useState } from "react";
import type { SystemBranding } from "../types";

export const defaultLogoUrl = "/project-management-logo.png";

export const defaultBranding: SystemBranding = {
  systemName: "项目管理",
  shortName: "PM",
  logoUrl: null,
  updatedAt: null,
};

/** 把任意比例的 logo 居中绘制成正方形 PNG，避免浏览器标签页拉伸非正方形图标。 */
function squareFavicon(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("无法创建画布"));
      const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("logo 加载失败"));
    image.src = url;
  });
}

export function useDocumentBranding(branding: SystemBranding) {
  useEffect(() => {
    document.title = branding.systemName || defaultBranding.systemName;

    let cancelled = false;
    const applyFavicon = (href: string, type?: string) => {
      if (cancelled) return;
      const favicon = document.createElement("link");
      favicon.rel = "icon";
      if (type) favicon.type = type;
      favicon.setAttribute("href", href);
      document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((link) => link.remove());
      document.head.appendChild(favicon);
    };
    if (!branding.logoUrl) {
      applyFavicon(defaultLogoUrl, "image/png");
    } else {
      squareFavicon(branding.logoUrl).then(
        (href) => applyFavicon(href, "image/png"),
        () => applyFavicon(branding.logoUrl as string),
      );
    }
    return () => { cancelled = true; };
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
