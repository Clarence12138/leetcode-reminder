import { useEffect, useMemo } from 'react';
import type { DailySummary, ProblemRecord, Settings } from '../../../src/domain/types';
import { Button, buttonClassName } from '../../../src/ui/components';
import { Icon } from '../../../src/ui/Icon';
import type { RouteKey } from '../navigation';
import { formatTodayLine, greetingFor } from './overview/chart-utils';
import { ForecastCard } from './overview/ForecastChart';
import { HeatmapCard } from './overview/Heatmap';
import { MasteryCard } from './overview/MasteryCard';
import { OnboardingCard } from './overview/Onboarding';
import { buildOverviewModel, problemLabel, reviewUrl, type OverviewModel } from './overview/overview-model';
import { PendingCard } from './overview/PendingCard';
import { QueueCard } from './overview/QueueCard';
import { StatTiles } from './overview/StatTiles';
import './overview/overview.css';

export interface OverviewViewProps {
  readonly onNavigate: (route: RouteKey) => void;
  readonly refresh: () => Promise<void>;
  /** 从 `#queue` 进入时滚到今日队列。 */
  readonly scrollToQueue?: boolean;
  readonly settings: Settings;
  readonly summary: DailySummary;
}

export function OverviewView({ onNavigate, refresh, scrollToQueue = false, settings, summary }: OverviewViewProps): React.ReactElement {
  const model = useMemo(() => buildOverviewModel(summary, settings), [summary, settings]);
  useScrollTo('today-queue', scrollToQueue);
  const hasPending = summary.pendingReviews.length > 0;

  return (
    <div className="view-content overview">
      <Hello model={model} onNavigate={onNavigate} settings={settings} />
      <IssueNotice count={model.unreadIssues} onNavigate={onNavigate} />
      {model.cold && (
        <OnboardingCard hasPending={hasPending} onGoImport={() => onNavigate('settings')} onGoPending={() => scrollToId('pending-reviews')} state={model.onboarding} />
      )}
      <StatTiles model={model} settings={settings} />
      <div className="ov-row">
        <HeatmapCard cold={model.cold} now={model.now} reviews={summary.recentReviews} timezone={model.timezone} />
        <ForecastCard cold={model.cold} forecast={model.forecast} limit={settings.dailyReviewLimit} />
      </div>
      <MainRow model={model} refresh={refresh} settings={settings} summary={summary} />
    </div>
  );
}

function MainRow({ model, refresh, settings, summary }: {
  readonly model: OverviewModel;
  readonly refresh: () => Promise<void>;
  readonly settings: Settings;
  readonly summary: DailySummary;
}): React.ReactElement | null {
  const { cold } = model;
  const showQueue = !cold || summary.dueProblems.length > 0;
  const showPending = !cold || summary.pendingReviews.length > 0;
  if (!showQueue && !showPending) return null;
  return (
    <div className={showQueue ? 'ov-row ov-row-main' : 'ov-row ov-row-single'}>
      {showQueue && <QueueCard model={model} refresh={refresh} settings={settings} />}
      <div className="ov-stack">
        {showPending && <PendingCard problemMap={model.problemMap} refresh={refresh} reviews={summary.pendingReviews} />}
        {!cold && <MasteryCard mastery={model.mastery} />}
      </div>
    </div>
  );
}

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

function useScrollTo(id: string, enabled: boolean): void {
  useEffect(() => {
    if (enabled) scrollToId(id);
  }, [id, enabled]);
}

function IssueNotice({ count, onNavigate }: { readonly count: number; readonly onNavigate: (route: RouteKey) => void }): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <button className="ov-issue" onClick={() => onNavigate('issues')} type="button">
      <Icon name="alert" size={16} />
      <span>有 {count} 条提交检测异常需要查看</span>
      <span className="ov-issue-go">打开检测异常 <Icon name="arrow-right" size={14} /></span>
    </button>
  );
}

function Hello({ model, onNavigate, settings }: {
  readonly model: OverviewModel;
  readonly onNavigate: (route: RouteKey) => void;
  readonly settings: Settings;
}): React.ReactElement {
  const { cold, onboarding, progress } = model;
  const dateLine = formatTodayLine(model.now, model.timezone);
  const line = cold && onboarding.dayOfUse !== null ? `${dateLine} · 使用第 ${onboarding.dayOfUse} 天` : dateLine;
  let heading: React.ReactNode;
  if (cold) heading = '欢迎，先把这 3 步走完';
  else if (progress.remaining > 0) heading = <>今天还有 <em className="num">{progress.remaining}</em> 题要复习</>;
  else if (progress.completed > 0) heading = '今天的复习完成了';
  else heading = `${greetingFor(model.now, model.timezone)}，今天没有要复习的题`;
  return (
    <div className="hello">
      <div><p>{line}</p><h1>{heading}</h1></div>
      <div className="hello-act"><StartAction model={model} onNavigate={onNavigate} settings={settings} /></div>
    </div>
  );
}

function StartAction({ model, onNavigate, settings }: {
  readonly model: OverviewModel;
  readonly onNavigate: (route: RouteKey) => void;
  readonly settings: Settings;
}): React.ReactElement | null {
  if (model.next) return <ReviewLink problem={model.next} settings={settings} tone="primary" verb="开始复习" />;
  const extra = model.backlogProblems[0];
  if (extra) return <ReviewLink problem={extra} settings={settings} tone="secondary" verb="再刷一道积压题" />;
  if (model.cold) return null;
  return <Button icon="book" onClick={() => onNavigate('problems')} size="lg">去题库看看</Button>;
}

function ReviewLink({ problem, settings, tone, verb }: {
  readonly problem: ProblemRecord;
  readonly settings: Settings;
  readonly tone: 'primary' | 'secondary';
  readonly verb: string;
}): React.ReactElement {
  return (
    <a className={buttonClassName({ size: 'lg', tone })} href={reviewUrl(problem, settings)} rel="noreferrer" target="_blank">
      <Icon name="play" size={15} />{verb} · {problemLabel(problem)}
    </a>
  );
}
