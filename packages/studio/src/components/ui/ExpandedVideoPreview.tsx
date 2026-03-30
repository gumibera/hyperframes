import type { ReactNode } from "react";

interface ExpandedVideoPreviewProps {
  src: string;
  name: string;
  subtitle: string;
  action: ReactNode;
}

/**
 * Shared expanded video preview used by AssetsTab (video assets) and
 * the Renders panel. Autoplays the video muted+looped inside a full-bleed
 * card. Caller provides the footer action slot (Copy Path, Open, etc.).
 */
export function ExpandedVideoPreview({ src, name, subtitle, action }: ExpandedVideoPreviewProps) {
  return (
    <div className="w-full h-full bg-neutral-950 rounded-[16px] overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black p-4">
        <video
          src={src}
          autoPlay
          muted
          loop
          playsInline
          className="max-w-full max-h-full object-contain rounded"
        />
      </div>
      <div className="px-5 py-3 bg-neutral-900 border-t border-neutral-800/50 flex items-center justify-between flex-shrink-0">
        <div className="min-w-0 flex-1 mr-4">
          <div className="text-sm font-medium text-neutral-200 truncate">{name}</div>
          <div className="text-[10px] text-neutral-600 font-mono mt-0.5 truncate">{subtitle}</div>
        </div>
        {action}
      </div>
    </div>
  );
}
