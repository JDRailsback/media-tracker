"use client";

import { useEffect, useState } from "react";
import type { MediaItem } from "@/lib/types";

export default function DetailModal({
  item,
  isFollowed,
  onToggleFollow,
  onClose,
}: {
  item: MediaItem;
  isFollowed: boolean;
  onToggleFollow: (full: MediaItem) => void;
  onClose: () => void;
}) {
  // Start with the search-result data, then load full details (watch links).
  const [full, setFull] = useState<MediaItem>(item);

  useEffect(() => {
    const [type, id] = splitId(item.id);
    if (!type || !id) return;
    fetch(`/api/item/${type}/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setFull(d))
      .catch(() => {});
  }, [item.id]);

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <button onClick={onClose} style={{ float: "right" }}>
          Done
        </button>
        {full.posterURL && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={full.posterURL} alt="" width={140} style={{ borderRadius: 8, display: "block", margin: "0 auto" }} />
        )}
        <h2 style={{ textAlign: "center" }}>{full.title}</h2>
        {full.subtitle && <p style={{ textAlign: "center", color: "#666" }}>{full.subtitle}</p>}
        {full.releaseDate && (
          <p style={{ textAlign: "center", color: "#666" }}>
            {new Date(full.releaseDate).toLocaleDateString()}
          </p>
        )}

        <button
          onClick={() => onToggleFollow(full)}
          style={{ display: "block", width: "100%", padding: 10, margin: "12px 0" }}
        >
          {isFollowed ? "Following ✓" : "Follow"}
        </button>

        {full.overview && <p>{full.overview}</p>}

        {full.externalLinks && full.externalLinks.length > 0 && (
          <div>
            <h3>Available on</h3>
            <ul>
              {full.externalLinks.map((l) => (
                <li key={l.provider + l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.provider}
                  </a>{" "}
                  <span style={{ color: "#888", fontSize: 12 }}>({l.kind})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function splitId(id: string): [string, string] {
  const idx = id.indexOf(":");
  return idx < 0 ? ["", ""] : [id.slice(0, idx), id.slice(idx + 1)];
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 10,
};

const sheet: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  maxWidth: 480,
  width: "100%",
  maxHeight: "85vh",
  overflow: "auto",
};
