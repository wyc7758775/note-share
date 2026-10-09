// 共用图片阅览器：全屏遮罩 + 图片廊（左右翻页）
// 富文本里点击图片、文件树里点击图片附件都走这个组件。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface ViewerImage {
  src: string; // dataURL 或外链
  name?: string;
}

export default function ImageViewer({
  images,
  index,
  onClose,
}: {
  images: ViewerImage[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(Math.min(Math.max(0, index), images.length - 1));
  const n = images.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setI((v) => (v - 1 + n) % n);
      if (e.key === "ArrowRight") setI((v) => (v + 1) % n);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [n, onClose]);

  const cur = images[i];

  return createPortal(
    <div className="img-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {n > 1 && (
        <>
          <button className="img-viewer-nav" style={{ left: 18 }} onClick={() => setI((v) => (v - 1 + n) % n)} title="上一张（←）">
            ‹
          </button>
          <button className="img-viewer-nav" style={{ right: 18 }} onClick={() => setI((v) => (v + 1) % n)} title="下一张（→）">
            ›
          </button>
          <div className="img-viewer-count">{i + 1} / {n}</div>
        </>
      )}
      <button className="img-viewer-close" onClick={onClose} title="关闭（Esc）">
        ✕
      </button>
      <div className="img-viewer-stage" onClick={onClose}>
        <img
          src={cur.src}
          alt={cur.name ?? ""}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {cur.name && <div className="img-viewer-name">{cur.name}</div>}
    </div>,
    document.body
  );
}
