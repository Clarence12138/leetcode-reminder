import { describe, expect, it, vi } from 'vitest';

import { abortableDelay } from '../src/shared/abortable-delay';

describe('abortableDelay', () => {
  it('正常结束后移除取消监听', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    await abortableDelay(1, controller.signal);

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('已取消或等待中取消时以取消原因拒绝', async () => {
    const aborted = AbortSignal.abort(new Error('done'));
    await expect(abortableDelay(10, aborted)).rejects.toThrow('done');

    const controller = new AbortController();
    const pending = abortableDelay(60_000, controller.signal);
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
  });
});
