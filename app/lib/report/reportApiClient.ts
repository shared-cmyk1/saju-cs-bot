// === 미리보기 API ===

export interface CreatePreviewParams {
  name?: string;
  gender?: string;
  birthdate: string;
  birthTime?: string;
  goodsTypes?: string[];
}

export interface PreviewItem {
  goodsType: string;
  title: string;
  platform: string;
  previewUrl: string;
}

export interface CreatePreviewResponse {
  success: boolean;
  visitGroupId: string;
  previews: PreviewItem[];
}

export async function createPreview(
  params: CreatePreviewParams,
  apiUrl: string,
  apiKey: string
): Promise<CreatePreviewResponse> {
  const response = await fetch(`${apiUrl}/api/external/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ReportAPI] createPreview failed:', errorText);
    throw new Error(`Preview API error: ${response.status}`);
  }

  return response.json();
}

// === 리포트 API ===

// 일반 사주 요청
export interface CreateReportParams {
  goodsType: string;
  name: string;
  gender: string;
  birthdate: string;
  birthTime: string;
}

// REUNION 요청
export interface CreateReunionReportParams {
  goodsType: 'REUNION';
  myName: string;
  myGender: string;
  myBirthdate: string;
  myBirthTime: string;
  partnerName: string;
  partnerGender: string;
  partnerBirthdate: string;
  partnerBirthTime: string;
}

export interface CreateReportResponse {
  success: boolean;
  shopOrderNo: string;
  reportUrl: string;
  status: string;
  estimatedSeconds: number;
}

export interface ReportStatusResponse {
  status: 'GENERATING' | 'DONE' | 'ERROR';
  reportUrl?: string;
  elapsedSeconds?: number;
  error?: string;
}

export async function createReport(
  params: CreateReportParams | CreateReunionReportParams,
  apiUrl: string,
  apiKey: string
): Promise<CreateReportResponse> {
  const response = await fetch(`${apiUrl}/api/external/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ReportAPI] createReport failed:', errorText);
    throw new Error(`Report API error: ${response.status}`);
  }

  return response.json();
}

export async function checkReportStatus(
  shopOrderNo: string,
  apiUrl: string,
  apiKey: string
): Promise<ReportStatusResponse> {
  const response = await fetch(
    `${apiUrl}/api/external/report/status?shopOrderNo=${encodeURIComponent(shopOrderNo)}`,
    {
      headers: {
        'x-api-key': apiKey,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ReportAPI] checkReportStatus failed:', errorText);
    throw new Error(`Report API status error: ${response.status}`);
  }

  return response.json();
}
