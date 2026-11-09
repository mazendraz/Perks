// @vitejs/plugin-legacy 8.2.4 exports these four inline bootstrap hashes.
// Vite config checks the pinned package and the Caddy policy before starting/building.
export const legacyScriptHashes = [
  'MS6/3FCg4WjP9gwgaBGwLpRCY6fZBgwmhVCdrPrNf3E=',
  'tQjf8gvb2ROOMapIxFvFAYBeUJ0v1HCbOcSmDNXGtDo=',
  'w36slEqa9euNKxfvkw+LLGsDIr++3rsZXpZxtmRh8Aw=',
  '+5XkZFazzJo8n0iOP4ti/cLCMUudTf//Mzkb7xNPXIc=',
];
export const scriptSources = [
  "'self'",
  ...legacyScriptHashes.map((hash) => "'sha256-" + hash + "'"),
];
