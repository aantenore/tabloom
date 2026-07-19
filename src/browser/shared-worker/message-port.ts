export interface MessagePortLike {
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  close(): void;
  postMessage(message: unknown): void;
  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  start(): void;
}
