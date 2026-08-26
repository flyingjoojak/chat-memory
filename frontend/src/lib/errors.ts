import type { TFunction } from "i18next"

// 백엔드가 준 code(errors.* 키)를 번역해 표시한다. code가 없으면 서버 메시지(error/warning/message)를,
// 그것도 없으면 fallback 또는 공통 문구를 쓴다. params(detail/seconds)로 동적 값 보간.
// 던져진 Error(code/params 부착), 응답 객체({code,error,warning,detail,seconds_since}),
// 또는 catch의 unknown 을 모두 받는다.
export function errText(t: TFunction, x: unknown, fallbackKey = "errors.generic"): string {
  const anyx = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : undefined
  const code = typeof anyx?.code === "string" ? anyx.code : undefined
  const serverMsg =
    (typeof anyx?.warning === "string" ? anyx.warning : "") ||
    (typeof anyx?.error === "string" ? anyx.error : "") ||
    (typeof anyx?.message === "string" ? anyx.message : "")
  if (code) {
    const params = (anyx?.params as Record<string, unknown>) ?? {
      detail: anyx?.detail,
      seconds: anyx?.seconds_since,
    }
    // 미매핑 code면 raw 키 문자열("errors.foo")이 노출되지 않게 서버 메시지→fallbackKey로 대체.
    return t(`errors.${code}`, { ...params, defaultValue: serverMsg || t(fallbackKey) })
  }
  return serverMsg || t(fallbackKey)
}
