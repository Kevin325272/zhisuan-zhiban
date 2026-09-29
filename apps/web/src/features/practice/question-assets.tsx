import type { QuestionAssetReference } from "@xuetu/contracts";
import { ImageOff, RotateCcw } from "lucide-react";
import { useState } from "react";

import { getQuestionAssetUrl } from "../../api/client";

interface QuestionAssetsProps {
  altPrefix: string;
  assets: QuestionAssetReference[];
  attemptId?: string;
  className?: string;
  questionId: string;
}

export function QuestionAssets({
  altPrefix,
  assets,
  attemptId,
  className = "",
  questionId,
}: QuestionAssetsProps) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const displayable = assets.filter((asset) => asset.availability === "authenticated_api");
  if (displayable.length === 0) return null;

  return (
    <div className={`question-asset-list ${className}`.trim()}>
      {displayable.map((asset, index) => {
        const revision = revisions[asset.asset_id] ?? 0;
        const baseUrl = getQuestionAssetUrl(questionId, asset.asset_id, attemptId);
        const source = revision === 0
          ? baseUrl
          : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}retry=${revision}`;
        if (failed[asset.asset_id]) {
          return (
            <div className="question-asset-error" key={asset.asset_id} role="status">
              <ImageOff aria-hidden="true" size={20} />
              <span>图片加载失败</span>
              <button
                onClick={() => {
                  setFailed((current) => ({ ...current, [asset.asset_id]: false }));
                  setRevisions((current) => ({
                    ...current,
                    [asset.asset_id]: (current[asset.asset_id] ?? 0) + 1,
                  }));
                }}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={14} />重新加载
              </button>
            </div>
          );
        }
        return (
          <figure key={asset.asset_id}>
            <img
              alt={`${altPrefix} ${index + 1}`}
              decoding="async"
              loading="lazy"
              onError={() => setFailed((current) => ({ ...current, [asset.asset_id]: true }))}
              src={source}
            />
          </figure>
        );
      })}
    </div>
  );
}
