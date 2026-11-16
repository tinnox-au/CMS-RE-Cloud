import type { Ref } from 'react';
import {
  invalidDurationSummary,
  type Problem,
  type ProblemTarget,
} from '../../../lib/playlistEditor.ts';
import { Banner } from '../../../ui/index.ts';
import './playlistEditor.css';

export interface ProblemSummaryProps {
  readonly problems: readonly Problem[];
  /** How many items have an unusable duration, for the M0 sentence. */
  readonly invalidDurations: number;
  /** Takes the reader to the field or the item a line is about. */
  readonly onGoTo: (target: ProblemTarget | null) => void;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * The summary above the form after a save was refused by the checks in the browser: one
 * line per problem, each a link to its field or item (design-system.md, section 8). It is
 * an alert, and it takes focus when it appears, so the reader starts there.
 */
export function ProblemSummary({ problems, invalidDurations, onGoTo, ref }: ProblemSummaryProps) {
  const durations = invalidDurationSummary(invalidDurations);
  return (
    <Banner
      ref={ref}
      tabIndex={-1}
      tone="danger"
      live="assertive"
      title="The draft was not saved."
      className="tx-playlist-editor-problems"
    >
      <div data-testid="playlist-editor-problems">
        {durations !== null && <p>{durations}</p>}
        <ul className="tx-playlist-editor-problems__list">
          {problems.map((problem) => (
            <li key={problem.id}>
              {problem.target === null ? (
                <span>
                  <span className="tx-strong">{problem.label}:</span> {problem.message}
                </span>
              ) : (
                <button
                  type="button"
                  className="tx-playlist-editor-problems__link"
                  onClick={() => {
                    onGoTo(problem.target);
                  }}
                >
                  <span className="tx-strong">{problem.label}:</span> {problem.message}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Banner>
  );
}
