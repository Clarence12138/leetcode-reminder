import { Button, Card } from '../../../../src/ui/components';
import type { OnboardingState } from './overview-model';

const STEPS = 3;
const RING_RADIUS = 50;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function OnboardingCard({ hasPending, onGoImport, onGoPending, state }: {
  readonly hasPending: boolean;
  readonly onGoImport: () => void;
  readonly onGoPending: () => void;
  readonly state: OnboardingState;
}): React.ReactElement {
  const { doneCount, imported, rated, recordedNames, solved } = state;
  const pendingNote = hasPending ? '，有待评估的提交' : '';
  return (
    <Card className="onb" padded={false}>
      <div className="onb-main">
        <h2>开始使用</h2>
        <p>走完之后，下面的统计和热力图就会慢慢有内容。</p>
        <ol aria-label="开始使用的步骤" className="steps">
          <Step done={solved} index={1} title="在力扣通过一道题">
            {solved && recordedNames.length > 0 ? `已记录 ${recordedNames.join('、')}` : '安装后去力扣提交并通过一道题，会自动记录'}
          </Step>
          <Step
            action={!rated && hasPending ? <Button onClick={onGoPending} size="sm" tone="primary">去评估</Button> : null}
            done={rated}
            index={2}
            title="为通过的题选择掌握程度"
          >
            {rated ? '已评分，复习计划已生成' : `评完才会排进复习计划${pendingNote}`}
          </Step>
          <Step
            action={imported ? null : <Button onClick={onGoImport} size="sm">从力扣导入</Button>}
            done={imported}
            index={3}
            title="导入以前做过的题（可选）"
          >
            从力扣读取已通过的题目，一次性补齐
          </Step>
        </ol>
      </div>
      <Ring doneCount={doneCount} />
    </Card>
  );
}

function Ring({ doneCount }: { readonly doneCount: number }): React.ReactElement {
  return (
    <div className="ring">
      <svg aria-hidden="true" viewBox="0 0 120 120">
        <circle className="trk" cx="60" cy="60" fill="none" r={RING_RADIUS} strokeWidth="10" />
        <circle
          className="val"
          cx="60"
          cy="60"
          fill="none"
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - doneCount / STEPS)}
          strokeLinecap="round"
          strokeWidth="10"
          transform="rotate(-90 60 60)"
        />
        <text textAnchor="middle" x="60" y="68">{doneCount} / {STEPS}</text>
      </svg>
      <small>完成 {doneCount} 步</small>
    </div>
  );
}

function Step({ action, children, done, index, title }: {
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly done: boolean;
  readonly index: number;
  readonly title: string;
}): React.ReactElement {
  return (
    <li className={done ? 'step done' : 'step'}>
      <span aria-hidden="true" className="n">{done ? '✓' : index}</span>
      <div><b>{title}{done && <span className="ov-sr">（已完成）</span>}</b><small>{children}</small></div>
      <span>{action}</span>
    </li>
  );
}
