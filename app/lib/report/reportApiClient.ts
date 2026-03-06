function getApiUrl(): string {
  const url = process.env.SAJU_REPORT_API_URL;
  if (!url) throw new Error('Missing SAJU_REPORT_API_URL');
  return url;
}

function getApiKey(): string {
  const key = process.env.SAJU_REPORT_API_KEY;
  if (!key) throw new Error('Missing SAJU_REPORT_API_KEY');
  return key;
}

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
  params: CreateReportParams | CreateReunionReportParams
): Promise<CreateReportResponse> {
  const response = await fetch(`${getApiUrl()}/api/external/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
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
  shopOrderNo: string
): Promise<ReportStatusResponse> {
  const response = await fetch(
    `${getApiUrl()}/api/external/report/status?shopOrderNo=${encodeURIComponent(shopOrderNo)}`,
    {
      headers: {
        'x-api-key': getApiKey(),
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
