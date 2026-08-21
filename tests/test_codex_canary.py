"""codex_canary 버전 비교 로직 테스트(순수 함수만; 네트워크 없음)."""
import importlib.util
from pathlib import Path

# scripts/ 는 패키지가 아니므로 파일 경로로 로드.
_spec = importlib.util.spec_from_file_location(
    "codex_canary", Path(__file__).resolve().parents[1] / "scripts" / "codex_canary.py"
)
codex_canary = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(codex_canary)


def test_parse_ignores_prerelease_suffix():
    assert codex_canary._parse("0.149.0") == (0, 149, 0)
    assert codex_canary._parse("0.150.0-alpha.2") == (0, 150, 0)
    assert codex_canary._parse("1.2") == (1, 2, 0)


def test_is_newer_true_when_latest_greater():
    assert codex_canary.is_newer("0.150.0", "0.149.0")
    assert codex_canary.is_newer("0.149.1", "0.149.0")
    assert codex_canary.is_newer("1.0.0", "0.149.0")


def test_is_newer_false_when_equal_or_older():
    assert not codex_canary.is_newer("0.149.0", "0.149.0")
    assert not codex_canary.is_newer("0.148.0", "0.149.0")
    # 프리릴리스는 코어 버전 기준 → 0.149.0-alpha 는 0.149.0 과 같게 취급(더 새롭지 않음)
    assert not codex_canary.is_newer("0.149.0-alpha.1", "0.149.0")


def _rollout(dirpath, lines):
    d = dirpath / "2026" / "08" / "21"
    d.mkdir(parents=True, exist_ok=True)
    f = d / "rollout-2026-08-21T10-00-00-019e80dc-1754-7422-b72f-2d176635efb2.jsonl"
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f


def test_local_check_ok_when_turns_extracted(tmp_path):
    _rollout(tmp_path, [
        '{"timestamp":"t","type":"session_meta","payload":{"id":"s","cwd":"/p"}}',
        '{"timestamp":"t","type":"event_msg","payload":{"type":"user_message","message":"안녕"}}',
        '{"timestamp":"t","type":"event_msg","payload":{"type":"agent_message","message":"응"}}',
    ])
    assert codex_canary.local_check(tmp_path) == 0


def test_local_check_flags_drift_when_event_but_zero_turns(tmp_path):
    # event_msg 는 있는데 어떤 턴 시작도 인식 못 하는 경우(=미래 포맷 변경 흉내) → 드리프트 의심
    _rollout(tmp_path, [
        '{"timestamp":"t","type":"session_meta","payload":{"id":"s","cwd":"/p"}}',
        '{"timestamp":"t","type":"event_msg","payload":{"type":"totally_new_user_event","text":"안녕"}}',
        '{"timestamp":"t","type":"event_msg","payload":{"type":"totally_new_agent_event","text":"응"}}',
    ])
    assert codex_canary.local_check(tmp_path) == 1


def test_local_check_no_dir_is_noop(tmp_path):
    assert codex_canary.local_check(tmp_path / "does-not-exist") == 0
