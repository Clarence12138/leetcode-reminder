import { useState } from 'react';
import type { MasteryRating } from '../domain/types';
import { sendExtensionRequest } from '../shared/messaging';
import { ratingLabel } from './format';

const ratings: readonly MasteryRating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];

export function RatingButtons({
  onRated,
  submissionId,
}: {
  readonly onRated: () => void | Promise<void>;
  readonly submissionId: string;
}): React.ReactElement {
  const [saving, setSaving] = useState<MasteryRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rate = async (rating: MasteryRating): Promise<void> => {
    setSaving(rating);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'submission.rate', payload: { submissionId, rating } });
      await onRated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '评估失败');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rating-control">
      <div className="rating-buttons" aria-label="选择掌握程度">
        {ratings.map((rating) => (
          <button
            className={`rating-button rating-button--${rating.toLowerCase()}`}
            disabled={saving !== null}
            key={rating}
            onClick={() => void rate(rating)}
            type="button"
          >
            {saving === rating ? '保存中…' : ratingLabel[rating]}
          </button>
        ))}
      </div>
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}
