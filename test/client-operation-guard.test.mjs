import assert from "node:assert/strict";
import test from "node:test";
import {
  createAsyncLifecycle,
  createClientOperationGuard,
  createPagedRequestGate,
  ensureStableDraftValue,
  ensureStableValue,
  scheduleInvalidFocus,
} from "../src/lib/client-operation-guard.ts";

test("a synchronous operation guard blocks double submit and reverse/correct collisions", () => {
  const guard = createClientOperationGuard();
  const record = guard.acquire("record");

  assert.ok(record);
  assert.equal(guard.acquire("record"), null);
  assert.equal(guard.acquire("reverse"), null);
  assert.equal(guard.acquire("correct"), null);
  assert.deepEqual(guard.snapshot(), {
    kind: "record",
    phase: "requesting",
  });

  assert.equal(guard.markNavigating(record), true);
  assert.deepEqual(guard.snapshot(), {
    kind: "record",
    phase: "navigating",
  });
  assert.equal(guard.isBusy(), true);

  assert.equal(guard.release(record), true);
  const reverse = guard.acquire("reverse");
  assert.ok(reverse);
  assert.equal(guard.release(record), false);
  assert.equal(guard.isCurrent(reverse), true);
});

test("submission and reversal safety keys are assigned once before retry", () => {
  const holder = { current: null };
  const signatureHolder = { current: null };
  let sequence = 0;
  const create = () => `key-${++sequence}`;

  const first = ensureStableDraftValue(
    holder,
    signatureHolder,
    "exact-draft-a",
    create,
  );
  const ambiguousRetry = ensureStableDraftValue(
    holder,
    signatureHolder,
    "exact-draft-a",
    create,
  );
  const editedRetry = ensureStableDraftValue(
    holder,
    signatureHolder,
    "exact-draft-b",
    create,
  );

  assert.equal(first, "key-1");
  assert.equal(ambiguousRetry, first);
  assert.equal(editedRetry, "key-2");
  assert.equal(sequence, 2);

  const reversalHolder = { current: null };
  assert.equal(ensureStableValue(reversalHolder, create), "key-3");
  assert.equal(ensureStableValue(reversalHolder, create), "key-3");
  assert.equal(sequence, 3);
});

test("delayed outcomes cannot update an unmounted or newer lifecycle", () => {
  const lifecycle = createAsyncLifecycle();
  const first = lifecycle.begin();
  assert.equal(lifecycle.isCurrent(first), true);

  const newer = lifecycle.begin();
  assert.equal(lifecycle.isCurrent(first), false);
  assert.equal(lifecycle.isCurrent(newer), true);

  lifecycle.invalidate();
  assert.equal(lifecycle.isCurrent(newer), false);

  const final = lifecycle.begin();
  lifecycle.unmount();
  assert.equal(lifecycle.isMounted(), false);
  assert.equal(lifecycle.isCurrent(final), false);

  lifecycle.mount();
  const remounted = lifecycle.begin();
  assert.equal(lifecycle.isMounted(), true);
  assert.equal(lifecycle.isCurrent(remounted), true);
});

test("invalid-field focus captures the submitted form and is cancellable", () => {
  let frameCallback;
  let cancelledHandle = null;
  let focusCount = 0;
  const form = {
    isConnected: true,
    querySelector(selector) {
      assert.equal(selector, '[aria-invalid="true"]');
      return { focus: () => focusCount++ };
    },
  };
  const cancel = scheduleInvalidFocus(
    form,
    () => true,
    (callback) => {
      frameCallback = callback;
      return 42;
    },
    (handle) => {
      cancelledHandle = handle;
    },
  );

  assert.equal(focusCount, 0);
  frameCallback(0);
  assert.equal(focusCount, 1);
  cancel();
  assert.equal(cancelledHandle, 42);
});

test("invalid-field focus skips disconnected and unmounted forms", () => {
  for (const { connected, mounted } of [
    { connected: false, mounted: true },
    { connected: true, mounted: false },
  ]) {
    let frameCallback;
    let focusCount = 0;
    scheduleInvalidFocus(
      {
        isConnected: connected,
        querySelector() {
          return { focus: () => focusCount++ };
        },
      },
      () => mounted,
      (callback) => {
        frameCallback = callback;
        return 1;
      },
      () => {},
    );
    frameCallback(0);
    assert.equal(focusCount, 0);
  }
});

test("paged coin requests reject overlap, retry the same page, and abort cleanly", () => {
  const gate = createPagedRequestGate(2);
  const first = gate.begin();
  assert.ok(first);
  assert.equal(first.page, 2);
  assert.equal(gate.begin(), null);

  assert.equal(gate.finish(first, false), true);
  assert.equal(gate.nextPage(), 2);
  const retry = gate.begin();
  assert.ok(retry);
  assert.equal(retry.page, 2);
  assert.equal(gate.finish(retry, true), true);
  assert.equal(gate.nextPage(), 3);

  const pending = gate.begin();
  assert.ok(pending);
  assert.equal(pending.page, 3);
  gate.abort();
  assert.equal(pending.controller.signal.aborted, true);
  assert.equal(gate.finish(pending, true), false);
  assert.equal(gate.nextPage(), 3);
  assert.equal(gate.begin()?.page, 3);
});
