"""주어진 PID가 살아있는 동안 시스템 절전을 막는다(모니터는 꺼져도 됨).

사용: python scripts/keepawake_until.py <PID>
대상 프로세스가 끝나면 절전 방지를 해제하고 종료. Windows 전용.
"""

import ctypes
import sys
import time

_ES_CONTINUOUS = 0x80000000
_ES_SYSTEM_REQUIRED = 0x00000001
_STILL_ACTIVE = 259
_PROCESS_QUERY_LIMITED = 0x1000

k = ctypes.windll.kernel32


def alive(pid: int) -> bool:
    h = k.OpenProcess(_PROCESS_QUERY_LIMITED, False, pid)
    if not h:
        return False
    code = ctypes.c_ulong()
    k.GetExitCodeProcess(h, ctypes.byref(code))
    k.CloseHandle(h)
    return code.value == _STILL_ACTIVE


def main() -> int:
    if len(sys.argv) < 2:
        return 1
    pid = int(sys.argv[1])
    k.SetThreadExecutionState(_ES_CONTINUOUS | _ES_SYSTEM_REQUIRED)
    try:
        while alive(pid):
            time.sleep(30)
    finally:
        k.SetThreadExecutionState(_ES_CONTINUOUS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
