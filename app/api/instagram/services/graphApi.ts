const GRAPH_API_BASE = 'https://graph.instagram.com/v21.0';

// Instagram DM 텍스트 메시지 전송
export async function sendMessage(
  instagramUserId: string,
  text: string,
  accessToken: string
): Promise<void> {
  const response = await fetch(`${GRAPH_API_BASE}/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: instagramUserId },
      message: { text },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[GraphAPI] sendMessage failed:', errorText);
    throw new Error(`Failed to send message: ${response.status}`);
  }
}

// Instagram 사용자 정보 조회
export async function getUserInfo(
  instagramUserId: string,
  accessToken: string
): Promise<{ username?: string }> {
  try {
    const response = await fetch(
      `${GRAPH_API_BASE}/${instagramUserId}?fields=username`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      console.warn('[GraphAPI] getUserInfo failed:', response.status);
      return {};
    }

    const data = await response.json();
    return { username: data.username };
  } catch (error) {
    console.warn('[GraphAPI] getUserInfo error:', error);
    return {};
  }
}
