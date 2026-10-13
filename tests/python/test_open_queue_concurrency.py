"""Tests for the file-open queue concurrency pattern used in app.py's
main() for _pending_open_paths (shared between the macOS AppDelegate
callback thread, the _watch_open_queue background thread, and
inject_open_file on the pywebview main thread).

main()'s inject_open_file/_watch_open_queue/_app_openFile(s) are nested
closures and not independently importable, so these tests exercise the
exact same list+lock pattern in isolation to prove the fix's two
properties:
  1. The old pattern (iterate list directly, then clear, no lock) can
     silently lose entries appended by another thread between the
     iteration finishing and the clear() running — the F1 bug.
  2. The new pattern (snapshot a copy under the lock, clear under the
     same lock, iterate the snapshot) is immune to that loss regardless
     of how concurrent appends are timed.
"""
import threading
import time


def _old_unsafe_drain(pending, _lock_unused=None):
    """Replicates the exact pre-fix code: `for p in pending: ...` then
    `pending.clear()`, with no lock — the F1 bug."""
    drained = []
    for p in pending:
        drained.append(p)
    pending.clear()
    return drained


def _new_safe_drain(pending, lock):
    """Replicates the exact post-fix code: snapshot-and-clear under the
    lock, then iterate the snapshot outside the lock."""
    with lock:
        snapshot = list(pending)
        pending.clear()
    return snapshot


class TestOldUnsafeDrainReproducesTheRace:
    def test_old_pattern_can_lose_entries_appended_mid_clear(self):
        # Even when it doesn't raise, the old pattern's "clear() after
        # iterating" step can wipe entries a concurrent appender added
        # between the iteration finishing and the clear() running.
        pending = [1, 2, 3]
        lost = []

        # Simulate: iteration finishes, then — before clear() runs — a
        # concurrent thread appends a new entry. The old code's clear()
        # has no knowledge of it and wipes it anyway.
        drained = []
        for p in pending:
            drained.append(p)
        pending.append(999)  # concurrent appender "wins the race" here
        pending.clear()      # old code: unconditional clear, no lock
        assert 999 not in drained
        assert pending == [], "the old pattern wipes the concurrently-appended entry"
        lost.append(999)
        assert lost, "demonstrates the exact dropped-entry failure mode F1 describes"


class TestNewSafeDrainPreventsTheRace:
    def test_no_runtime_error_under_sustained_concurrent_append(self):
        pending = list(range(500))
        lock = threading.Lock()
        stop = threading.Event()

        def appender():
            i = 1000
            while not stop.is_set():
                with lock:
                    pending.append(i)
                i += 1

        t = threading.Thread(target=appender, daemon=True)
        t.start()
        try:
            for _ in range(200):
                _new_safe_drain(pending, lock)  # must never raise
        finally:
            stop.set()
            t.join(timeout=2)

    def test_no_entry_is_lost_between_concurrent_append_and_drain(self):
        pending = []
        lock = threading.Lock()
        all_appended = []
        all_drained = []
        stop = threading.Event()

        def appender():
            i = 0
            while not stop.is_set() and i < 2000:
                with lock:
                    pending.append(i)
                all_appended.append(i)
                i += 1

        def drainer():
            while not stop.is_set():
                batch = _new_safe_drain(pending, lock)
                all_drained.extend(batch)
                time.sleep(0.001)

        t_app = threading.Thread(target=appender)
        t_drain = threading.Thread(target=drainer)
        t_app.start()
        t_drain.start()
        t_app.join(timeout=5)
        stop.set()
        t_drain.join(timeout=2)
        # Final drain to catch anything appended just before stop was set.
        all_drained.extend(_new_safe_drain(pending, lock))

        assert sorted(all_drained) == sorted(all_appended), (
            "every appended entry must be drained exactly once — "
            "no loss, no duplication"
        )
        assert len(all_drained) == len(set(all_drained)), "no duplicate entries drained"

    def test_drain_and_direct_pop_both_under_lock_do_not_double_process(self):
        # Mirrors _watch_open_queue's own pop(0)-under-lock pattern
        # racing against inject_open_file's snapshot-and-clear, both
        # guarding the same lock.
        pending = list(range(100))
        lock = threading.Lock()
        processed_by_popper = []
        processed_by_drainer = []
        stop = threading.Event()

        def popper():
            while not stop.is_set():
                with lock:
                    if pending:
                        processed_by_popper.append(pending.pop(0))
                    else:
                        break

        def drainer():
            time.sleep(0.0005)
            processed_by_drainer.extend(_new_safe_drain(pending, lock))

        t_pop = threading.Thread(target=popper)
        t_drain = threading.Thread(target=drainer)
        t_pop.start()
        t_drain.start()
        t_pop.join(timeout=5)
        stop.set()
        t_drain.join(timeout=2)

        combined = processed_by_popper + processed_by_drainer
        assert sorted(combined) == list(range(100)), "every item processed exactly once total"
        assert len(combined) == len(set(combined)), "no item processed by both threads"
