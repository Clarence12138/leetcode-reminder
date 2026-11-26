import { useState } from 'react';
import { isProblemPaused, resolveProblemGroup } from '../../../../src/domain/queue-policy';
import type { ProblemRecord, ReviewGroup } from '../../../../src/domain/types';
import { Button, Card, Checkbox, cx, DifficultyBadge, EmptyState, IconButton, Pill } from '../../../../src/ui/components';
import { calendarDaysBetween, formatDate, formatDateTime } from '../../../../src/ui/format';
import { Icon } from '../../../../src/ui/Icon';
import { pauseNotice, requestDelete, requestSetPaused, type ActionRunner, type ProblemSelection } from './problem-actions';

export interface GroupColumn {
  readonly groups: readonly ReviewGroup[];
  /** 设置未加载时为 undefined，默认分组不显示百分比。 */
  readonly defaultRetention: number | undefined;
}

export interface ProblemTableProps {
  /** 当前渲染的行（已筛选、排序、分页）。 */
  readonly problems: readonly ProblemRecord[];
  /** 筛选后的总数（含未加载的）。 */
  readonly matchedCount: number;
  /** 没有自定义分组时为 null，不显示分组列。 */
  readonly groupColumn: GroupColumn | null;
  readonly onLoadMore: () => void;
  readonly onResetFilters: () => void;
  readonly refresh: () => Promise<void>;
  readonly runner: ActionRunner;
  readonly selection: ProblemSelection;
}

export function ProblemTable(props: ProblemTableProps): React.ReactElement {
  const { problems, selection } = props;
  if (problems.length === 0) {
    return (
      <Card className="ptable-card" padded={false}>
        <EmptyState
          action={<Button onClick={props.onResetFilters} size="sm">清除筛选</Button>}
          description="换个关键词，或放宽筛选条件试试。"
          icon="search"
          title="没有符合条件的题目"
        />
      </Card>
    );
  }
  return (
    <Card className="ptable-card" padded={false}>
      <table aria-label="题目列表" className="table ptable">
        <TableHead groupColumn={props.groupColumn !== null} runner={props.runner} selection={selection} />
        <tbody>
          {problems.map((problem) => (
            <ProblemRow
              groupColumn={props.groupColumn}
              key={problem.problemId}
              problem={problem}
              refresh={props.refresh}
              runner={props.runner}
              selection={selection}
            />
          ))}
        </tbody>
      </table>
      <div className="ptable-foot">
        <span className="num">{problems.length < props.matchedCount ? `显示 ${problems.length} / ${props.matchedCount} 题` : `共 ${props.matchedCount} 题`}</span>
        {problems.length < props.matchedCount && <Button onClick={props.onLoadMore} size="sm" tone="ghost">加载更多</Button>}
      </div>
    </Card>
  );
}

function TableHead({ groupColumn, runner, selection }: {
  readonly groupColumn: boolean;
  readonly runner: ActionRunner;
  readonly selection: ProblemSelection;
}): React.ReactElement {
  return (
    <thead>
      <tr>
        <th className="ck">
          <Checkbox ariaLabel="全选当前题目" checked={selection.allSelected} disabled={runner.busy} indeterminate={selection.partlySelected} onChange={selection.setAll} size="sm" />
        </th>
        <th>题目</th>
        <th className="pcol-diff">难度</th>
        {groupColumn && <th className="pcol-group">分组</th>}
        <th className="pcol-tags">标签</th>
        <th className="pcol-due">下次复习</th>
        <th className="ra"><span className="visually-hidden">操作</span></th>
      </tr>
    </thead>
  );
}

function ProblemRow({ groupColumn, problem, refresh, runner, selection }: {
  readonly groupColumn: GroupColumn | null;
  readonly problem: ProblemRecord;
  readonly refresh: () => Promise<void>;
  readonly runner: ActionRunner;
  readonly selection: ProblemSelection;
}): React.ReactElement {
  const paused = isProblemPaused(problem);
  const selected = selection.selectedIds.has(problem.problemId);
  return (
    <tr className={cx(paused && 'paused', selected && 'sel')}>
      <td className="ck">
        <Checkbox ariaLabel={`选择${problem.title}`} checked={selected} disabled={runner.busy} onChange={(checked) => selection.toggle(problem.problemId, checked)} size="sm" />
      </td>
      <td className="ptitle">
        <a href={problem.url} rel="noreferrer" target="_blank">
          <span className="no num">{problem.frontendId}.</span> <b>{problem.title}</b>
          <Icon className="ext" name="external" size={12} />
        </a>
      </td>
      <td className="pcol-diff"><DifficultyBadge difficulty={problem.difficulty} /></td>
      {groupColumn && <td className="pcol-group"><GroupPill column={groupColumn} problem={problem} /></td>}
      <td className="pcol-tags"><TagList tags={problem.tags} /></td>
      <td className="pcol-due"><DueCell paused={paused} problem={problem} /></td>
      <td className="ra"><RowActions paused={paused} problem={problem} refresh={refresh} runner={runner} /></td>
    </tr>
  );
}

function GroupPill({ column, problem }: { readonly column: GroupColumn; readonly problem: ProblemRecord }): React.ReactElement {
  const group = resolveProblemGroup(problem, { reviewGroups: column.groups });
  if (group) return <Pill tone="group">{group.name} · {percent(group.requestRetention)}</Pill>;
  // 默认分组每行都一样，只用淡色文字，避免整列都是标签。
  const label = column.defaultRetention === undefined ? '默认' : `默认 · ${percent(column.defaultRetention)}`;
  return <span className="pcol-default">{label}</span>;
}

function TagList({ tags }: { readonly tags: readonly string[] }): React.ReactElement {
  if (tags.length === 0) return <span className="muted">—</span>;
  return <span className="ptags" title={tags.join('、')}>{tags.slice(0, 3).join(' · ')}{tags.length > 3 && ` +${tags.length - 3}`}</span>;
}

function DueCell({ paused, problem }: { readonly paused: boolean; readonly problem: ProblemRecord }): React.ReactElement {
  if (paused) return <Pill tone="paused">已暂停</Pill>;
  if (problem.nextReviewAt === null) return <Pill tone="pending">待评估</Pill>;
  const due = describeDue(problem.nextReviewAt);
  return (
    <time className={cx('pdue num', due.overdue && 'over')} dateTime={new Date(problem.nextReviewAt).toISOString()} title={formatDateTime(problem.nextReviewAt)}>
      {due.text}
    </time>
  );
}

function RowActions({ paused, problem, refresh, runner }: {
  readonly paused: boolean;
  readonly problem: ProblemRecord;
  readonly refresh: () => Promise<void>;
  readonly runner: ActionRunner;
}): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const { problemId, title } = problem;
  const togglePause = (): void => {
    void runner.run({
      key: `row:pause:${problemId}`,
      label: paused ? '恢复复习' : '暂停复习',
      task: async () => {
        await requestSetPaused([problemId], !paused);
        return pauseNotice({ paused: !paused, problemIds: [problemId], refresh, subject: `「${title}」` });
      },
    });
  };
  const remove = (): void => {
    if (!confirming) { setConfirming(true); return; }
    void runner.run({
      key: `row:delete:${problemId}`,
      label: '删除',
      task: async () => {
        await requestDelete([problemId]);
        return { tone: 'success', message: `已删除「${title}」` };
      },
    });
  };
  return (
    <div className={cx('prow-acts', confirming && 'is-confirming')}>
      <IconButton bare disabled={runner.busy} icon={paused ? 'play' : 'pause'} label={`${paused ? '恢复复习' : '暂停复习'}${title}`} onClick={togglePause} size="sm" title={paused ? '恢复复习' : '暂停复习'} />
      <button
        aria-label={`${confirming ? '确认删除' : '删除'}${title}`}
        className={cx('iconbtn sm bare prow-del', confirming && 'confirm')}
        disabled={runner.busy}
        onBlur={() => setConfirming(false)}
        onClick={remove}
        title={confirming ? '再点一次确认删除' : '删除'}
        type="button"
      >
        <Icon name="trash" size={15} />
        {confirming && <span>确认删除</span>}
      </button>
    </div>
  );
}

const monthDayFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });

/** 下次复习：逾期 N 天 / 今天 / 明天 / N 天后 / 1月28日（跨年带年份）。 */
function describeDue(timestamp: number): { readonly text: string; readonly overdue: boolean } {
  const days = calendarDaysBetween(timestamp);
  if (days < 0) return { text: `逾期 ${-days} 天`, overdue: true };
  if (days === 0) return { text: '今天', overdue: false };
  if (days === 1) return { text: '明天', overdue: false };
  if (days < 14) return { text: `${days} 天后`, overdue: false };
  const sameYear = new Date(timestamp).getFullYear() === new Date().getFullYear();
  return { text: sameYear ? monthDayFormatter.format(timestamp) : formatDate(timestamp), overdue: false };
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
