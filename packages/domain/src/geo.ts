// Great-circle distance in metres between two WGS-84 positions.
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180,
    dLat = (lat2 - lat1) * rad,
    dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const valid = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180 &&
  !(latitude === 0 && longitude === 0)
    ? { latitude, longitude }
    : null;
// Reads a position from what people actually paste: "30.0444, 31.2357", or a Google Maps link.
// A place link's pin (!3d…!4d…) wins over the map's centre (@…), which may be off to one side.
export function parseMapsPosition(input: string) {
  const text = decodeURIComponent(input.trim().replace(/\+/g, ' '));
  const number = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp('!3d' + number + '!4d' + number),
    new RegExp('[?&](?:q|query|ll|destination|center)=(?:loc:)?' + number + '\\s*,\\s*' + number),
    new RegExp('/search/' + number + ',\\s*' + number),
    new RegExp('@' + number + ',' + number),
    new RegExp('^' + number + '\\s*[,،]?\\s+' + number + '$'),
    new RegExp('^' + number + '\\s*[,،]\\s*' + number + '$'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return valid(Number(match[1]), Number(match[2]));
  }
  return null;
}
// Google's share button gives a short link; only its own hosts are ever followed.
export const SHORT_MAPS_LINK =
  /^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]{4,40}\/?(?:\?[^\s]*)?$/;
export const GOOGLE_MAPS_HOST =
  /^(?:www\.|maps\.)?google\.(?:com|com\.eg|[a-z]{2,3}(?:\.[a-z]{2})?)$|^maps\.app\.goo\.gl$|^goo\.gl$/;
