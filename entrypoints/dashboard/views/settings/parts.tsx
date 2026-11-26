import { Card } from '../../../../src/ui/components';

export function SettingRow({ children, description, label }: React.PropsWithChildren<{
  readonly description?: React.ReactNode;
  readonly label: string;
}>): React.ReactElement {
  return (
    <div className="srow">
      <div className="lbl"><b>{label}</b>{description !== undefined && <small>{description}</small>}</div>
      <div className="ctrl">{children}</div>
    </div>
  );
}

/** 设置区块：带锚点 id 的卡片，说明文字在标题下。 */
export function Section({ children, className, description, id, title }: React.PropsWithChildren<{
  readonly className?: string;
  readonly description?: string;
  readonly id: string;
  readonly title: string;
}>): React.ReactElement {
  return (
    <Card className={`sec${className ? ` ${className}` : ''}`} id={id} padded={false} title={title}>
      <div className="sec-body">
        {description && <p className="sec-desc">{description}</p>}
        {children}
      </div>
    </Card>
  );
}
