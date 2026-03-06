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

export interface CreateReportParams {
  goodsType: string;
  name: string;
  gender: string;
  birthdate: string;
  birthTime: string;
  partnerName?: string;
  partnerGender?: string;
  partnerBirthdate?: string;
  partnerBirthTime?: string;
}

export interface CreateReportResponse {
  shopOrderNo: string;
}

export interface ReportStatusResponse {
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR';
  reportUrl?: string;
  errorMessage?: string;
}

export async function createReport(
  params: CreateReportParams
): Promise<CreateReportResponse> {
  const response = await fetch(`${getApiUrl()}/api/external/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': getApiKey(),
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
        'X-API-Key': getApiKey(),
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
