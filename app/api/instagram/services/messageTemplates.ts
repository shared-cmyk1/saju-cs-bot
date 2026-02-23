// 첫 DM 인입 시 고객에게 보내는 인사 메시지
export function getHoldingMessage(): string {
  return `안녕하세요, 고객님 🤍

CS 상담 가능 시간은 평일 오전 10시 ~ 오후 6시입니다.
주말·공휴일에는 상담이 어려운 점 양해 부탁드립니다.

문의를 남겨주시면 영업일에 정성껏 답변드리겠습니다.
사주로그를 찾아주셔서 감사합니다 🙏`;
}

// 이미지/스티커 등 비텍스트 메시지에 대한 응답
export function getNonTextMessage(): string {
  return '죄송해요, 텍스트 메시지만 처리할 수 있어요. 궁금한 점을 글로 적어주시면 답변드릴게요! 😊';
}

// 이미 에스컬레이션 진행 중일 때
export function getPendingEscalationMessage(): string {
  return '이전 문의에 대해 확인 중이에요. 곧 답변드릴게요! 😊';
}

// 에러 발생 시 고객에게 보내는 메시지
export function getErrorMessage(): string {
  return '죄송해요, 일시적인 오류가 발생했어요. 잠시 후 다시 메시지를 보내주세요 🙏';
}
