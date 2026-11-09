let unavailable = false;
export const networkUnavailable = () => unavailable;
export function setNetworkUnavailable(value: boolean) {
  if (unavailable === value) return;
  unavailable = value;
  window.dispatchEvent(new Event('nuqta:network-status'));
}
