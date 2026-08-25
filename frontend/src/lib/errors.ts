import type { TFunction } from "i18next"

// 백엔드가 준 code(errors.* 키)를 번역해 표시한다. code가 없으면 서버 메시지(error/warning/message)를,
// 그것도 없으면 fallback 또는 공통 문구를 쓴다. params(detail/seconds)로 동적 값 보간.
// 던져진 Error(code/params 부착), 응답 객체({code,error,warning,detail,seconds_since}),
// 또는 catch의 unknown 을 모두 받는다.
export function errText(t: TFunction, x: unknown, fallbackKey = "errors.generic"): string {
  const anyx = x as Record<string, unknown> | null | undefined
  const code = anyx?.code as string | undefined
  if (code) {
    const params = (anyx?.params as Record<string, unknown>) ?? {
      detail: anyx?.detail,
      seconds: anyx?.seconds_since,
    }
    return t(`errors.${code}`, params)
  }
  return (
    (anyx?.warning as string) ||
    (anyx?.error as string) ||
    (anyx?.message as string) ||
    t(fallbackKey)
  )
}
