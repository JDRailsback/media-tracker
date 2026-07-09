"use client";

import { useEffect, useRef, useState } from "react";
import { X, Check } from "lucide-react";

// Editing area is capped so very large source images (a raw banner photo,
// say 4000x2000) don't blow up the modal — the crop box works in DISPLAY
// pixels and gets rescaled to the source image's natural resolution only at
// the very end, in confirmCrop().
const MAX_DISPLAY = 480;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampBox(b: Box, dw: number, dh: number): Box {
  const width = Math.min(b.width, dw);
  const height = Math.min(b.height, dh);
  const x = Math.max(0, Math.min(b.x, dw - width));
  const y = Math.max(0, Math.min(b.y, dh - height));
  return { x, y, width, height };
}

export default function ImageCropModal({
  imageSrc,
  aspect, // width / height, e.g. 2/3 for a poster, 3 for a wide banner. Omit for a freeform crop.
  onCropped,
  onCancel,
}: {
  imageSrc: string;
  aspect?: number;
  onCropped: (dataURL: string) => void;
  onCancel: () => void;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [display, setDisplay] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ mode: "move" | "resize"; startX: number; startY: number; startBox: Box } | null>(null);

  useEffect(() => {
    // crossOrigin lets a CORS-friendly remote image (TMDB/IGDB poster URLs
    // already work this way) be read back out of a <canvas> later — an
    // image loaded WITHOUT it taints the canvas and toDataURL() throws.
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(MAX_DISPLAY / w, MAX_DISPLAY / h, 1);
      const dw = w * scale;
      const dh = h * scale;
      setNatural({ w, h });
      setDisplay({ w: dw, h: dh });

      let boxW = dw;
      let boxH = aspect ? boxW / aspect : dh;
      if (boxH > dh) {
        boxH = dh;
        boxW = aspect ? boxH * aspect : dw;
      }
      setBox({ x: (dw - boxW) / 2, y: (dh - boxH) / 2, width: boxW, height: boxH });
    };
    img.onerror = () => setError("Couldn't load this image for cropping.");
    img.src = imageSrc;
  }, [imageSrc, aspect]);

  function onMoveStart(e: React.PointerEvent) {
    if (!box) return;
    drag.current = { mode: "move", startX: e.clientX, startY: e.clientY, startBox: box };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizeStart(e: React.PointerEvent) {
    e.stopPropagation();
    if (!box) return;
    drag.current = { mode: "resize", startX: e.clientX, startY: e.clientY, startBox: box };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !display) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    const start = drag.current.startBox;

    if (drag.current.mode === "move") {
      setBox(clampBox({ ...start, x: start.x + dx, y: start.y + dy }, display.w, display.h));
      return;
    }

    let width = Math.max(24, Math.min(start.width + dx, display.w - start.x));
    let height = aspect ? width / aspect : Math.max(24, Math.min(start.height + dy, display.h - start.y));
    if (aspect) {
      if (start.y + height > display.h) height = display.h - start.y;
      width = height * aspect;
      if (start.x + width > display.w) {
        width = display.w - start.x;
        height = width / aspect;
      }
    }
    setBox({ ...start, width, height });
  }

  function onPointerUp() {
    drag.current = null;
  }

  function confirmCrop() {
    if (!box || !natural || !display) return;
    const scaleX = natural.w / display.w;
    const scaleY = natural.h / display.h;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.width * scaleX));
    canvas.height = Math.max(1, Math.round(box.height * scaleY));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        ctx.drawImage(
          img,
          box.x * scaleX,
          box.y * scaleY,
          box.width * scaleX,
          box.height * scaleY,
          0,
          0,
          canvas.width,
          canvas.height
        );
        onCropped(canvas.toDataURL("image/jpeg", 0.9));
      } catch {
        setError(
          "This image can't be cropped due to cross-origin restrictions from its source — try dragging the file in instead of using a URL."
        );
      }
    };
    img.src = imageSrc;
  }

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-scale-in rounded-2xl bg-surface p-5 shadow-2xl ring-1 ring-hairline"
      >
        <div className="mb-3 flex items-center justify-between gap-6">
          <h3 className="text-[14px] font-bold text-ink">Crop image</h3>
          <button onClick={onCancel} className="text-subtle hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {error && <p className="mb-3 max-w-[420px] text-[12.5px] text-red-500">{error}</p>}

        {display && box && (
          <div
            className="relative touch-none select-none overflow-hidden rounded-lg bg-black"
            style={{ width: display.w, height: display.h }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />

            {/* Dim everything outside the crop box (four bars, not a single overlay). */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/55" style={{ height: box.y }} />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
              style={{ height: display.h - box.y - box.height }}
            />
            <div
              className="pointer-events-none absolute bg-black/55"
              style={{ left: 0, top: box.y, width: box.x, height: box.height }}
            />
            <div
              className="pointer-events-none absolute bg-black/55"
              style={{ left: box.x + box.width, top: box.y, width: display.w - box.x - box.width, height: box.height }}
            />

            <div
              onPointerDown={onMoveStart}
              className="absolute cursor-move border-2 border-white"
              style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
            >
              <div
                onPointerDown={onResizeStart}
                className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-se-resize rounded-full border-2 border-white bg-accent"
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[13.5px] font-medium text-subtle hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={confirmCrop}
            disabled={!box}
            className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-accent to-accent-2 px-4 py-2 text-[13.5px] font-semibold text-on-accent shadow-sm shadow-accent/25 hover:brightness-110 disabled:opacity-60"
          >
            <Check size={14} />
            Apply crop
          </button>
        </div>
      </div>
    </div>
  );
}
