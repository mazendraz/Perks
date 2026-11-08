import { api, ApiError } from '../api.js';
export async function saveLogo<T>(merchantId: string, file: File, revision: number) {
  if (file.size > 2_000_000) throw new ApiError('ASSET_TOO_LARGE', 422);
  let binary = '';
  for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
  const key = crypto.randomUUID(),
    body = { base64: btoa(binary), publishLogo: true };
  type Result = { asset: { id: string }; merchant: T };
  const send = () =>
    api<Result>('/merchants/' + merchantId + '/assets', { method: 'POST', body, key, revision });
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'NETWORK_UNCERTAIN') throw error;
    const recovered = await api<{ status: string; result?: Result }>(
      '/operations/by-key?scope=' +
        encodeURIComponent('branding.logo:' + merchantId) +
        '&key=' +
        key,
    );
    return recovered.status === 'committed' && recovered.result ? recovered.result : send();
  }
}
