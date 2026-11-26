import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from '../../../../src/ui/Icon';

const SAVED_VISIBLE_MS = 1800;
const noop = (): void => undefined;

const SavedContext = createContext<() => void>(noop);

/** 子组件保存成功后调用，页面角落会短暂显示「已保存」。 */
export function useMarkSaved(): () => void {
  return useContext(SavedContext);
}

export function SavedProvider({ children }: React.PropsWithChildren): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mark = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), SAVED_VISIBLE_MS);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <SavedContext.Provider value={mark}>
      {children}
      <div aria-live="polite" className={`saved-tag${visible ? ' is-visible' : ''}`} role="status">
        {visible && <><Icon name="check" size={14} />已保存</>}
      </div>
    </SavedContext.Provider>
  );
}
