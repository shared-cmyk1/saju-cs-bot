// 에스컬레이션 시 고객에게 보내는 대기 메시지
export function getHoldingMessage(): string {
  return '안녕하세요! 사주로그 CS 봇입니다. 잠시만 기다려주시면 문제를 확인해볼게요!';
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
