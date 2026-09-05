export type ClientOperationKind = "record" | "correct" | "reverse";
export type ClientOperationPhase = "requesting" | "navigating";

export type ClientOperationToken = {
  readonly id: symbol;
  readonly kind: ClientOperationKind;
};

export type ClientOperationSnapshot = {
  kind: ClientOperationKind;
  phase: ClientOperationPhase;
} | null;

export function createClientOperationGuard() {
  let active: {
    token: ClientOperationToken;
    phase: ClientOperationPhase;
  } | null = null;

  return {
    acquire(kind: ClientOperationKind): ClientOperationToken | null {
      if (active) return null;
      const token = { id: Symbol(kind), kind };
      active = { token, phase: "requesting" };
      return token;
    },
    markNavigating(token: ClientOperationToken): boolean {
      if (active?.token !== token) return false;
      active.phase = "navigating";
      return true;
    },
    release(token: ClientOperationToken): boolean {
      if (active?.token !== token) return false;
      active = null;
      return true;
    },
    isCurrent(token: ClientOperationToken): boolean {
      return active?.token === token;
    },
    isBusy(): boolean {
      return active !== null;
    },
    snapshot(): ClientOperationSnapshot {
      return active ? { kind: active.token.kind, phase: active.phase } : null;
    },
  };
}

export function ensureStableValue<T>(
  holder: { current: T | null },
  create: () => T,
): T {
  if (holder.current === null) holder.current = create();
  return holder.current;
}

export function ensureStableDraftValue<T>(
  holder: { current: T | null },
  signatureHolder: { current: string | null },
  signature: string,
  create: () => T,
): T {
  if (signatureHolder.current !== signature) {
    holder.current = null;
    signatureHolder.current = signature;
  }
  return ensureStableValue(holder, create);
}

export function createAsyncLifecycle() {
  let mounted = true;
  let generation = 0;
  return {
    mount() {
      mounted = true;
    },
    begin(): number {
      generation += 1;
      return generation;
    },
    isCurrent(candidate: number): boolean {
      return mounted && candidate === generation;
    },
    isMounted(): boolean {
      return mounted;
    },
    invalidate() {
      generation += 1;
    },
    unmount() {
      mounted = false;
      generation += 1;
    },
  };
}

type FocusableForm = {
  isConnected: boolean;
  querySelector<T extends { focus(): void }>(selector: string): T | null;
};

export function scheduleInvalidFocus(
  form: FocusableForm,
  isMounted: () => boolean,
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
) {
  let cancelled = false;
  const handle = requestFrame(() => {
    if (cancelled || !isMounted() || !form.isConnected) return;
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
  return () => {
    cancelled = true;
    cancelFrame(handle);
  };
}

export type PagedRequest = {
  page: number;
  controller: AbortController;
};

export function createPagedRequestGate(initialPage = 2) {
  let nextPage = initialPage;
  let active: PagedRequest | null = null;
  return {
    begin(): PagedRequest | null {
      if (active) return null;
      active = { page: nextPage, controller: new AbortController() };
      return active;
    },
    finish(request: PagedRequest, advance: boolean): boolean {
      if (active !== request) return false;
      if (advance) nextPage = request.page + 1;
      active = null;
      return true;
    },
    isCurrent(request: PagedRequest): boolean {
      return active === request;
    },
    abort() {
      active?.controller.abort();
      active = null;
    },
    nextPage(): number {
      return nextPage;
    },
  };
}
