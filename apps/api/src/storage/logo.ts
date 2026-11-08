import sharp from 'sharp';
import { AppError, requireCondition } from '../errors.js';
export async function sanitizeLogo(base64: string) {
  const input = Buffer.from(base64, 'base64');
  requireCondition(input.length <= 2_000_000, 'ASSET_TOO_LARGE', 422);
  try {
    const image = sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning' });
    requireCondition(
      ['png', 'jpeg', 'webp'].includes((await image.metadata()).format || ''),
      'UNSAFE_FILE',
      422,
    );
    const output = await image
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    requireCondition(output.data.length <= 2_000_000, 'ASSET_TOO_LARGE', 422);
    return { bytes: output.data, width: output.info.width, height: output.info.height };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('UNSAFE_FILE', 422, false, { cause: error });
  }
}
