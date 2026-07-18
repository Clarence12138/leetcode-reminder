import type {
  ExtensionRequest,
  ExtensionResponse,
  TypedResponse,
} from '../domain/messages';

export class ExtensionRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExtensionRequestError';
    this.code = code;
  }
}

export async function sendExtensionRequest<T extends ExtensionRequest['type']>(
  request: Extract<ExtensionRequest, { readonly type: T }>,
): Promise<TypedResponse<T>> {
  const raw: unknown = await chrome.runtime.sendMessage(request);
  if (!isExtensionResponse(raw)) {
    throw new ExtensionRequestError('INVALID_RESPONSE', '扩展后台返回了无法识别的响应。');
  }
  const response = raw;
  if (!response.ok) {
    throw new ExtensionRequestError(response.error.code, response.error.message);
  }
  return response.data as TypedResponse<T>;
}

function isExtensionResponse(value: unknown): value is ExtensionResponse {
  if (typeof value !== 'object' || value === null) return false;
  const ok: unknown = Reflect.get(value, 'ok');
  if (ok === true) return true;
  if (ok !== false) return false;
  const error: unknown = Reflect.get(value, 'error');
  if (typeof error !== 'object' || error === null) return false;
  return (
    typeof Reflect.get(error, 'code') === 'string' &&
    typeof Reflect.get(error, 'message') === 'string'
  );
}
