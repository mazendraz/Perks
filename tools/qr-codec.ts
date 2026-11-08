import {
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  QRCodeReader,
  DecodeHintType,
} from '@zxing/library';
import sharp from 'sharp';
// Generated PNG fixtures have no camera perspective; pure mode avoids false finder-pattern matches.
export async function decodeQr(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const luma = new Uint8ClampedArray(info.width * info.height);
  for (let i = 0; i < luma.length; i++)
    luma[i] = Math.round(
      0.299 * data[i * 3]! + 0.587 * data[i * 3 + 1]! + 0.114 * data[i * 3 + 2]!,
    );
  return new QRCodeReader()
    .decode(
      new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luma, info.width, info.height))),
      new Map([[DecodeHintType.PURE_BARCODE, true]]),
    )
    .getText();
}
