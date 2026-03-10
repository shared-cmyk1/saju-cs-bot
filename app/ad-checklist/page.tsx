import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "광고 세트 추가 체크리스트 - 미니용",
  description: "매일 오전 광고 계정 점검 및 새 세트 추가 제안 체크리스트",
};

const checklistItems = [
  {
    id: 1,
    category: "성과 부진",
    title: "성과 부진 → 신규 소재 테스트 필요",
    description: "광고 성과가 하락하고 있어서 새로운 소재 테스트가 필요한 계정",
    indicators: ["ROAS 하락 추세 (3일 연속)", "CPA가 목표 대비 20% 이상 상승", "전환수 감소"],
    action: "새로운 크리에이티브 소재를 제작하여 테스트 세트 추가",
    color: "#FF6B6B",
  },
  {
    id: 2,
    category: "효율 우수",
    title: "효율 좋은 세트 → 소재 추가 생산",
    description: "새로 세팅한 소재 세트 중 효율이 좋아 추가 생산할만한 계정",
    indicators: ["ROAS가 목표 이상 안정적 유지", "CPA가 목표 이하", "전환수 충분"],
    action: "잘되는 소재의 변형(카피, 썸네일, CTA 변경)을 추가 제작하여 스케일업",
    color: "#51CF66",
  },
  {
    id: 3,
    category: "소재 피로도",
    title: "소재 피로도(Fatigue) 감지",
    description: "동일 타겟에 같은 소재가 오래 노출되어 피로도가 쌓인 계정",
    indicators: ["Frequency 3.0 이상", "CTR 지속 하락 (3일 연속)", "CPM 상승 추세"],
    action: "기존 세트는 유지하되 새로운 소재 세트를 병렬 추가",
    color: "#FF922B",
  },
  {
    id: 4,
    category: "예산 증액",
    title: "예산 증액 시 세트 분산",
    description: "예산을 늘려야 하지만 기존 세트에 급격히 올리면 학습이 깨지는 경우",
    indicators: ["일 예산 소진율 95% 이상", "성과 안정적이라 스케일업 가능", "기존 세트 예산 20% 이상 증액 필요"],
    action: "동일/유사 세팅으로 새 세트를 만들어 예산을 분산 투입",
    color: "#339AF0",
  },
  {
    id: 5,
    category: "타겟 테스트",
    title: "새로운 타겟/오디언스 테스트",
    description: "기존과 다른 관심사, 연령대, 유사 타겟(LAL) 등을 테스트할 때",
    indicators: ["기존 타겟의 도달률 포화", "새로운 타겟 가설이 있음", "시즌/이벤트에 맞는 신규 타겟군 존재"],
    action: "새로운 오디언스 타겟으로 별도 세트 생성",
    color: "#845EF7",
  },
  {
    id: 6,
    category: "전환 이벤트",
    title: "전환 이벤트/캠페인 목표 변경 테스트",
    description: "다른 전환 이벤트(장바구니, 회원가입 등)로 최적화를 테스트할 때",
    indicators: ["현재 전환 이벤트의 볼륨 부족", "퍼널 상위 이벤트로 확장 필요", "새로운 전환 목표 설정"],
    action: "다른 전환 이벤트를 목표로 한 새 세트 추가",
    color: "#20C997",
  },
  {
    id: 7,
    category: "경쟁/시장",
    title: "경쟁사/시장 변화 대응",
    description: "경쟁 심화나 시장 변화로 기존 소재의 경쟁력이 떨어진 경우",
    indicators: ["CPM 급등 (경쟁 심화)", "경쟁사 신규 프로모션 감지", "새로운 USP/프로모션 반영 필요"],
    action: "차별화된 메시지/프로모션을 담은 새 소재 세트 추가",
    color: "#F06595",
  },
  {
    id: 8,
    category: "신규 지면",
    title: "신규 지면/포맷 테스트",
    description: "릴스, 숏폼, 스토리 등 새로운 지면이나 광고 포맷을 테스트할 때",
    indicators: ["현재 미사용 지면 존재", "플랫폼 신규 지면 출시", "특정 지면에서 경쟁사 성과 좋은 사례"],
    action: "해당 지면/포맷에 맞는 소재를 제작하여 별도 세트로 테스트",
    color: "#FCC419",
  },
];

export default function AdChecklist() {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fa", padding: "20px" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h1 style={{ fontSize: "24px", fontWeight: "bold", color: "#212529", marginBottom: "8px" }}>
            광고 세트 추가 체크리스트
          </h1>
          <p style={{ color: "#868e96", fontSize: "14px", marginBottom: "16px" }}>{today}</p>
          <div
            style={{
              background: "#e7f5ff",
              borderLeft: "4px solid #339af0",
              padding: "12px 16px",
              borderRadius: "0 8px 8px 0",
              fontSize: "14px",
              color: "#1c7ed6",
            }}
          >
            매일 오전, 담당 광고 계정을 아래 8가지 기준으로 점검하고 해당하는 계정을 리포트해주세요.
          </div>
        </div>

        {/* Checklist Items */}
        {checklistItems.map((item) => (
          <div
            key={item.id}
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              padding: "20px",
              marginBottom: "12px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              borderLeft: `4px solid ${item.color}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <span
                style={{
                  background: item.color,
                  color: "#fff",
                  fontSize: "11px",
                  fontWeight: "bold",
                  padding: "2px 8px",
                  borderRadius: "4px",
                }}
              >
                #{item.id} {item.category}
              </span>
              <h2 style={{ fontSize: "16px", fontWeight: "bold", color: "#212529" }}>{item.title}</h2>
            </div>

            <p style={{ fontSize: "14px", color: "#495057", marginBottom: "12px" }}>{item.description}</p>

            <div style={{ marginBottom: "12px" }}>
              <p style={{ fontSize: "12px", fontWeight: "bold", color: "#868e96", marginBottom: "6px" }}>
                확인 지표
              </p>
              {item.indicators.map((indicator, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "4px 0",
                    fontSize: "13px",
                    color: "#495057",
                  }}
                >
                  <span
                    style={{
                      width: "18px",
                      height: "18px",
                      border: "2px solid #dee2e6",
                      borderRadius: "4px",
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  {indicator}
                </div>
              ))}
            </div>

            <div
              style={{
                background: "#f8f9fa",
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#495057",
              }}
            >
              <strong>Action:</strong> {item.action}
            </div>
          </div>
        ))}

        {/* Summary Table */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            padding: "24px",
            marginTop: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: "bold", color: "#212529", marginBottom: "16px" }}>
            요약 테이블
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "2px solid #dee2e6" }}>
                  <th style={{ padding: "10px 8px", textAlign: "left", color: "#495057" }}>#</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", color: "#495057" }}>케이스</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", color: "#495057" }}>핵심 트리거</th>
                  <th style={{ padding: "10px 8px", textAlign: "left", color: "#495057" }}>해당 계정</th>
                </tr>
              </thead>
              <tbody>
                {checklistItems.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f3f5" }}>
                    <td style={{ padding: "10px 8px" }}>
                      <span
                        style={{
                          background: item.color,
                          color: "#fff",
                          fontSize: "11px",
                          fontWeight: "bold",
                          padding: "2px 6px",
                          borderRadius: "4px",
                        }}
                      >
                        {item.id}
                      </span>
                    </td>
                    <td style={{ padding: "10px 8px", fontWeight: "500" }}>{item.category}</td>
                    <td style={{ padding: "10px 8px", color: "#868e96" }}>{item.indicators[0]}</td>
                    <td style={{ padding: "10px 8px", color: "#adb5bd", fontStyle: "italic" }}>여기에 작성</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", padding: "24px 0", color: "#adb5bd", fontSize: "12px" }}>
          shared-cmyk1 | 광고 운영 체크리스트
        </div>
      </div>
    </div>
  );
}
