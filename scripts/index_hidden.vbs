' engram 증분 인덱싱을 콘솔 창 없이 실행하는 런처.
' Run(cmd, 0, True): 0 = 창 숨김, True = 종료까지 대기
' (대기해야 작업 스케줄러의 중복 실행 방지(IgnoreNew)가 계속 유효하다)
Option Explicit
Dim sh, target
Set sh = CreateObject("WScript.Shell")
target = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\engram\scripts\index_batch.cmd"
sh.Run """" & target & """", 0, True
