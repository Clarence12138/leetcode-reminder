import type { PropsWithChildren, ReactNode } from 'react';
import { Card } from '../../../src/ui/components';

/** 带标题的卡片区块（设置页等仍在使用），内部就是共用的 `Card`。 */
export function Panel({ action, children, className, title }: PropsWithChildren<{
  readonly action?: ReactNode;
  readonly className?: string;
  readonly title: string;
}>): React.ReactElement {
  return <Card {...(className === undefined ? {} : { className })} aside={action} title={title}>{children}</Card>;
}
