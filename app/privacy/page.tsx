export const metadata = {
  title: '개인정보처리방침 - 사주로그 CS Bot',
};

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: 1.8 }}>
      <h1>개인정보처리방침</h1>
      <p><strong>시행일:</strong> 2025년 1월 1일</p>
      <p><strong>운영자:</strong> 사주로그</p>

      <h2>1. 수집하는 개인정보</h2>
      <p>본 서비스는 Instagram DM 고객 상담을 위해 다음 정보를 수집합니다:</p>
      <ul>
        <li>Instagram 사용자 ID 및 사용자명</li>
        <li>Instagram DM 메시지 내용</li>
      </ul>

      <h2>2. 개인정보의 이용 목적</h2>
      <ul>
        <li>고객 문의에 대한 자동 및 수동 응답 제공</li>
        <li>상담 품질 향상을 위한 대화 이력 관리</li>
      </ul>

      <h2>3. 개인정보의 보유 및 파기</h2>
      <p>수집된 개인정보는 상담 목적 달성 후 지체 없이 파기하며, 최대 1년간 보관합니다.</p>

      <h2>4. 개인정보의 제3자 제공</h2>
      <p>수집된 개인정보는 고객 상담 목적 외 제3자에게 제공하지 않습니다.</p>

      <h2>5. 문의</h2>
      <p>개인정보 관련 문의: 070-8095-1558</p>
    </div>
  );
}
